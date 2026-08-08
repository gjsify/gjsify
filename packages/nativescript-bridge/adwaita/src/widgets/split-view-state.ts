// Split-view state for the NativeScript split views — the pure half.
//
// `Adw.OverlaySplitView` and `Adw.NavigationSplitView` are not two flags and a
// layout: `collapsed`, `show-sidebar`/`show-content` and `pin-sidebar` form ONE
// state machine per widget, and both machines already live headless in
// `@gjsify/adwaita-core` (ADR 0004). The NativeScript port re-derived them from
// `_collapsed` and `_showSidebar` alone and got four rules wrong:
//
//   - collapsing did NOT hide an unpinned sidebar
//     (`if (!self->pin_sidebar) set_show_sidebar (self, !self->collapsed, FALSE, 0);`,
//     adw-overlay-split-view.c:1457-1458), so on a phone the overlay and its scrim
//     covered the content the instant the breakpoint fired. Both storybooks
//     hand-rolled the coupling next to their own breakpoint code;
//   - there was no `pin-sidebar` property to suppress it (:990-992);
//   - the off-screen pane stayed keyboard- and screen-reader-reachable, where GTK
//     drops `can-focus` on it (:330-331, :1460-1461);
//   - a collapsed navigation split view keyed its visible pane on `show-content`
//     alone, so a view holding ONLY a sidebar rendered blank — the C keeps a LONE
//     child visible (`self->content && (self->show_content || !self->sidebar)` and
//     its mirror, adw-navigation-split-view.c:389-401) — and with
//     `sidebar-position: end` it animated the swap BACKWARDS, because there
//     showing the content is a POP and hiding it a PUSH (:1414-1428).
//
// This module is deliberately FREE of `@nativescript/core` value imports — like
// `navigation-stack.ts`, `split-view-width.ts` and `row-press.ts` — so the spec
// suite can exercise the real adapter off-device. `split-view-base.ts` cannot
// serve that role: it `extends GridLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable on GJS/Node.
// The suite that stood in for it before this split asserted against a
// `MockSplitView` that reimplemented the setters — so it could only ever confirm
// that the mock agreed with itself, and every rule above went untested for the
// widgets' whole life.
//
// TEXT DIRECTION is real here now. It used to be pinned to `'ltr'` with a note
// saying "NativeScript surfaces no text direction to read" — which is false:
// `@nativescript/core` ships `directionProperty`, an INHERITED CSS property on
// `Style` (`ui/styling/style-properties`), valued `'ltr' | 'rtl'` and defaulting
// to unset. So `view.style.direction ?? 'ltr'` is the direction, it inherits
// from the Page the way GTK's inherits from the window, and
// `isSidebarAtVisualStart` can finally do its job: under RTL a `start` sidebar
// is drawn on the RIGHT (`get_start_or_end`, adw-overlay-split-view.c:227-234).
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
    /** Whether the sidebar is meant to be shown. */
    showSidebar: boolean;
    /** Whether the view is in its collapsed (narrow) mode. */
    collapsed: boolean;
}

/**
 * The NativeScript side of a split view: what a state change makes it do.
 *
 * Only the changes with real ordering or animation semantics come through here.
 * Structural mutations (mounting a pane, moving the sidebar to the other side)
 * stay the widget's own business, because they also have to re-declare the grid
 * columns — a callback would only be able to run after that anyway.
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
    /** Whether the sidebar is meant to be shown. */
    readonly showSidebar: boolean;
    /** Which side the sidebar is packed on. */
    readonly sidebarPosition: AdwPackType;
    /** Attach the widget. Called exactly once, from the base constructor. */
    bind(host: NsSplitViewHost): void;
    /** Collapse or expand. Returns whether it changed. */
    setCollapsed(value: boolean): boolean;
    /** Show or hide the sidebar. Returns whether it changed. */
    setShowSidebar(value: boolean): boolean;
    /** Move the sidebar to the other side. Returns whether it changed. */
    setSidebarPosition(position: AdwPackType): boolean;
    /** Record that a pane was mounted or unmounted. Returns whether it changed. */
    setPaneMounted(pane: SplitViewPane, mounted: boolean): boolean;
}

/**
 * Which of the two grid columns each pane takes.
 *
 * `AdwSplitViewBase._syncColumns` makes the SIDEBAR's column the fixed (`'auto'`)
 * one and the content's the expanding (`'star'`) one, ordered by
 * `sidebar-position`. So a pane placed in the wrong column is not merely
 * mirrored — it also swaps its sizing mode, which is what made an
 * `end`-positioned navigation split view fully inverted: it wrote the sidebar
 * into column 0 and the content into column 1 unconditionally, while the base had
 * already made column 0 the star column. libadwaita allocates an `end` sidebar at
 * `width - sidebar_width` (adw-navigation-split-view.c:306-316).
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
 * `Adw.OverlaySplitView` bound to a NativeScript widget.
 *
 * Holds an `OverlaySplitViewState` and turns its notifications into the two
 * things NativeScript can do: re-lay the panes out, or animate the reveal. The
 * widget keeps ZERO split-view state.
 *
 * The reveal itself is NOT driven from here. NativeScript animates with a native
 * `View.animate()` on `translateX`/`opacity`, not by sampling a progress value,
 * so the core's `SplitViewAnimator` seam stays on its instant default and
 * `show-progress` settles at 0 or 1 — which is also what a renderer without a
 * spring gets from `adw_animation_skip`.
 */
