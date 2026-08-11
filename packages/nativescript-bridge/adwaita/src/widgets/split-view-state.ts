// Split-view state for the NativeScript split views — the pure half.
//
// `collapsed`, `show-sidebar`/`show-content` and `pin-sidebar` form ONE state
// machine per widget; both machines live headless in `@gjsify/adwaita-core` (ADR
// 0004) and this module only binds one to a NativeScript widget. Their coupling
// rules are on the members below. No `@nativescript/core` value imports, so specs
// reach the real adapter off-device (`split-view-base.ts` cannot — AGENTS.md).
//
// Reference: refs/libadwaita/src/adw-overlay-split-view.c
// Reference: refs/libadwaita/src/adw-navigation-split-view.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { NavigationSplitViewState, OverlaySplitViewState, isSidebarAtVisualStart } from '@gjsify/adwaita-core';
import type {
    AdwPackType,
    AdwTextDirection,
    NavigationActionResult,
    NavigationPageRef,
    NavigationSplitViewChange,
    NavigationStackPlan,
    OverlaySplitViewChange,
    OverlaySplitViewOptions,
    SplitViewPane,
} from '@gjsify/adwaita-core';

export type { AdwPackType, NavigationStackPlan, SplitViewPane };

/** Payload of the `notify::show-sidebar` a state change asks the widget to emit. */
export interface NsShowSidebarNotification {
    showSidebar: boolean;
    /** Whether the view is in its collapsed (narrow) mode. */
    collapsed: boolean;
}

/**
 * The NativeScript side of a split view: what a state change makes it do.
 *
 * Only changes with real ordering or animation semantics come through here.
 * Structural mutations (mounting a pane, moving the sidebar) stay the widget's own
 * business, because they also have to re-declare the grid columns — a callback
 * could only run after that anyway.
 */
export interface NsSplitViewHost {
    /** Re-run the structural layout for the SETTLED state. Instant. */
    applyLayout(): void;
    /** Run the animated sidebar reveal / master⇄detail swap — a user-driven toggle. */
    transitionSidebar(): void;
    /** Re-emit `notify::show-sidebar`. */
    notifyShowSidebar(event: NsShowSidebarNotification): void;
}

/** The `collapsed` + `show-sidebar` surface `AdwSplitViewBase` delegates to. */
export interface NsSplitViewState {
    /** Whether the panes are stacked (one at a time) rather than side by side. */
    readonly collapsed: boolean;
    readonly showSidebar: boolean;
    /** Which side the sidebar is packed on. */
    readonly sidebarPosition: AdwPackType;
    /** Attach the widget. Called exactly once, from the base constructor. */
    bind(host: NsSplitViewHost): void;
    /** Returns whether it changed. */
    setCollapsed(value: boolean): boolean;
    /** Returns whether it changed. */
    setShowSidebar(value: boolean): boolean;
    /** Returns whether it changed. */
    setSidebarPosition(position: AdwPackType): boolean;
    /** Record that a pane was mounted or unmounted. Returns whether it changed. */
    setPaneMounted(pane: SplitViewPane, mounted: boolean): boolean;
}

/**
 * Which of the two grid columns each pane takes.
 *
 * `AdwSplitViewBase._syncColumns` makes the SIDEBAR's column the fixed (`'auto'`)
 * one and the content's the expanding (`'star'`) one, ordered by
 * `sidebar-position`. A pane in the wrong column is therefore not merely mirrored,
 * it also swaps its sizing mode.
 */
export function splitViewColumns(
    sidebarPosition: AdwPackType,
    direction: AdwTextDirection = 'ltr',
): { sidebar: number; content: number } {
    // The grid's LEADING column is column 0, so the question is not which side
    // the sidebar is packed on but which side it is DRAWN on — the one predicate
    // `isSidebarAtVisualStart` answers, and the one an RTL layout inverts.
    return isSidebarAtVisualStart(sidebarPosition, direction) ? { sidebar: 0, content: 1 } : { sidebar: 1, content: 0 };
}

/**
 * `Adw.OverlaySplitView` bound to a NativeScript widget. The widget keeps ZERO
 * split-view state.
 *
 * The reveal is NOT driven from here: NativeScript animates with a native
 * `View.animate()` on `translateX`/`opacity` rather than by sampling a progress
 * value, so the core's `SplitViewAnimator` seam stays on its instant default and
 * `show-progress` settles at 0 or 1 — what `adw_animation_skip` also yields.
 */
export class NsOverlaySplitViewState implements NsSplitViewState {
    private readonly _state: OverlaySplitViewState;
    private _host: NsSplitViewHost | null = null;
    /**
     * True while {@link setCollapsed} runs. The `show-sidebar` flip it couples is
     * STRUCTURAL, not a user toggle: `set_collapsed` passes `animate = FALSE` and
     * the `collapsed` notification behind it re-lays the whole view out anyway.
     */
    private _coupling = false;

