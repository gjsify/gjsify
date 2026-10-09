// GtkScrolledWindow — a scrolling viewport around one child, for NativeScript.
//
// WRAPS A REAL NativeScript `ScrollView`: a one-cell `GridLayout` whose cell holds the
// `ScrollView`, and the child is the `ScrollView`'s `content`. A `ScrollView` scrolls on one
// axis where GTK scrolls on two, so `hscrollbar-policy` and `vscrollbar-policy` are folded
// into one `orientation` by `scrolled-window-policy.ts`, and the loss — a window scrolling
// both ways scrolls vertically only — is declared in the coverage ledger.
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
import { GridLayout, ScrollView, StackLayout, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { builderSlotsOf } from './builder-slots.js';
import {
    DEFAULT_SCROLLBAR_POLICY,
    GTK_POLICY_TYPES,
    normalizePolicy,
    scrollOrientationFor,
    type GtkPolicyNick,
} from './scrolled-window-policy.js';
import { AdwSingleChildBase } from './single-child-base.js';
import { xmlBoolean } from './xml-values.js';

export class GtkScrolledWindow extends AdwSingleChildBase {
    /** `Gtk.ScrolledWindow:child` is the one destination, so it is also the fallback. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    private readonly _scroll = new ScrollView();
    /** The box the child really goes in — see "THE CHILD IS NOT THE CONTENT" in the header. */
    private readonly _viewport = new StackLayout();
    private _hscrollbarPolicy: GtkPolicyNick = DEFAULT_SCROLLBAR_POLICY;
    private _vscrollbarPolicy: GtkPolicyNick = DEFAULT_SCROLLBAR_POLICY;
    private _hasFrame = false;
    private _hadjustment: GtkAdjustment | null = null;
    private _vadjustment: GtkAdjustment | null = null;

    constructor(props?: ConstructProps<GtkScrolledWindow>) {
        super();
        GridLayout.setColumn(this._scroll, 0);
        GridLayout.setRow(this._scroll, 0);
        this._scroll.content = this._viewport;
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

    /** `Gtk.ScrolledWindow:hadjustment` — the one it was given, else a window-owned one. */
    get hadjustment(): GtkAdjustment {
        return (this._hadjustment ??= new GtkAdjustment());
    }

    get vadjustment(): GtkAdjustment {
        return (this._vadjustment ??= new GtkAdjustment());
    }

    get_hadjustment(): GtkAdjustment {
        return this.hadjustment;
    }

    get_vadjustment(): GtkAdjustment {
        return this.vadjustment;
    }

    set_hadjustment(adjustment: GtkAdjustment): void {
        this._hadjustment = adjustment;
    }

    set_vadjustment(adjustment: GtkAdjustment): void {
        this._vadjustment = adjustment;
    }

    /** `Gtk.ScrolledWindow:has-frame` — held and read back; no frame is drawn (see the header). */
    get hasFrame(): boolean {
        return this._hasFrame;
    }

    set hasFrame(raw: boolean | string) {
        this._hasFrame = xmlBoolean(raw, this._hasFrame);
    }

    protected _adopt(view: View): void {
        this._viewport.addChild(view);
    }

    protected _release(view: View): void {
        this._viewport.removeChild(view);
    }

    private _applyOrientation(): void {
        const orientation = scrollOrientationFor(this._hscrollbarPolicy, this._vscrollbarPolicy);
        this._scroll.orientation = orientation;
        // The box grows along the axis that scrolls and stretches across the other one,
        // which is what makes the child's margins part of the length being scrolled.
        this._viewport.orientation = orientation;
    }
}
