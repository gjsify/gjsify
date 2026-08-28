// AdwToolbarView — a Libadwaita-style toolbar view for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (rows `auto, *, auto`): a top-bar slot
// (header bars / toolbars), an expanding content slot, and a bottom-bar slot.
// Mirrors `Adw.ToolbarView`: `addTopBar()` / `setContent()` / `addBottomBar()`.
//
// FIDELITY: the vertical arrangement maps directly onto an NS `GridLayout`, and the four
// classes libadwaita derives from `top-bar-style`/`bottom-bar-style` (`raised`,
// `border`, `undershoot-top`, `undershoot-bottom`) come from `@gjsify/adwaita-core`'s
// `toolbarViewClasses`. `extend-content-to-*-edge` moves the bar box into the content
// row and pins it to that edge — the NS spelling of "the content spans the full height
// and the bar is drawn over it".
//
// NOT reproduced: the two chained CLAMPs of `adw_toolbar_view_size_allocate`. NS row
// specs do the allocation, so a STRETCHY bar (natural > minimum) keeps its natural
// height where libadwaita would shrink it toward its minimum to protect the content.
// The arithmetic is in core with vectors (`toolbarViewAllocate`); this widget has no
// stretchy bars to apply it to.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-toolbar-view`.
// Reference: refs/libadwaita/src/adw-toolbar-view.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, StackLayout, View } from '@nativescript/core';

import {
    type AdwToolbarStyle,
    type ToolbarViewProps,
    defaultToolbarViewProps,
    toolbarViewClassNames,
} from './chrome.js';
import { resolveBuilderSlot } from './builder-slots.js';
import { resolveHostInsets } from './host-insets.js';
import { observeWindowInsets } from './window-insets-source.js';
import { NO_INSETS, type WindowInsets, insetsOwedBy, toolbarViewInsetPadding } from './window-insets.js';

/** The classes the widget starts with; the derived ones are swapped in beside them. */
const BASE_CLASSES = {
    view: 'adw-toolbar-view',
    topBar: 'adw-toolbar-view-top',
    bottomBar: 'adw-toolbar-view-bottom',
};

/**
 * The slots a template may name, spelled as this widget's own properties —
 * `<AdwToolbarView.topBar>`, `<AdwToolbarView.bottomBar>`, `<AdwToolbarView.content>`.
 */
const TOOLBAR_VIEW_SLOTS = ['topBar', 'bottomBar', 'content'] as const;

export class AdwToolbarView extends GridLayout {
    /** The top-bar slot (row 0) — stack of header bars / toolbars. */
    protected readonly _topBox: StackLayout;
    /** The bottom-bar slot (row 2) — stack of bottom toolbars. */
    protected readonly _bottomBox: StackLayout;
    /** The currently-installed content view (row 1), if any. */
    private _content: View | null = null;
    private _props: ToolbarViewProps = defaultToolbarViewProps();
    /** The last window insets seen, so a shape change can be re-paid without waiting. */
    private _insets: WindowInsets = NO_INSETS;
    private _topBarCount = 0;
    private _bottomBarCount = 0;
    private _detachInsets: (() => void) | null = null;

    constructor() {
        super();

        this.className = BASE_CLASSES.view;

        this.addColumn(new ItemSpec(1, 'star'));
        // Rows: top hugs, content expands, bottom hugs.
        this.addRow(new ItemSpec(1, 'auto'));
        this.addRow(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));

        const topBox = new StackLayout();
        topBox.orientation = 'vertical';
        topBox.className = BASE_CLASSES.topBar;
        GridLayout.setRow(topBox, 0);
        this.addChild(topBox);
        this._topBox = topBox;

        const bottomBox = new StackLayout();
        bottomBox.orientation = 'vertical';
        bottomBox.className = BASE_CLASSES.bottomBar;
        GridLayout.setRow(bottomBox, 2);
        this.addChild(bottomBox);
        this._bottomBox = bottomBox;