    constructor(options: OverlaySplitViewOptions = {}) {
        this._state = new OverlaySplitViewState(options);
        this._state.subscribe((change) => this._apply(change));
    }

    bind(host: NsSplitViewHost): void {
        this._host = host;
    }

    /** Whether the sidebar overlays the content instead of sitting beside it. */
    get collapsed(): boolean {
        return this._state.collapsed;
    }

    get showSidebar(): boolean {
        return this._state.showSidebar;
    }

    /** Whether collapsing/uncollapsing leaves the sidebar's visibility alone. */
    get pinSidebar(): boolean {
        return this._state.pinSidebar;
    }

    /** Which side the sidebar is packed on. */
    get sidebarPosition(): AdwPackType {
        return this._state.sidebarPosition;
    }

    /** The reveal progress: 0 hidden, 1 shown. */
    get showProgress(): number {
        return this._state.showProgress;
    }

    /** Whether the tap-to-dismiss scrim takes input — `update_shield`. */
    get shieldVisible(): boolean {
        return this._state.shieldVisible;
    }

    /**
     * Whether the SIDEBAR pane may take focus — GTK's
     * `can_focus = !collapsed || show_sidebar`. NativeScript's equivalent is
     * `isUserInteractionEnabled`; without it the pane hidden behind the overlay
     * keeps answering taps and stays in the screen-reader order.
     */
    get sidebarFocusable(): boolean {
        return this._state.sidebarFocusable;
    }

    /** The mirror of {@link sidebarFocusable} for the CONTENT pane. */
    get contentFocusable(): boolean {
        return this._state.contentFocusable;
    }

    /**
     * Collapse or expand. Unless the sidebar is pinned this also flips
     * `show-sidebar` to match, notifying it FIRST — GTK freezes notifications
     * across the whole setter and thaws them in queue order.
     */
    setCollapsed(value: boolean): boolean {
        this._coupling = true;
        try {
            return this._state.setCollapsed(value);
        } finally {
            // A throwing host must not leave every later collapse un-animated.
            this._coupling = false;
        }
    }

    /** Show or hide the sidebar — the animated, user-driven path. */
    setShowSidebar(value: boolean): boolean {
        return this._state.setShowSidebar(value);
    }

    /** Pin the sidebar so collapsing no longer hides it (`pin-sidebar`). */
    setPinSidebar(value: boolean): boolean {
        return this._state.setPinSidebar(value);
    }

    /** Move the sidebar to the other side. The widget re-declares its columns. */
    setSidebarPosition(position: AdwPackType): boolean {
        return this._state.setSidebarPosition(position);
    }

    /**
     * No-op: `Adw.OverlaySplitView` has no navigation stack, so which children
     * exist changes none of its state. Present so the two adapters share one seam.
     */
    setPaneMounted(_pane: SplitViewPane, _mounted: boolean): boolean {
        return false;
    }

    /** Tap on the scrim — hides the sidebar unconditionally. */
    dismissShield(): boolean {
        return this._state.dismissShield();
    }

    private _apply(change: OverlaySplitViewChange): void {
        const host = this._host;
        if (host === null) return;
        if (change.property === 'show-sidebar') {
            if (!this._coupling) host.transitionSidebar();
            host.notifyShowSidebar({ showSidebar: change.showSidebar, collapsed: change.collapsed });
            return;
        }
        if (change.property === 'collapsed') host.applyLayout();
    }
}

/**
 * `Adw.NavigationSplitView` bound to a NativeScript widget.
 *
 * This port spells the visible pane `showSidebar`, GTK spells it `show-content`;
 * they are each other's negation and the core owns the meaning, including the
 * ordering table (which pane is on top for a given `sidebar-position` ×
 * `show-content` × which children exist, and whether reaching it is a push or pop).
 *
 * Tags go through an explicit {@link setTag} rather than by handing the core a
 * `View`: a `View` is not a `NavigationPageRef`, and reading a `tag` property off
 * one would silently adopt whatever NativeScript happens to put there. Panes stay
 * tracked by presence with a marker object and the tag of record lives in the
 * core, because `setTag` CLEARS a colliding tag and mutating a caller's view to do
 * that would be a surprise.
 */
export class NsNavigationSplitViewState implements NsSplitViewState {
    private readonly _state: NavigationSplitViewState;
    /** Presence markers — one per pane, so mounting one never looks like the other. */
    private readonly _markers: Record<SplitViewPane, NavigationPageRef> = { sidebar: {}, content: {} };
    private _host: NsSplitViewHost | null = null;
    private _plan: NavigationStackPlan;

