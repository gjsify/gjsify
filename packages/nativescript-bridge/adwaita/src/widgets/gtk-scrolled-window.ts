// GtkScrolledWindow — a scrolling viewport around one child, for NativeScript.
//
// WRAPS A REAL NativeScript `ScrollView`: a one-cell `GridLayout` whose cell holds the
// `ScrollView`, and the child is the `ScrollView`'s `content`. A `ScrollView` scrolls on one
// axis where GTK scrolls on two, so `hscrollbar-policy` and `vscrollbar-policy` are folded
// into one `orientation` by `scrolled-window-policy.ts`. A window that scrolls on BOTH axes
// nests a second, horizontal `ScrollView` inside the viewport box (see "TWO AXES" below).
//
// `hscrollbar-policy: never` is what a `.blp` writes to keep a page from growing sideways
// (Learn6502's debugger and message console); on the vertical `ScrollView` that is already
// how the cross axis behaves, so the child wraps to the viewport width.
//
// THE CHILD IS NOT THE CONTENT. The `ScrollView`'s content is a box of this widget's own and
// the authored child goes INSIDE it, because a margin on the platform's scroll content is not
// a margin on scrolled content: MEASURED on Android, a child's `margin-top: 12` /
// `margin-bottom: 12` became a fixed inset of the VIEWPORT, clipping the content 12 dip inside
// each end at every scroll offset. Learn6502's quick help is the case — its `.blp` wraps the
// sheet's text in `Adw.Clamp { margin-top: 12; margin-bottom: 12; … }` — and the symptom was a
// line of text cut through the middle with sheet background beyond it, at BOTH ends, however
// far it was scrolled: the first text row stuck at 12 dip below the sheet's top edge over four
// consecutive scroll steps while the text behind it kept moving, and the last row stuck at
// 12 dip above the bottom. GTK has no such edge — a margin inside a `GtkScrolledWindow` is
// part of what scrolls, so the text reaches the viewport's edge and the margin is simply where
// it comes to REST at either end. One box in between restores that: the box has no margins of
// its own, so nothing reaches the scroll view, and the child's margins are measured into the
// length being scrolled like any other content.
//
// TWO AXES. A non-wrapping `GtkTextView` requests its natural width and a `GtkScrolledWindow`
// scrolls to it; a lone vertical `ScrollView` measures its content at the viewport width, so
// Learn6502's editor (an `EditText` with `setHorizontallyScrolling(true)`) was clipped at the
// right edge and a swipe sideways moved nothing, MEASURED on a Galaxy S9. When neither policy
// is `never` the viewport box therefore holds a horizontal `ScrollView` whose own box holds the
// child: the outer view takes vertical drags, the inner one horizontal drags, and the child is
// measured unbounded in width. A `never` axis keeps the single `ScrollView` and the child held
// to the viewport on that axis.
//
// THE BOX FILLS THE VIEWPORT, AND SO DOES THE CHILD. GtkViewport allocates its child
// `MAX (minimum, viewport size)` on each axis (`gtk_viewport_size_allocate`), so a child
// shorter than the window still covers it — a `GtkTextView` in a tall window is tall, and a
// tap anywhere below the last line lands in it. The platform `ScrollView` already lays its
// content out at least viewport-high; the box then has to hand that height on. A
// `StackLayout` does not: it stacks each child at its MEASURED height, and inside a scroll
// view that is measured unbounded, so it is the content height. MEASURED on Android
// (Learn6502's editor, a `GtkSource.View` in a `.blp`'s `ScrolledWindow`): the box was laid out
// 1473 px high and the `EditText` in it 84 px — one line of the editor column, white below,
// and a tap there reached nothing. A `ContentView` lays its one child out over its whole
// box, as GTK's viewport does.
//
// It is also the one place a scroll viewport's padding can be written without reaching into a
// consumer's widget, which is what `AdwBottomSheet` does with the gesture inset it must leave
// after the content (`bottom-sheet-insets.ts`).
//
// WHAT IT DOES NOT DO. The scrollbar itself is the platform's, so `always`, `automatic` and
// `external` cannot be told apart — only `never` changes anything. `has-frame` is held but no
// frame is drawn, and the content-size, kinetic and overlay-scrolling knobs have nothing to
// reach; each is a name in `check-nativescript-widget-coverage.mjs`.
//
// Reference: refs/gtk gtk/gtkscrolledwindow.c (GtkScrolledWindow)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GtkAdjustment } from '@gjsify/adwaita-core';
import { ContentView, GridLayout, ScrollView, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { builderSlotsOf } from './builder-slots.js';
import {
    DEFAULT_SCROLLBAR_POLICY,
    GTK_POLICY_TYPES,
    normalizePolicy,
    scrollOrientationFor,
    scrollsBothAxes,
    type GtkPolicyNick,
} from './scrolled-window-policy.js';
import { AdwSingleChildBase } from './single-child-base.js';
import { xmlBoolean } from './xml-values.js';

export class GtkScrolledWindow extends AdwSingleChildBase {
    static readonly GTypeName: string = 'GtkScrolledWindow';

    /** `Gtk.ScrolledWindow:child` is the one destination, so it is also the fallback. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    private readonly _scroll = new ScrollView();
    /** The box the child really goes in — see "THE CHILD IS NOT THE CONTENT" in the header. */
    private readonly _viewport = new ContentView();
    /** The horizontal half of a two-axis window — see "TWO AXES" in the header. */
    private readonly _hscroll = new ScrollView();
    /** The box the child goes in once `_hscroll` is in play, for the same margin reason. */
    private readonly _hbox = new ContentView();
    private _nested = false;
    private _hscrollbarPolicy: GtkPolicyNick = DEFAULT_SCROLLBAR_POLICY;
    private _vscrollbarPolicy: GtkPolicyNick = DEFAULT_SCROLLBAR_POLICY;
    private _hasFrame = false;
    private _hadjustment: GtkAdjustment | null = null;
    private _vadjustment: GtkAdjustment | null = null;
    private _listening = false;
    private _syncing = false;

    constructor(props?: ConstructProps<GtkScrolledWindow>) {
        super();
        GridLayout.setColumn(this._scroll, 0);
        GridLayout.setRow(this._scroll, 0);
        this._scroll.content = this._viewport;
        this._hscroll.orientation = 'horizontal';
        this._hscroll.content = this._hbox;
        this.addChild(this._scroll);
        this._applyOrientation();
        applyConstructProps(this, props);
    }

    /** `Gtk.ScrolledWindow:hscrollbar-policy` — a `Gtk.PolicyType`; defaults to `automatic`. */
    get hscrollbarPolicy(): GtkPolicyNick {
        return this._hscrollbarPolicy;
    }

    set hscrollbarPolicy(value: GtkPolicyNick) {
        this._hscrollbarPolicy = normalizePolicy(value, 'hscrollbar-policy');
        this._applyOrientation();
    }

    /** `Gtk.ScrolledWindow:vscrollbar-policy` — a `Gtk.PolicyType`; defaults to `automatic`. */
    get vscrollbarPolicy(): GtkPolicyNick {
        return this._vscrollbarPolicy;
    }

    set vscrollbarPolicy(value: GtkPolicyNick) {
        this._vscrollbarPolicy = normalizePolicy(value, 'vscrollbar-policy');
        this._applyOrientation();
    }

    /** `gtk_scrolled_window_get_policy`: `[hscrollbar, vscrollbar]` as `Gtk.PolicyType` constants. */
    get_policy(): [number, number] {
        return [GTK_POLICY_TYPES.indexOf(this._hscrollbarPolicy), GTK_POLICY_TYPES.indexOf(this._vscrollbarPolicy)];
    }

    /** `gtk_scrolled_window_set_policy`; a value that is not a `Gtk.PolicyType` constant throws. */
    set_policy(hscrollbar_policy: number, vscrollbar_policy: number): void {
        for (const [value, name] of [
            [hscrollbar_policy, 'hscrollbar_policy'],
            [vscrollbar_policy, 'vscrollbar_policy'],
        ] as const) {
            if (!Number.isInteger(value) || GTK_POLICY_TYPES[value] === undefined) {
                throw new TypeError(`${value} is not a valid value for enum argument ${name}`);
            }
        }
        this.hscrollbarPolicy = GTK_POLICY_TYPES[hscrollbar_policy]!;
        this.vscrollbarPolicy = GTK_POLICY_TYPES[vscrollbar_policy]!;
    }

    /**
     * `Gtk.ScrolledWindow:hadjustment` — the one it was given, else a window-owned one.
     *
     * Observable and kept in step with the `ScrollView` both ways: the scroll offset and the
     * content/viewport sizes are configured into it, and a write to its value scrolls.
     */
    get hadjustment(): GtkAdjustment {
        return (this._hadjustment ??= this._track('horizontal', new GtkAdjustment()));
    }

    get vadjustment(): GtkAdjustment {
        return (this._vadjustment ??= this._track('vertical', new GtkAdjustment()));
    }

    get_hadjustment(): GtkAdjustment {
        return this.hadjustment;
    }

    get_vadjustment(): GtkAdjustment {
        return this.vadjustment;
    }

    set_hadjustment(adjustment: GtkAdjustment): void {
        this._hadjustment = this._track('horizontal', adjustment);
    }

    set_vadjustment(adjustment: GtkAdjustment): void {
        this._vadjustment = this._track('vertical', adjustment);
    }

    private _track(axis: 'horizontal' | 'vertical', adjustment: GtkAdjustment): GtkAdjustment {
        if (!this._listening) {
            this._listening = true;
            // The platform scroll view reports no window-resize, so the post-layout sizes and
            // the scroll event are the sources the adjustments are configured from.
            this._scroll.addEventListener('scroll', this._syncAdjustments);
            this._hscroll.addEventListener('scroll', this._syncAdjustments);
            this._scroll.addEventListener('layoutChanged', this._syncAdjustments);
            this._viewport.addEventListener('layoutChanged', this._syncAdjustments);
        }
        adjustment.connect('value-changed', () => {
            const current = axis === 'horizontal' ? this._hadjustment : this._vadjustment;
            if (this._syncing || current !== adjustment) return;
            if (axis === 'horizontal') this._horizontalScroller.scrollToHorizontalOffset(adjustment.value, false);
            else this._scroll.scrollToVerticalOffset(adjustment.value, false);
        });
        this._syncAxis(axis, adjustment);
        return adjustment;
    }

    private readonly _syncAdjustments = (): void => {
        if (this._hadjustment) this._syncAxis('horizontal', this._hadjustment);
        if (this._vadjustment) this._syncAxis('vertical', this._vadjustment);
    };

    private _syncAxis(axis: 'horizontal' | 'vertical', adjustment: GtkAdjustment): void {
        const vertical = axis === 'vertical';
        const horizontal = this._horizontalScroller;
        const page = (vertical ? this._scroll : horizontal).getActualSize();
        const content = (vertical || !this._nested ? this._viewport : this._hbox).getActualSize();
        const pageSize = vertical ? page.height : page.width;
        const upper = Math.max(vertical ? content.height : content.width, pageSize);
        const value = vertical ? this._scroll.verticalOffset : horizontal.horizontalOffset;
        this._syncing = true;
        try {
            adjustment.configure(value, 0, upper, pageSize * 0.1, pageSize * 0.9, pageSize);
        } finally {
            this._syncing = false;
        }
    }

    /** `Gtk.ScrolledWindow:has-frame` — held and read back; no frame is drawn (see the header). */
    get hasFrame(): boolean {
        return this._hasFrame;
    }

    set hasFrame(raw: boolean | string) {
        this._hasFrame = xmlBoolean(raw, this._hasFrame);
    }

    /** The view that scrolls sideways: the inner one of a two-axis window, else the only one. */
    private get _horizontalScroller(): ScrollView {
        return this._nested ? this._hscroll : this._scroll;
    }

    /** Where the child sits: the viewport box, or the horizontal scroller's box inside it. */
    private get _holder(): ContentView {
        return this._nested ? this._hbox : this._viewport;
    }

    protected _adopt(view: View): void {
        this._holder.content = view;
    }

    protected _release(view: View): void {
        if (this._holder.content === view) this._holder.content = null;
    }

    private _applyOrientation(): void {
        this._scroll.orientation = scrollOrientationFor(this._hscrollbarPolicy, this._vscrollbarPolicy);
        const nested = scrollsBothAxes(this._hscrollbarPolicy, this._vscrollbarPolicy);
        if (nested === this._nested && this._viewport.content !== null) return;
        // A view has one parent: lift the child out of its old box before the new one takes it.
        const child = this.child;
        this._holder.content = null;
        this._nested = nested;
        this._viewport.content = nested ? this._hscroll : null;
        this._holder.content = child;
    }
}