        // `update_undershoots` runs from size_allocate, so the classes follow the
        // bars' real heights rather than a one-shot read at construction.
        this.addEventListener('layoutChanged', () => this._syncClasses());

        // Window insets are the chrome's business, not each app's. Subscribing here
        // is what fixes every showcase and every consumer at once — doing it per app
        // is how it drifts, and #1128 is what that looked like: the scrim of every
        // dialog stopped short of the status bar because nothing anywhere applied an
        // inset. Bound on `loaded` so a torn-down pane stops holding the listener.
        this.addEventListener('loaded', () => {
            this._detachInsets ??= observeWindowInsets((insets) => this._applyInsets(insets));
        });
        this.addEventListener('unloaded', () => {
            this._detachInsets?.();
            this._detachInsets = null;
        });
    }

    /** Append a widget (e.g. an {@link AdwHeaderBar}) to the top-bar slot. */
    addTopBar(view: View): void {
        this._topBox.addChild(view);
        this._topBarCount += 1;
        this._applyInsets(this._insets);
    }

    /** Append a widget to the bottom-bar slot. */
    addBottomBar(view: View): void {
        this._bottomBox.addChild(view);
        this._bottomBarCount += 1;
        this._applyInsets(this._insets);
    }

    /** Set (or replace) the main content view. Pass `null` to clear it. */
    setContent(view: View | null): void {
        if (this._content) {
            this.removeChild(this._content);
            this._content = null;
        }
        if (view) {
            GridLayout.setRow(view, 1);
            this.addChild(view);
            this._content = view;
        }
        // The content was just added last, so it would paint over an extended bar.
        this._restackBars();
    }

    /**
     * XML inflation — route a template's child through the slot API.
     *
     * `<AdwToolbarView.topBar>` / `.bottomBar` / `.content` arrive here as those
     * names; anything else (a bare child) is the content, which is the one slot a
     * toolbar view cannot do without. Without this the `GridLayout` default put
     * every child in row 0: measured on Android, a top bar and the content were
     * painted ON TOP OF EACH OTHER in the bar row while row 1 stayed empty.
     */
    _addChildFromBuilder(name: string, view: View): void {
        switch (resolveBuilderSlot(name, TOOLBAR_VIEW_SLOTS, 'content')) {
            case 'topBar':
                this.addTopBar(view);
                return;
            case 'bottomBar':
                this.addBottomBar(view);
                return;
            default:
                this.setContent(view);
        }
    }

    /** The currently-installed content view, or `null`. */
    get content(): View | null {
        return this._content;
    }

    /** The top-bar slot container. */
    get topBar(): StackLayout {
        return this._topBox;
    }

    /** The bottom-bar slot container. */
    get bottomBar(): StackLayout {
        return this._bottomBox;
    }

    /** `Adw.ToolbarView:top-bar-style` — `flat` (default), `raised` or `raised-border`. */
    get topBarStyle(): AdwToolbarStyle {
        return this._props.topBarStyle;
    }

    set topBarStyle(value: AdwToolbarStyle) {
        this._props.topBarStyle = value;
        this._syncClasses();
    }

    /** `Adw.ToolbarView:bottom-bar-style` — `flat` (default), `raised` or `raised-border`. */
    get bottomBarStyle(): AdwToolbarStyle {
        return this._props.bottomBarStyle;
    }

    set bottomBarStyle(value: AdwToolbarStyle) {
        this._props.bottomBarStyle = value;
        this._syncClasses();
    }

    /** `Adw.ToolbarView:extend-content-to-top-edge` — draw the top bar OVER the content. */
    get extendContentToTopEdge(): boolean {
        return this._props.extendContentToTopEdge;
    }

    set extendContentToTopEdge(value: boolean) {
        this._props.extendContentToTopEdge = !!value;
        this._applyBarPlacement();
    }

    /** `Adw.ToolbarView:extend-content-to-bottom-edge` — draw the bottom bar OVER the content. */
    get extendContentToBottomEdge(): boolean {
        return this._props.extendContentToBottomEdge;
    }

    set extendContentToBottomEdge(value: boolean) {
        this._props.extendContentToBottomEdge = !!value;
        this._applyBarPlacement();
    }

    /**
     * Put each bar box in its own row, or — when the content extends under it —
     * in the CONTENT row pinned to that edge, which is how an NS `GridLayout`
     * spells "the content spans the full height and the bar overlays it".
     */
    private _applyBarPlacement(): void {
        GridLayout.setRow(this._topBox, this._props.extendContentToTopEdge ? 1 : 0);
        this._topBox.verticalAlignment = this._props.extendContentToTopEdge ? 'top' : 'stretch';
        GridLayout.setRow(this._bottomBox, this._props.extendContentToBottomEdge ? 1 : 2);
        this._bottomBox.verticalAlignment = this._props.extendContentToBottomEdge ? 'bottom' : 'stretch';
        this._restackBars();
        this._syncClasses();
    }

    /**
     * Re-append the bar boxes so they sit ON TOP of the content.
     *
     * NativeScript paints siblings in add order, and an extended bar shares a
     * grid cell with the content — which is added later, so without this the
     * content would cover the very bar it is supposed to scroll under. A no-op
     * while neither edge is extended, since the boxes then have their own rows.
     */
    private _restackBars(): void {
        if (!this._props.extendContentToTopEdge && !this._props.extendContentToBottomEdge) return;
        for (const box of [this._topBox, this._bottomBox]) {
            this.removeChild(box);
            this.addChild(box);
        }
    }

    /**
     * Pay each edge's inset out of the slot that sits on it — the part of it this
     * widget still owes.
     *
     * `insetsOwedBy` drops what the HOST already paid, which on Android is the bottom
     * edge (the page's `LayoutBase`, because only its branch also folds in the keyboard)
     * and never the top (`host-insets.android.ts` hands that edge back, because only the
     * top-bar box paints it in the header colour). Without it the inset was applied
     * twice: 142 px + 142 px above the header bar on emulator-5554.
     *
     * The assignment is decided by the pure sibling (`toolbarViewInsetPadding`); this
     * only spells it in NativeScript. Where that module says "the content pays", the
     * padding goes on THIS view rather than on the content view: the content belongs
     * to the consumer, and a chrome that writes padding into a consumer's widget
     * would silently overwrite whatever they set there.
     */
    private _applyInsets(insets: WindowInsets): void {
        this._insets = insets;
        const padding = toolbarViewInsetPadding(insetsOwedBy(insets, resolveHostInsets(this, insets)), {
            hasTopBar: this._topBarCount > 0,
            hasBottomBar: this._bottomBarCount > 0,
        });
        this._topBox.paddingTop = padding.topBarTop;
        this._bottomBox.paddingBottom = padding.bottomBarBottom;
        this.paddingTop = padding.contentTop;
        this.paddingBottom = padding.contentBottom;
    }

    /**
     * Re-derive the four libadwaita style classes from the current state.
     *
     * Composed against the CURRENT class names rather than the base ones, so a
     * class a consumer appended survives (the storybook appends
     * `sb-sidebar-pane` to one of these). Each assignment is guarded on a real
     * change: this runs from `layoutChanged`, and re-styling a view can schedule
     * another layout pass.
     */
    private _syncClasses(): void {
        const heights = {
            topBarHeight: this._topBox.getActualSize?.().height ?? 0,
            bottomBarHeight: this._bottomBox.getActualSize?.().height ?? 0,
        };
        const names = toolbarViewClassNames(
            { view: this.className, topBar: this._topBox.className, bottomBar: this._bottomBox.className },
            this._props,
            heights,
        );
        if (this.className !== names.view) this.className = names.view;
        if (this._topBox.className !== names.topBar) this._topBox.className = names.topBar;
        if (this._bottomBox.className !== names.bottomBar) this._bottomBox.className = names.bottomBar;
    }
}
