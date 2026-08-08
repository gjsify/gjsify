// AdwSplitViewBase — shared base for the NativeScript split-view widgets.
//
// `Adw.NavigationSplitView` and `Adw.OverlaySplitView` both pair a sidebar with a
// content pane and collapse on narrow widths; they differ only in HOW the sidebar
// behaves when collapsed (the navigation split-view swaps the visible pane like a
// nav stack; the overlay split-view slides the sidebar OVER the content). This base
// captures the shared sidebar/content slots + the `collapsed` / `showSidebar`
// state; the subclasses override `_applyLayout()` for their collapse behaviour.
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
// Reference: refs/libadwaita/src/stylesheet/widgets/_navigation-split-view.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { type Cancelable, type EventData, GridLayout, ItemSpec, type View } from '@nativescript/core';

import {
    defaultSidebarWidthProps,
    normalizeWidthFraction,
    normalizeWidthProp,
    sidebarWidthFor,
    type SidebarWidthProps,
    type SplitViewWidthRule,
} from './split-view-width.js';

/** Event name emitted when the sidebar visibility changes. */
export const NOTIFY_SHOW_SIDEBAR = 'notify::show-sidebar';

/** Payload of the `notify::show-sidebar` event. */
export interface NotifyShowSidebarEventData extends EventData {
    /** Whether the sidebar is currently shown. */
    showSidebar: boolean;
    /** Whether the view is in its collapsed (narrow) mode. */
    collapsed: boolean;
}

/**
 * Default sidebar width, in DIPs.
 *
 * @deprecated The widget has no single width — it has a FRACTION of the
 * container clamped between a min and a max, recomputed on resize. Kept as an
 * export so consumers pinning it keep compiling; `sidebarWidthFor` is the value
 * the panes are actually laid out with.
 */
export const DEFAULT_SIDEBAR_WIDTH = 240;

export abstract class AdwSplitViewBase extends GridLayout {
    protected _sidebar: View | null = null;
    protected _content: View | null = null;
    protected _collapsed = false;
    protected _showSidebar = true;
    /** The three width PROPERTIES; the drawn width is derived from them. */
    protected _widthProps: SidebarWidthProps = defaultSidebarWidthProps();
    /** The container width the sidebar was last sized against, in DIPs. */
    protected _measuredWidth = 0;
    /** An explicit `sidebarWidth` assignment, which overrides the derivation. */
    protected _sidebarWidthOverride: number | null = null;
    protected _sidebarPosition: 'start' | 'end' = 'start';

    constructor(
        rootClass: string,
        /** Which widget's width rule applies — they differ once a pane has a minimum. */
        protected readonly _widthRule: SplitViewWidthRule = 'overlay',
    ) {
        super();
        this.className = rootClass;
        this.addRow(new ItemSpec(1, 'star'));
        // NativeScript has no window-resize signal, so the container's own
        // post-layout size is the size source — the same one `addBreakpoints`
        // binds breakpoints to.
        this.addEventListener('layoutChanged', () => this._applySidebarWidth());
        // Two columns; the SIDEBAR column is fixed-width ('auto', sized to the pane)
        // and the CONTENT column expands ('star'). _syncColumns places them per
        // sidebarPosition so a trailing (end) sidebar sits flush to the right edge.
        this._syncColumns();
    }

    /**
     * (Re)declare the two columns so the sidebar's column is fixed-width ('auto')
     * and the content's is expanding ('star'), ordered by {@link sidebarPosition}:
     * `start` → [sidebar auto, content star]; `end` → [content star, sidebar auto].
     * Without this an `end` sidebar would land in the expanding column and float
     * away from the right edge (leaving a gap), with the content squeezed.
     */
    protected _syncColumns(): void {
        this.removeColumns();
        if (this._sidebarPosition === 'end') {
            this.addColumn(new ItemSpec(1, 'star')); // col 0: content
            this.addColumn(new ItemSpec(1, 'auto')); // col 1: sidebar
        } else {
            this.addColumn(new ItemSpec(1, 'auto')); // col 0: sidebar
            this.addColumn(new ItemSpec(1, 'star')); // col 1: content
        }
    }

    /** Subclass-specific layout application for the current collapsed/show state. */
    protected abstract _applyLayout(): void;

    /** Apply a user-initiated show/hide toggle. The default is an instant re-layout;
     *  the subclasses override this to slide the panes (and, for the overlay, fade a
     *  scrim) when collapsed. Kept separate from {@link _applyLayout} so structural
     *  re-layouts (setSidebar/collapsed/position changes) stay instant — only an
     *  on-screen `showSidebar` toggle animates. */
    protected _transitionSidebar(): void {
        this._applyLayout();
    }

    // --- shared animation plumbing (used by both split-view subclasses) ---

    /** In-flight animations, cancelled when a new transition supersedes them. */
    protected _pending: Cancelable[] = [];

    /** Whether to run a real animation now: native `animate()` present AND on-screen.
     *  Off-device (the mock view tree in specs) or pre-load it returns false, so the
     *  caller falls back to an instant `visibility` swap. */
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
            view.width = this.sidebarWidth;
            this.addChild(view);
        }
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
        this._applyLayout();
    }

    /** Show the sidebar (relevant in collapsed mode). */
    showSidebarPane(): void {
        this.showSidebar = true;
    }

    /** Hide the sidebar (relevant in collapsed mode). */
    hideSidebarPane(): void {
        this.showSidebar = false;
    }

    /** Whether the view is in collapsed (narrow / single-pane) mode. */
    get collapsed(): boolean {
        return this._collapsed;
    }

    set collapsed(value: boolean) {
        this._collapsed = !!value;
        this._applyLayout();
    }

    /** Whether the sidebar is shown. Toggling emits `notify::show-sidebar`. */
    get showSidebar(): boolean {
        return this._showSidebar;
    }

    set showSidebar(value: boolean) {
        const next = !!value;
        if (next === this._showSidebar) return;
        this._showSidebar = next;
        this._transitionSidebar();
        const data: NotifyShowSidebarEventData = {
            eventName: NOTIFY_SHOW_SIDEBAR,
            object: this,
            showSidebar: next,
            collapsed: this._collapsed,
        };
        this.notify(data);
    }

    /**
     * The sidebar pane width in DIPs, DERIVED from the container size unless a
     * caller assigned one. `Adw.OverlaySplitView` has no stored width — see
     * `split-view-width.ts` for why the old fixed 240 could not be right.
     */
    get sidebarWidth(): number {
        return this._sidebarWidthOverride ?? sidebarWidthFor(this._measuredWidth, this._widthProps, this._widthRule);
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
        if (this._sidebar) this._sidebar.width = this.sidebarWidth;
    }

    /** Which side the sidebar sits on — `'start'` (leading / left) or `'end'`
     *  (trailing / right). Mirrors `Adw.OverlaySplitView`'s `sidebar-position`
     *  (the storybook controls overlay uses `'end'`). */
    get sidebarPosition(): 'start' | 'end' {
        return this._sidebarPosition;
    }

    set sidebarPosition(value: 'start' | 'end') {
        this._sidebarPosition = value === 'end' ? 'end' : 'start';
        // The fixed/expanding column order depends on the side, so re-declare them.
        this._syncColumns();
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