    constructor(
        options: {
            sidebarPosition?: AdwPackType;
            collapsed?: boolean;
            showContent?: boolean;
            /** Where a `g_critical` goes on this port. */
            onCritical?: (message: string) => void;
            /** Offer an unmatched `navigation.*` to the parent — how nesting forwards a push. */
            onDelegate?: (action: 'push' | 'pop', tag?: string) => boolean;
        } = {},
    ) {
        this._state = new NavigationSplitViewState(options);
        this._plan = this._state.stack;
        this._state.subscribe((change) => this._apply(change));
    }

    bind(host: NsSplitViewHost): void {
        this._host = host;
    }

    /**
     * Retag a mounted pane — `check_tags_cb`. On a collision the pane KEEPS its
     * page and loses the tag, which is a different failure from mounting a
     * colliding page (that one is refused outright). Returns whether the tag stuck.
     */
    setTag(pane: SplitViewPane, tag: string | null): boolean {
        return this._state.setTag(pane, tag);
    }

    /** The sidebar page's tag of record, or `null`. */
    get sidebarTag(): string | null {
        return this._state.sidebarTag;
    }

    /** The content page's tag of record, or `null`. */
    get contentTag(): string | null {
        return this._state.contentTag;
    }

    /** `navigation.push` with `tag`. */
    push(tag: string): NavigationActionResult {
        return this._state.push(tag);
    }

    /** `navigation.pop`. */
    pop(): NavigationActionResult {
        return this._state.pop();
    }

    /** `Adw.NavigationSplitView:show-content` — the negation of {@link showSidebar}. */
    get showContent(): boolean {
        return !this.showSidebar;
    }

    set showContent(value: boolean) {
        this.setShowSidebar(!value);
    }

    /** Whether the panes are stacked (one at a time) rather than side by side. */
    get collapsed(): boolean {
        return this._state.collapsed;
    }

    /** Whether the SIDEBAR is the visible pane — GTK's `show-content`, negated. */
    get showSidebar(): boolean {
        return !this._state.showContent;
    }

    /** Which side the sidebar is packed on. */
    get sidebarPosition(): AdwPackType {
        return this._state.sidebarPosition;
    }

    /** The settled navigation stack, root first. */
    get stack(): readonly SplitViewPane[] {
        return this._state.stack.stack;
    }

    /**
     * The pane on top of the stack — what a COLLAPSED view shows.
     *
     * Keyed on the stack, not on `showSidebar`: a LONE child stays visible whatever
     * `show-content` says, and keying on the flag alone renders a sidebar-only
     * split view blank.
     */
    get visiblePane(): SplitViewPane | null {
        return this._state.visiblePane;
    }

    /** Whether `pane` is the one a collapsed view shows. */
    isVisible(pane: SplitViewPane): boolean {
        return this.visiblePane === pane;
    }

    /**
     * How the last `show-content` change reached its stack: `push`, `pop`, or
     * `replace` for a structural rebuild NativeScript paints instantly.
     *
     * This is the animation DIRECTION, and it is not `showSidebar`: with
     * `sidebar-position: end` the content is the ROOT page, so showing it is a POP
     * and hiding it a PUSH — the reverse of `start`.
     */
    get transition(): NavigationStackPlan['transition'] {
        return this._plan.transition;
    }

    /** Collapse or expand. `Adw.NavigationSplitView` has no `show-content` coupling. */
    setCollapsed(value: boolean): boolean {
        return this._state.setCollapsed(value);
    }

    /** Show the sidebar (`true`) or the content (`false`) while collapsed. */
    setShowSidebar(value: boolean): boolean {
        return this._state.setShowContent(!value);
    }

    /** Move the sidebar to the other side. The widget re-declares its columns. */
    setSidebarPosition(position: AdwPackType): boolean {
        return this._state.setSidebarPosition(position);
    }

    /** Record that a pane was mounted or unmounted — it changes the stack. */
    setPaneMounted(pane: SplitViewPane, mounted: boolean): boolean {
        const page = mounted ? this._markers[pane] : null;
        return pane === 'sidebar' ? this._state.setSidebar(page) : this._state.setContent(page);
    }

    private _apply(change: NavigationSplitViewChange): void {
        this._plan = change.plan;
        const host = this._host;
        if (host === null) return;
        if (change.property === 'show-content') {
            // `replace` is a structural rebuild — an uncollapsed view, or one with a
            // lone child — and has no direction to animate.
            if (change.plan.transition === 'replace') host.applyLayout();
            else host.transitionSidebar();
            host.notifyShowSidebar({ showSidebar: this.showSidebar, collapsed: this.collapsed });
            return;
        }
        if (change.property === 'collapsed') host.applyLayout();
    }
}
