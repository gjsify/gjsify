// AdwSplitViewBase — shared base for the NativeScript split-view widgets.
//
// `Adw.NavigationSplitView` and `Adw.OverlaySplitView` both pair a sidebar with a
// content pane and collapse on narrow widths; they differ only in HOW the sidebar
// behaves when collapsed (navigation swaps the visible pane like a nav stack;
// overlay slides the sidebar OVER the content). This base holds the shared
// sidebar/content slots and the view-tree half of `collapsed` / `showSidebar`; the
// subclasses override `_applyLayout()` for their collapse behaviour.
//
// The STATE behind those two properties is not here: each subclass hands `super()`
// its adapter from `split-view-state.ts`, which holds the matching
// `@gjsify/adwaita-core` state machine (ADR 0004) and calls back through
// {@link NsSplitViewHost}. This class keeps no `collapsed`/`showSidebar` field.
//
// FIDELITY: approximated. NS has no responsive two-pane container and no automatic
// width breakpoint, so `collapsed` is a manual flag the consumer toggles (e.g.
// from an orientation/size listener) rather than an automatic narrow-width
// collapse. The collapsed show/hide IS animated on-device: the overlay subclass
// slides the sidebar in/out and fades a tap-to-dismiss scrim via the native
// `View.animate()` API (not the CSS subset — a real per-property animation),
// falling back to an instant `visibility` swap off-screen / off-device. The
// `_transitionSidebar()` seam keeps structural re-layouts instant.
//
// Reference: refs/libadwaita/src/adw-navigation-split-view.c, adw-overlay-split-view.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { type Cancelable, type EventData, GridLayout, ItemSpec, type View } from '@nativescript/core';

import {
    appliesDerivedSidebarWidth,
    defaultSidebarWidthProps,
    normalizeWidthFraction,
    normalizeWidthProp,
    sidebarWidthFor,
    type SidebarWidthProps,
    type SplitViewWidthRule,
} from './split-view-width.js';
import { splitViewColumns } from './split-view-state.js';
import type { AdwPackType, NsShowSidebarNotification, NsSplitViewState } from './split-view-state.js';
import type { AdwTextDirection } from '@gjsify/adwaita-core';
import { resolveBuilderSlot } from './builder-slots.js';

/** Event name emitted when the sidebar visibility changes. */
export const NOTIFY_SHOW_SIDEBAR = 'notify::show-sidebar';

/** Payload of the `notify::show-sidebar` event. */
export interface NotifyShowSidebarEventData extends EventData {
    showSidebar: boolean;
    /** Whether the view is in its collapsed (narrow) mode. */
    collapsed: boolean;
}

/** The two panes an XML child of a split view can ask for. */
const SPLIT_VIEW_SLOTS = ['sidebar', 'content'] as const;

export abstract class AdwSplitViewBase<TState extends NsSplitViewState = NsSplitViewState> extends GridLayout {
    protected _sidebar: View | null = null;
    protected _content: View | null = null;
    /** The three width PROPERTIES; the drawn width is derived from them. */
    protected _widthProps: SidebarWidthProps = defaultSidebarWidthProps();
    /** The container width the sidebar was last sized against, in DIPs. */
    protected _measuredWidth = 0;
    /** An explicit `sidebarWidth` assignment, which overrides the derivation. */
    protected _sidebarWidthOverride: number | null = null;

    constructor(
        rootClass: string,
        /** Which widget's width rule applies — they differ once a pane has a minimum. */
        protected readonly _widthRule: SplitViewWidthRule,
        /** The headless state machine this widget renders (`split-view-state.ts`). */
        protected readonly _state: TState,
    ) {
        super();
        this.className = rootClass;
        this.addRow(new ItemSpec(1, 'star'));
        // The arrows only run on a LATER state change, so binding here is safe even
        // though `_applyLayout` is the subclass's.
        this._state.bind({
            applyLayout: () => this._applyLayout(),
            transitionSidebar: () => this._transitionSidebar(),
            notifyShowSidebar: (event) => this._emitShowSidebar(event),
        });
        // NativeScript has no window-resize signal, so the container's own
        // post-layout size is the size source — the same one `addBreakpoints`
        // binds breakpoints to.
        this.addEventListener('layoutChanged', () => this._applySidebarWidth());
        this._syncColumns();
    }

    /**
     * (Re)declare the two columns so the sidebar's is fixed-width (`'auto'`, sized to
     * the pane) and the content's expands (`'star'`), ordered by the side the sidebar
     * is DRAWN on. Without this an `end` sidebar lands in the expanding column and
     * floats away from the edge, with the content squeezed.
     *
     * `splitViewColumns()` is the other half of the same rule — which column each
     * PANE is written into — and both must agree.
     */
    protected _syncColumns(): void {
        this.removeColumns();
        // Column 0 is the LEADING column, so the question is which side the sidebar
        // is drawn on, not which side it is packed on: under RTL a `start` sidebar is
        // drawn on the right. `splitViewColumns` is that predicate.
        const columns = splitViewColumns(this._state.sidebarPosition, this.textDirection);
        if (columns.sidebar === 0) {
            this.addColumn(new ItemSpec(1, 'auto')); // col 0: sidebar
            this.addColumn(new ItemSpec(1, 'star')); // col 1: content
        } else {
            this.addColumn(new ItemSpec(1, 'star')); // col 0: content
            this.addColumn(new ItemSpec(1, 'auto')); // col 1: sidebar
        }
    }