export class NsOverlaySplitViewState implements NsSplitViewState {
    private readonly _state: OverlaySplitViewState;
    private _host: NsSplitViewHost | null = null;
    /**
     * True while {@link setCollapsed} runs. The `show-sidebar` flip it couples is
     * STRUCTURAL, not a user toggle: `set_collapsed` passes `animate = FALSE`
     * (adw-overlay-split-view.c:1457-1458) and the `collapsed` notification right
     * behind it re-lays the whole view out anyway.
     */
    private _coupling = false;

    constructor(options: OverlaySplitViewOptions = {}) {
        this._state = new OverlaySplitViewState(options);
        this._state.subscribe((change) => this._apply(change));
    }

    bind(host: NsSplitViewHost): void {
        this._host = host;
    }

    // --- Read-only derivations ---

    /** Whether the sidebar overlays the content instead of sitting beside it. */
    get collapsed(): boolean {
        return this._state.collapsed;
    }

    /** Whether the sidebar is meant to be shown. */
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

    /** Whether the tap-to-dismiss scrim takes input — `update_shield` (:249-256). */
    get shieldVisible(): boolean {
        return this._state.shieldVisible;
    }

    /**
     * Whether the SIDEBAR pane may take focus — `gtk_widget_set_can_focus
     * (sidebar_bin, !collapsed || show_sidebar)` (:330, :1460).
     *
     * NativeScript's equivalent is `isUserInteractionEnabled` (the precedent is
     * the decorative bottom-sheet handle, adw-bottom-sheet.c:1198). Without it the
     * pane hidden behind the overlay keeps answering taps and stays in the
     * screen-reader order.
     */
    get sidebarFocusable(): boolean {
        return this._state.sidebarFocusable;
    }

    /** Whether the CONTENT pane may take focus — the mirror of {@link sidebarFocusable} (:331, :1461). */
    get contentFocusable(): boolean {
        return this._state.contentFocusable;
    }

    // --- Mutators ---

    /**
     * Collapse or expand. Unless the sidebar is pinned this also flips
     * `show-sidebar` to match, notifying it FIRST — GTK freezes notifications
     * across the whole setter and thaws them in queue order
     * (adw-overlay-split-view.c:1449-1483).
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

    /** Pin the sidebar so collapsing no longer hides it (`pin-sidebar`, :990-992). */
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

    /** Tap on the scrim — `released_cb` (:431-439) hides the sidebar unconditionally. */
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
 * NativeScript spells the visible pane as `showSidebar`, GTK as `show-content`;
 * they are each other's negation and the core owns the meaning. What the core
 * adds is the whole ordering table: which pane is on top for a given
 * `sidebar-position` × `show-content` × which children exist, and whether
 * reaching it is a push or a pop.
 *
 * Tags and the `navigation.push`/`navigation.pop` actions ARE wired, through an
 * explicit {@link setTag} rather than by handing the core a `View`: a `View` is
 * not a `NavigationPageRef`, and reading a `tag` property off one would silently
 * adopt whatever NativeScript happens to put there. The panes stay tracked by
 * presence with a marker object, and the tag of record lives in the core — which
 * is where it lives in the browser port too, because `setTag` CLEARS a colliding
 * tag and mutating a caller's view to do that would be a surprise.
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
     * Retag a mounted pane — `check_tags_cb` (adw-navigation-split-view.c:431-460).
     *
     * On a collision the pane KEEPS its page and loses the tag, which is a
     * different failure from mounting a colliding page (that one is refused
     * outright). Returns whether the tag stuck.
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

    /** `navigation.push` with `tag` — `navigation_push_cb` (:644-685). */
    push(tag: string): NavigationActionResult {
        return this._state.push(tag);
    }

    /** `navigation.pop` — `navigation_pop_cb` (:687-702). */
    pop(): NavigationActionResult {
        return this._state.pop();
    }

    /**
     * `Adw.NavigationSplitView:show-content` under ITS OWN NAME.
     *
     * This port spells the visible pane `showSidebar`, which is the negation —
     * and that costs every consumer a `!(…)`, including the storybook, which
     * carries one purely to bind a shared story arg. Both spellings are here now
     * and neither is derived from a second copy of the flag.
     */
    get showContent(): boolean {
        return !this.showSidebar;
    }

    set showContent(value: boolean) {
        this.setShowSidebar(!value);
    }

    // --- Read-only derivations ---

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
     * Keyed on the stack, not on `showSidebar`: a LONE child stays visible
     * whatever `show-content` says (adw-navigation-split-view.c:389-401), and
     * keying on the flag alone is what rendered a sidebar-only split view blank.
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
     * `replace` for a structural rebuild that NativeScript paints instantly.
     *
     * This is the animation DIRECTION, and it is not `showSidebar`: with
     * `sidebar-position: end` the content is the ROOT page, so showing it is a POP
     * and hiding it a PUSH — the reverse of `start` (:1414-1428). Taking the
     * direction from the flag ran an `end`-positioned swap backwards.
     */
    get transition(): NavigationStackPlan['transition'] {
        return this._plan.transition;
    }

    // --- Mutators ---

    /** Collapse or expand. `Adw.NavigationSplitView` has no `show-content` coupling (:1341-1353). */
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