    /**
     * Publish which visual side the pane is on, so the theme can put the divider
     * there — the CSS counterpart to `_sidebars.scss`'s `:dir()` × `.end` product. A
     * fixed `border-right` draws it on the wrong edge for an `end` sidebar and for
     * every RTL layout.
     */
    protected _syncSidebarSide(view: View | null = this._sidebar): void {
        if (!view) return;
        const atStart = splitViewColumns(this._state.sidebarPosition, this.textDirection).sidebar === 0;
        const classes = (view.className ?? '')
            .split(' ')
            .filter((name) => name && name !== 'adw-sidebar-at-visual-start' && name !== 'adw-sidebar-at-visual-end');
        classes.push(atStart ? 'adw-sidebar-at-visual-start' : 'adw-sidebar-at-visual-end');
        view.className = classes.join(' ');
    }

    /**
     * The reading direction `start` / `end` resolve against.
     *
     * `direction` is an INHERITED CSS property on NativeScript's `Style`, so a
     * `direction: rtl` on the Page reaches every split view under it — the same
     * way GTK's text direction reaches a widget from its window. It defaults to
     * unset, which is `ltr`.
     */
    get textDirection(): AdwTextDirection {
        return this.style?.direction === 'rtl' ? 'rtl' : 'ltr';
    }

    /** Re-emit `notify::show-sidebar` for a state change. */
    protected _emitShowSidebar(event: NsShowSidebarNotification): void {
        const data: NotifyShowSidebarEventData = {
            eventName: NOTIFY_SHOW_SIDEBAR,
            object: this,
            showSidebar: event.showSidebar,
            collapsed: event.collapsed,
        };
        this.notify(data);
    }

    /** Subclass-specific layout application for the current collapsed/show state. */
    protected abstract _applyLayout(): void;

    /** Apply a user-initiated show/hide toggle. Separate from {@link _applyLayout} so
     *  structural re-layouts stay instant — only an on-screen `showSidebar` toggle
     *  animates; the subclasses override this to slide the panes. */
    protected _transitionSidebar(): void {
        this._applyLayout();
    }

    /** In-flight animations, cancelled when a new transition supersedes them. */
    protected _pending: Cancelable[] = [];

    /** Whether to run a real animation now: native `animate()` present AND on-screen.
     *  False off-device or pre-load, so the caller falls back to an instant
     *  `visibility` swap. */
    protected _shouldAnimate(): boolean {
        const probe = (this._sidebar ?? this._content ?? this) as unknown as { animate?: unknown };
        return typeof probe.animate === 'function' && this.isLoaded === true;
    }

    /** Register an animation so a later transition can cancel it; returns a plain promise. */
    protected _track(anim: Promise<void> & Cancelable): Promise<void> {
        this._pending.push(anim);
        return anim;
    }

    /** Cancel any in-flight animations before starting a new transition. */
    protected _cancelPending(): void {
        for (const p of this._pending) {
            try {
                p.cancel();
            } catch {
                /* already settled */
            }
        }
        this._pending = [];
    }

    /** Whether `view` is currently a child of this layout. */
    protected _isChild(view: View): boolean {
        for (let i = 0; i < this.getChildrenCount(); i++) {
            if (this.getChildAt(i) === view) return true;
        }
        return false;
    }

    /** Set (or replace) the sidebar pane. */
    setSidebar(view: View | null): void {
        if (this._sidebar) this.removeChild(this._sidebar);
        this._sidebar = view;
        if (view) {
            view.className = `${view.className ?? ''} adw-split-view-sidebar`.trim();
            this._syncSidebarSide(view);
            view.width = this.sidebarWidth;
            this.addChild(view);
        }
        // Which children exist decides the navigation stack — a LONE child stays
        // visible whatever `show-content` says.
        this._state.setPaneMounted('sidebar', view !== null);
        this._applyLayout();
    }

    /** Set (or replace) the content pane. */
    setContent(view: View | null): void {
        if (this._content) this.removeChild(this._content);
        this._content = view;
        if (view) {
            view.className = `${view.className ?? ''} adw-split-view-content`.trim();
            this.addChild(view);
        }
        this._state.setPaneMounted('content', view !== null);
        this._applyLayout();
    }

    /**
     * An XML child asks for `sidebar` or `content`, and a bare one is CONTENT.
     *
     * The fallback follows the widget's own collapsed behaviour: a lone child stays
     * visible whatever `show-content` says, so the pane a template gives without
     * naming one is the one a reader will see. Without this override, `LayoutBase`'s
     * default drops both panes into column 0 of the grid, stacked.
     */
    _addChildFromBuilder(name: string, view: View): void {
        if (resolveBuilderSlot(name, SPLIT_VIEW_SLOTS, 'content') === 'sidebar') this.setSidebar(view);
        else this.setContent(view);
    }

    /** Show the sidebar (relevant in collapsed mode). */
    showSidebarPane(): void {
        this.showSidebar = true;
    }

    /** Hide the sidebar (relevant in collapsed mode). */
    hideSidebarPane(): void {
        this.showSidebar = false;
    }

    /**
     * Whether the view is in collapsed (narrow / single-pane) mode.
     *
     * On an OVERLAY split view this is not an independent flag: unless the sidebar
     * is pinned, collapsing hides it and uncollapsing shows it, emitting
     * `notify::show-sidebar` first — the state machine owns that, not this setter.
     */
    get collapsed(): boolean {
        return this._state.collapsed;
    }

    set collapsed(value: boolean) {
        this._state.setCollapsed(!!value);
    }

    /** Whether the sidebar is shown. Toggling emits `notify::show-sidebar`. */
    get showSidebar(): boolean {
        return this._state.showSidebar;
    }

    set showSidebar(value: boolean) {
        this._state.setShowSidebar(!!value);
    }

    /**
     * The sidebar pane width in DIPs, DERIVED from the container size unless a caller
     * assigned one — `Adw.OverlaySplitView` stores no width; see
     * `split-view-width.ts` for the rule.
     */
    get sidebarWidth(): number {
        return (
            this._sidebarWidthOverride ??
            sidebarWidthFor(this._measuredWidth, this._widthProps, this._widthRule, {
                collapsed: this._state.collapsed,
            })
        );
    }

    set sidebarWidth(value: number) {
        // An explicit assignment pins the width; anything nonsensical releases
        // the pin rather than freezing the pane at a broken size.
        this._sidebarWidthOverride = Number.isFinite(value) && value > 0 ? value : null;
        this._applySidebarWidth();
    }

    /** Lower bound in DIPs (`Adw.OverlaySplitView:min-sidebar-width`, default 180). */
    get minSidebarWidth(): number {
        return this._widthProps.minSidebarWidth;
    }

    set minSidebarWidth(value: number) {
        this._widthProps.minSidebarWidth = normalizeWidthProp(value, defaultSidebarWidthProps().minSidebarWidth);
        this._applySidebarWidth();
    }

    /** Upper bound in DIPs (`Adw.OverlaySplitView:max-sidebar-width`, default 280). */
    get maxSidebarWidth(): number {
        return this._widthProps.maxSidebarWidth;
    }

    set maxSidebarWidth(value: number) {
        this._widthProps.maxSidebarWidth = normalizeWidthProp(value, defaultSidebarWidthProps().maxSidebarWidth);
        this._applySidebarWidth();
    }

    /** Share of the container the sidebar asks for (default 0.25). */
    get sidebarWidthFraction(): number {
        return this._widthProps.sidebarWidthFraction;
    }

    set sidebarWidthFraction(value: number) {
        this._widthProps.sidebarWidthFraction = normalizeWidthFraction(value);
        this._applySidebarWidth();
    }

    /**
     * Re-measure the container and re-size the sidebar.
     *
     * Called from `layoutChanged`, the same size source `addBreakpoints` uses —
     * NativeScript has no window-resize signal, so a view's post-layout size is
     * the closest thing to the window size Adwaita evaluates against.
     */
    protected _applySidebarWidth(): void {
        const size = this.getActualSize?.();
        if (size && size.width > 0) this._measuredWidth = size.width;
        if (!this._sidebar) return;
        // Guarded: writing the derived width unconditionally undoes a collapsed pane's
        // `'auto'` one frame later. The rule lives in the pure sibling so a spec can
        // pin it — this class `extends GridLayout`, which no test can import.
        if (!appliesDerivedSidebarWidth(this._state.collapsed, this._widthRule)) return;
        this._sidebar.width = this.sidebarWidth;
    }

    /** `Adw.OverlaySplitView:sidebar-position` — `'start'` (leading) or `'end'`. */
    get sidebarPosition(): AdwPackType {
        return this._state.sidebarPosition;
    }

    set sidebarPosition(value: AdwPackType) {
        if (!this._state.setSidebarPosition(value === 'end' ? 'end' : 'start')) return;
        // The fixed/expanding column order depends on the side, so re-declare them
        // BEFORE the panes are written into their columns.
        this._syncColumns();
        this._syncSidebarSide();
        this._applyLayout();
    }

    /** The sidebar pane, or `null`. */
    get sidebar(): View | null {
        return this._sidebar;
    }

    /** The content pane, or `null`. */
    get content(): View | null {
        return this._content;
    }
}
