// Adwaita split views — headless (ADR 0004).
//
// `Adw.NavigationSplitView` and `Adw.OverlaySplitView` are 3.5k lines of C, but
// almost none of it is rendering. What they actually are is (a) a sidebar-width
// derivation that exists in FOUR subtly different variants, (b) a navigation-stack
// ordering table keyed on sidebar-position × show-content × which children exist,
// (c) a duplicate-tag guard plus the `navigation.push`/`navigation.pop` routing,
// (d) the collapse↔show-sidebar coupling gated by `pin-sidebar`, and (e) a
// continuous show-progress model with swipe gating and snap points. All of it is
// integer arithmetic and state, so all of it lives here and both renderers share
// one answer — the vectors in `conformance/split-view.ts` are what holds them to it.
//
// This module is PLATFORM-NEUTRAL: it renders nothing, reads no globals and never
// touches a real timer. The overlay's reveal spring is an injected
// {@link SplitViewAnimator} (the ToastScheduler precedent); core ships an instant
// default so the state machine stays deterministic and timer-free.
//
// FOUR sharp edges a straightforward TS port gets wrong, each pinned by a vector:
//   - GLib's `CLAMP` tests HIGH first, so with INVERTED bounds it is NOT
//     `Math.min(max, Math.max(min, x))`. The navigation allocate path reaches
//     inverted bounds whenever `width - contentMin < minSidebarWidth`.
//   - the navigation widget caps the sidebar MAX BOUND by `width - contentMin`
//     while the overlay caps the RESULT — different answers for identical input.
//   - `(int)` truncates toward zero: `Math.trunc`, never `Math.floor`, and never a
//     CSS percentage (which is fractional).
//   - the length-unit conversion is CEILed in the allocate paths and TRUNCATED in
//     the measure paths — a real 1px asymmetry at dpi ≠ 96.
//
// Reference: refs/libadwaita/src/adw-navigation-split-view.c
// Reference: refs/libadwaita/src/adw-overlay-split-view.c
// Reference: refs/libadwaita/src/adw-length-unit.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { glibClamp } from './glib.js';
import { type AdwLengthUnit, adwLengthToPx, DEFAULT_DPI } from './length-unit.js';

// --- Units, direction, packing ---

/** `GtkPackType` — which side of the view a pane is packed on. */
export type AdwPackType = 'start' | 'end';

/** `GtkTextDirection` — the reading direction `start`/`end` are resolved against. */
export type AdwTextDirection = 'ltr' | 'rtl';

/** `min-sidebar-width` default, in {@link DEFAULT_SIDEBAR_WIDTH_UNIT}. */
export const DEFAULT_MIN_SIDEBAR_WIDTH = 180;

/** `max-sidebar-width` default, in {@link DEFAULT_SIDEBAR_WIDTH_UNIT}. */
export const DEFAULT_MAX_SIDEBAR_WIDTH = 280;

/** `sidebar-width-fraction` default — a quarter of the total width. */
export const DEFAULT_SIDEBAR_WIDTH_FRACTION = 0.25;

/** `sidebar-width-unit` default. Both widgets default to scale-independent pixels. */
export const DEFAULT_SIDEBAR_WIDTH_UNIT: AdwLengthUnit = 'sp';

/** The minimum grabbable edge width for the reveal gesture — `ADW_SWIPE_BORDER`. */
export const ADW_SWIPE_BORDER = 32;

/**
 * GLib's `CLAMP` (gmacros.h) — `x > high ? high : x < low ? low : x`.
 *
 * HIGH is tested FIRST, which only matters when the bounds are inverted
 * (`low > high`) — there GLib returns `low` for anything below it, where
 * `Math.min(high, Math.max(low, x))` returns `high`. Not a curiosity:
 * `allocate_uncollapsed` (adw-navigation-split-view.c:297-304) inverts the bounds
 * whenever the content pane's own minimum leaves less room than
 * `min-sidebar-width`, and libadwaita then keeps the sidebar at its minimum and
 * lets the content overflow.
 */

/**
 * Whether the sidebar is laid out at `x = 0`, i.e. `sidebar_position ==
 * get_start_or_end (self)` (adw-navigation-split-view.c:220-227,
 * adw-overlay-split-view.c:227-234).
 *
 * `start`/`end` are LOGICAL: under RTL `get_start_or_end` returns `GTK_PACK_END`,
 * so a `start` sidebar is drawn on the RIGHT. This one predicate drives pane
 * placement, the overlay's slide direction and the swipe area — neither renderer
 * mirrored any of them before.
 */
export function isSidebarAtVisualStart(position: AdwPackType, direction: AdwTextDirection = 'ltr'): boolean {
    return (position === 'start') === (direction !== 'rtl');
}

// --- Sidebar sizing ---

/** The four sizing properties `Adw.NavigationSplitView` and `Adw.OverlaySplitView` share. */
export interface SidebarWidthSpec {
    /** `min-sidebar-width`, in {@link sidebarWidthUnit}. Default 180. */
    minSidebarWidth?: number;
    /** `max-sidebar-width`, in {@link sidebarWidthUnit}. Default 280. */
    maxSidebarWidth?: number;
    /** `sidebar-width-fraction` of the total width. Default 0.25. */
    sidebarWidthFraction?: number;
    /** `sidebar-width-unit`. Default `'sp'`. */
    sidebarWidthUnit?: AdwLengthUnit;
    /** The `gtk-xft-dpi` a renderer reports, for `pt`/`sp`. Default 96. */
    dpi?: number;
}

/** The resolved pixel bounds a sidebar width is clamped into. */
export interface SidebarBounds {
    /** Lower bound: the larger of the sidebar child's own minimum and `min-sidebar-width`. */
    min: number;
    /** Upper bound: never below {@link min} — `max-sidebar-width` is raised to it. */
    max: number;
}

function fractionOf(spec: SidebarWidthSpec): number {
    return spec.sidebarWidthFraction ?? DEFAULT_SIDEBAR_WIDTH_FRACTION;
}

/**
 * `sidebar_min` / `sidebar_max` in pixels, i.e. the two `MAX (…, length_to_px (…))`
 * lines both widgets open their sizing with.
 *
 * `ceil: true` reproduces the ALLOCATE paths, which wrap the conversion in `ceil()`
 * (adw-navigation-split-view.c:292-300, adw-overlay-split-view.c:452-460);
 * `ceil: false` (the default) reproduces the MEASURE paths, which assign the raw
 * double to an `int` and therefore truncate (adw-navigation-split-view.c:251-256,
 * adw-overlay-split-view.c:545-550). At dpi ≠ 96 the two disagree by a pixel, and
 * that is upstream behaviour, not rounding noise.
 *
 * `max` is raised to `min` BEFORE any other cap, so a `max-sidebar-width` below
 * `min-sidebar-width` is silently widened rather than inverting the range here.
 */
export function resolveSidebarBounds(
    spec: SidebarWidthSpec,
    sidebarChildMin = 0,
    options: { ceil?: boolean } = {},
): SidebarBounds {
    const unit = spec.sidebarWidthUnit ?? DEFAULT_SIDEBAR_WIDTH_UNIT;
    const dpi = spec.dpi ?? DEFAULT_DPI;
    const round = options.ceil ? Math.ceil : Math.trunc;
    const minPx = adwLengthToPx(unit, spec.minSidebarWidth ?? DEFAULT_MIN_SIDEBAR_WIDTH, dpi);
    const maxPx = adwLengthToPx(unit, spec.maxSidebarWidth ?? DEFAULT_MAX_SIDEBAR_WIDTH, dpi);
    const min = round(Math.max(sidebarChildMin, minPx));
    return { min, max: round(Math.max(min, maxPx)) };
}

/**
 * The sidebar's NATURAL width, estimated from the content's natural width and the
 * fraction — `ceil (content_nat * f / (1 - f))`, clamped into `bounds`
 * (adw-navigation-split-view.c:260-262, adw-overlay-split-view.c:554-556).
 *
 * The sidebar's OWN natural width is deliberately ignored: a sidebar asks for the
 * share of the window the fraction promises it, not for however wide its widest row
 * happens to be.
 *
 * DELIBERATE DEVIATION: the pspec permits `fraction == 1` (range `[0, 1]`), where C
 * divides by zero and the `ceil()`→`int` conversion is undefined. The limit is +∞,
 * which the clamp pins to `max`, so that is returned directly rather than
 * reproducing undefined behaviour.
 */
export function resolveNaturalSidebarWidth(contentNatural: number, bounds: SidebarBounds, fraction: number): number {
    if (fraction >= 1) return bounds.max;
    return glibClamp(Math.ceil((contentNatural * fraction) / (1 - fraction)), bounds.min, bounds.max);
}

/** Input to {@link resolveNavigationSidebarWidth} / {@link resolveOverlaySidebarWidth}. */
export interface SidebarWidthInput extends SidebarWidthSpec {
    /** The width the split view itself was allocated. */
    totalWidth: number;
    /** The content pane's own minimum width. Default 0. */
    contentMin?: number;
    /** The sidebar child's own minimum width. Default 0. */
    sidebarChildMin?: number;
}

/**
 * `Adw.NavigationSplitView`'s allocated sidebar width
 * (adw-navigation-split-view.c:292-304).
 *
 * The content pane's minimum is protected by capping the MAX BOUND
 * (`sidebar_max = MIN (sidebar_max, width - content_min)`) and only then clamping.
 * When that cap falls below `min`, the bounds invert and {@link glibClamp} keeps the
 * sidebar at its minimum — see the 300px vector, where this returns 180 and
 * {@link resolveOverlaySidebarWidth} returns 100 for the same input.
 */
export function resolveNavigationSidebarWidth(input: SidebarWidthInput): number {
    const bounds = resolveSidebarBounds(input, input.sidebarChildMin ?? 0, { ceil: true });
    const max = Math.min(bounds.max, input.totalWidth - (input.contentMin ?? 0));
    return glibClamp(Math.trunc(input.totalWidth * fractionOf(input)), bounds.min, max);
}

/**
 * `Adw.OverlaySplitView`'s allocated sidebar width — `get_sidebar_width`
 * (adw-overlay-split-view.c:441-466) plus `allocate_uncollapsed`'s cap
 * (adw-overlay-split-view.c:585).
 *
 * Two differences from the navigation widget, both load-bearing:
 *   - COLLAPSED the fraction is IGNORED and the VIEW width is clamped instead, so
 *     an overlay sidebar keeps its natural size on a phone rather than shrinking to
 *     a quarter of it (and may legitimately end up WIDER than the view);
 *   - uncollapsed the content-minimum cap lands on the RESULT, not on the bound.
 */
export function resolveOverlaySidebarWidth(input: SidebarWidthInput & { collapsed?: boolean }): number {
    const bounds = resolveSidebarBounds(input, input.sidebarChildMin ?? 0, { ceil: true });
    if (input.collapsed) return glibClamp(input.totalWidth, bounds.min, bounds.max);
    const width = glibClamp(Math.trunc(input.totalWidth * fractionOf(input)), bounds.min, bounds.max);
    return Math.min(width, input.totalWidth - (input.contentMin ?? 0));
}

/** Input to {@link measureSplitViewHorizontal}. */
export interface SplitViewMeasureInput {
    /** Bounds from {@link resolveSidebarBounds} — MEASURE flavour (`ceil: false`). */
    bounds: SidebarBounds;
    /** The sidebar's natural width from {@link resolveNaturalSidebarWidth}. */
    sidebarNatural: number;
    /** The content pane's own minimum width. */
    contentMin: number;
    /** The content pane's own natural width. */
    contentNatural: number;
    /** The overlay's reveal progress. Default 1, which reduces to the navigation rule. */
    showProgress?: number;
}

/**
 * The horizontal size request of an uncollapsed split view —
 * `measure_uncollapsed` (adw-overlay-split-view.c:558-563; the navigation variant
 * at adw-navigation-split-view.c:264-267 is the same rule with progress pinned to 1).
 *
 * This is the container MINIMUM neither renderer had, and its absence is why their
 * content pane can be squeezed to nothing: the sidebar is `flex-shrink: 0` (web) or
 * sits in an `auto` column (NativeScript), so it always wins and the content
 * collapses. Feeding this number into the host's own minimum makes the split view
 * refuse to be narrower than sidebar + content instead.
 */
export function measureSplitViewHorizontal(input: SplitViewMeasureInput): { minimum: number; natural: number } {
    const progress = glibClamp(input.showProgress ?? 1, 0, 1);
    return {
        minimum: Math.trunc(input.bounds.min * progress) + input.contentMin,
        natural: Math.trunc(input.sidebarNatural * progress) + input.contentNatural,
    };
}

// --- Pane geometry ---

/** One pane's horizontal placement, in pixels from the view's left edge. */
export interface SplitViewPaneRect {
    /** Offset from the view's LEFT edge — negative while a sidebar is slid out. */
    x: number;
    /** Allocated width. */
    width: number;
}

/** The two pane rects of an uncollapsed `Adw.NavigationSplitView`. */
export interface NavigationSplitViewLayout {
    /** The sidebar pane. */
    sidebar: SplitViewPaneRect;
    /** The content pane. */
    content: SplitViewPaneRect;
}

/**
 * `allocate_uncollapsed` (adw-navigation-split-view.c:306-316) — the two pane rects,
 * including the RTL mirror that neither renderer had.
 */
export function layoutNavigationSplitView(input: {
    totalWidth: number;
    sidebarWidth: number;
    sidebarPosition?: AdwPackType;
    direction?: AdwTextDirection;
}): NavigationSplitViewLayout {
    const { totalWidth, sidebarWidth } = input;
    const contentWidth = totalWidth - sidebarWidth;
    if (isSidebarAtVisualStart(input.sidebarPosition ?? 'start', input.direction ?? 'ltr')) {
        return { sidebar: { x: 0, width: sidebarWidth }, content: { x: sidebarWidth, width: contentWidth } };
    }
    return { sidebar: { x: contentWidth, width: sidebarWidth }, content: { x: 0, width: contentWidth } };
}

/** The full paint state of an `Adw.OverlaySplitView` allocation. */
export interface OverlaySplitViewLayout {
    /** The sidebar pane. May be wider than `sidebarWidth` while overshooting. */
    sidebar: SplitViewPaneRect;
    /** The content pane. Fills the whole view when collapsed. */
    content: SplitViewPaneRect;
    /** Whether the click-outside shield takes input — `collapsed && progress > 0`. */
    shieldVisible: boolean;
    /** Whether the sidebar is painted at all — `progress > 0` (snapshot gate). */
    sidebarPainted: boolean;
    /** Shadow-helper progress: **1 = no shadow**, 0 = fully shadowed. */
    shadowProgress: number;
    /** Which edge the shadow is cast from (`GTK_PAN_DIRECTION_LEFT`/`RIGHT`). */
    shadowSide: 'left' | 'right';
}

/**
 * `allocate_uncollapsed` (adw-overlay-split-view.c:572-610) and
 * `allocate_collapsed` (:653-703), plus the shield (`update_shield`, :249-256) and
 * the paint gate (`adw_overlay_split_view_snapshot`, :757).
 *
 * The overshoot swap is the subtle part: the swipe tracker enables UPPER overshoot
 * (:1121), so `showProgress` can exceed 1. When the offset then runs past the
 * measured width, libadwaita WIDENS the pane to the offset and pins the offset to
 * the measured width — the sidebar stretches instead of detaching from its edge.
 *
 * `shadowProgress` is inverted relative to the reveal: `adw_shadow_helper` hides
 * the shadow at 1 and paints it fully at 0 (adw-shadow-helper.c:234-249). It is only
 * ALLOCATED in the collapsed layout, and `set_collapsed(FALSE)` re-allocates it at 1
 * (adw-overlay-split-view.c:1466-1477) — which is exactly what the formula returns
 * for an uncollapsed view, so a renderer can apply it unconditionally.
 */
export function layoutOverlaySplitView(input: {
    totalWidth: number;
    sidebarWidth: number;
    showProgress: number;
    collapsed: boolean;
    sidebarPosition?: AdwPackType;
    direction?: AdwTextDirection;
}): OverlaySplitViewLayout {
    const { totalWidth, showProgress, collapsed } = input;
    const measured = input.sidebarWidth;
    const atStart = isSidebarAtVisualStart(input.sidebarPosition ?? 'start', input.direction ?? 'ltr');

    let paneWidth = measured;
    let offset = Math.trunc(measured * showProgress);
    const overshoot = offset > measured;

    const common = {
        shieldVisible: collapsed && showProgress > 0,
        sidebarPainted: showProgress > 0,
        shadowProgress: 1 - Math.min(showProgress, collapsed ? 1 : 0),
        shadowSide: (atStart ? 'left' : 'right') as 'left' | 'right',
    };

    if (collapsed) {
        // The content always fills the view; the sidebar floats above it.
        if (overshoot) paneWidth = offset;
        const x = atStart ? (overshoot ? 0 : offset - measured) : totalWidth - offset;
        return { sidebar: { x, width: paneWidth }, content: { x: 0, width: totalWidth }, ...common };
    }

    if (overshoot) {
        paneWidth = offset;
        offset = measured;
    }
    if (atStart) {
        return {
            sidebar: { x: offset - measured, width: paneWidth },
            content: { x: offset, width: totalWidth - offset },
            ...common,
        };
    }
    return {
        sidebar: { x: totalWidth - (overshoot ? paneWidth : offset), width: paneWidth },
        content: { x: 0, width: totalWidth - offset },
        ...common,
    };
}

// --- Navigation split view: tags, stack, actions ---

/**
 * `tags_equal` (adw-navigation-split-view.c:413-429) — whether the sidebar and
 * content pages collide on their `Adw.NavigationPage:tag`.
 *
 * Two rules a `a === b` port loses: an ABSENT tag never collides (so two untagged
 * pages are fine), but two EMPTY-STRING tags DO. The comparison is `strcmp`, i.e.
 * byte-exact — no case folding and no Unicode normalisation, so a precomposed and a
 * decomposed `Ü` are different tags.
 *
 * A missing PAGE is passed as `null`, which lands on the same "no tag" answer the C
 * gives for a missing page.
 */
export function tagsConflict(sidebarTag: string | null | undefined, contentTag: string | null | undefined): boolean {
    if (sidebarTag === null || sidebarTag === undefined) return false;
    if (contentTag === null || contentTag === undefined) return false;
    return sidebarTag === contentTag;
}

/** Which of the two panes a stack entry or transition refers to. */
export type SplitViewPane = 'sidebar' | 'content';

/** What `update_navigation_stack` does to the underlying `Adw.NavigationView`. */
export interface NavigationStackPlan {
    /** The pages in the navigation view, root first. The LAST one is visible. */
    stack: SplitViewPane[];
    /** `replace` for a structural rebuild; `push`/`pop` for an animated page change. */
    transition: 'replace' | 'push' | 'pop';
    /** The page being pushed or popped, or `null` for a `replace`. */
    page: SplitViewPane | null;
}

/**
 * `update_navigation_stack` (adw-navigation-split-view.c:342-405) — the whole
 * ordering table.
 *
 * Two rules both renderers were missing. A LONE child stays visible no matter what
 * `show-content` says (`self->content && (self->show_content || !self->sidebar)`
 * and its mirror, :389-401) — without it a collapsed split view with only a sidebar
 * renders blank. And with `sidebar-position: end` the CONTENT is the root page, so
 * `show-content: false` means the sidebar is PUSHED ON TOP of the content rather
 * than replacing it.
 *
 * `changingPage` selects the animated branch (:351-387), which requires BOTH
 * children. Its final stack is always identical to the static branch's — it differs
 * only in reaching that stack by a push or a pop, which is the direction a renderer
 * needs for its transition.
 */
export function resolveNavigationStack(input: {
    hasSidebar: boolean;
    hasContent: boolean;
    sidebarPosition: AdwPackType;
    showContent: boolean;
    changingPage?: boolean;
}): NavigationStackPlan {
    const { hasSidebar, hasContent, showContent } = input;
    const sidebarLast = input.sidebarPosition === 'end';

    if (input.changingPage && hasSidebar && hasContent) {
        if (showContent) {
            return sidebarLast
                ? { stack: ['content'], transition: 'pop', page: 'sidebar' }
                : { stack: ['sidebar', 'content'], transition: 'push', page: 'content' };
        }
        return sidebarLast
            ? { stack: ['content', 'sidebar'], transition: 'push', page: 'sidebar' }
            : { stack: ['sidebar'], transition: 'pop', page: 'content' };
    }

    const stack: SplitViewPane[] = [];
    if (sidebarLast) {
        if (hasContent) stack.push('content');
        if (hasSidebar && (!showContent || !hasContent)) stack.push('sidebar');
    } else {
        if (hasSidebar) stack.push('sidebar');
        if (hasContent && (showContent || !hasSidebar)) stack.push('content');
    }
    return { stack, transition: 'replace', page: null };
}

/** What the `navigation.push` / `navigation.pop` actions resolve to. */
export type NavigationActionResult =
    /** Flip `show-content` — the tag named a pane of THIS split view. */
    | { kind: 'set-show-content'; showContent: boolean }
    /** `g_critical`: the tag is already in the stack, so pushing it is a bug. */
    | { kind: 'already-in-stack'; tag: string }
    /** `g_critical`: no pane carries this tag and no ancestor handled it either. */
    | { kind: 'not-found'; tag: string }
    /** Hand the action to the parent widget — an ancestor may own the tag. */
    | { kind: 'delegate' };

/** A `navigation.push` / `navigation.pop` activation, as data. */
export type NavigationActionInput =
    | {
          action: 'push';
          /** The tag the action names. */
          tag: string;
          /** The sidebar page's tag, or `null` when it has none / there is no sidebar. */
          sidebarTag?: string | null;
          /** The content page's tag, or `null` when it has none / there is no content. */
          contentTag?: string | null;
          showContent: boolean;
          collapsed: boolean;
      }
    | { action: 'pop'; hasSidebar: boolean; hasContent: boolean; showContent: boolean };

/**
 * `navigation_push_cb` (adw-navigation-split-view.c:644-685) and
 * `navigation_pop_cb` (:687-702) — the action routing both renderers lack entirely.
 *
 * Three details the shape hides. The CONTENT tag is tested first, so a split view
 * whose panes share a tag pushes the content. The "already in the navigation stack"
 * critical fires for a content-tag push only when `show_content && collapsed` —
 * uncollapsed both panes are on screen, so re-pushing is a harmless no-op set. And
 * an unmatched tag DELEGATES to the parent before it may become a critical, which
 * is how nested split views forward a push outwards.
 *
 * Whether a page is absent or merely untagged makes no difference here: the action
 * always carries a real string, and `g_strcmp0` never matches it against `NULL`.
 */
export function resolveNavigationAction(input: NavigationActionInput): NavigationActionResult {
    if (input.action === 'pop') {
        if (input.showContent && input.hasSidebar && input.hasContent) {
            return { kind: 'set-show-content', showContent: false };
        }
        return { kind: 'delegate' };
    }

    const { tag } = input;
    if (input.contentTag !== null && input.contentTag !== undefined && tag === input.contentTag) {
        if (input.showContent && input.collapsed) return { kind: 'already-in-stack', tag };
        return { kind: 'set-show-content', showContent: true };
    }
    if (input.sidebarTag !== null && input.sidebarTag !== undefined && tag === input.sidebarTag) {
        return { kind: 'already-in-stack', tag };
    }
    return { kind: 'delegate' };
}

/** `g_critical` texts, verbatim from the C so a renderer's diagnostics match GTK's. */
export const NAVIGATION_SPLIT_VIEW_CRITICALS = {
    /** `navigation_push_cb` :657 / :672. */
    alreadyInStack: (tag: string) => `Page with the tag '${tag}' is already in the navigation stack`,
    /** `navigation_push_cb` :683. The C also prints the widget pointer, which has no meaning here. */
    notFound: (tag: string) => `No page with the tag '${tag}' found in AdwNavigationSplitView`,
    /** `adw_navigation_split_view_set_sidebar` :1103. */
    sidebarCollision: (tag: string) =>
        `Trying to add sidebar with the tag '${tag}' to AdwNavigationSplitView, but content already has the same tag`,
    /** `adw_navigation_split_view_set_content` :1196. */
    contentCollision: (tag: string) =>
        `Trying to add content with the tag '${tag}' to AdwNavigationSplitView, but sidebar already has the same tag`,
    /** `check_tags_cb` :440. */
    sidebarTagCollision: (tag: string) =>
        `Trying to set the sidebar's tag to '${tag}', but the content already has the same tag`,
    /** `check_tags_cb` :450. */
    contentTagCollision: (tag: string) =>
        `Trying to set the content's tag to '${tag}', but the sidebar already has the same tag`,
} as const;

/** A page mounted into a split-view pane. Only its tag is behaviour-relevant. */
export interface NavigationPageRef {
    /** `Adw.NavigationPage:tag`, or `null`/absent when untagged. */
    tag?: string | null;
}

/** Which property a {@link NavigationSplitViewState} change reports. */
export type NavigationSplitViewProperty = 'sidebar' | 'content' | 'sidebar-position' | 'collapsed' | 'show-content';

/** Payload of a {@link NavigationSplitViewState} change. */
export interface NavigationSplitViewChange {
    /** The GObject property that changed — the `notify::<property>` to re-emit. */
    property: NavigationSplitViewProperty;
    /** True for a user-driven `show-content` change (a row tap, a back button). */
    interactive: boolean;
    /** What the renderer should do now: the settled stack plus push/pop direction. */
    plan: NavigationStackPlan;
}

/** Subscriber for {@link NavigationSplitViewState} changes. */
export type NavigationSplitViewListener = (change: NavigationSplitViewChange) => void;

/** Diagnostics seam — a renderer routes these to `console.error` / `g_critical`. */
export interface NavigationSplitViewHandlers {
    /** Called with a fully-formatted {@link NAVIGATION_SPLIT_VIEW_CRITICALS} message. */
    onCritical?: (message: string) => void;
    /** Offer an unmatched `navigation.push`/`pop` to the parent. Return whether it was handled. */
    onDelegate?: (action: 'push' | 'pop', tag?: string) => boolean;
}

/** Construction options for {@link NavigationSplitViewState}. */
export interface NavigationSplitViewOptions extends NavigationSplitViewHandlers {
    sidebarPosition?: AdwPackType;
    collapsed?: boolean;
    showContent?: boolean;
}

/**
 * `Adw.NavigationSplitView`'s state machine: which pane is visible, the duplicate-tag
 * guard and the `navigation.*` action routing.
 *
 * The tag guard has TWO different failure modes and both matter. Mounting a page
 * whose tag already belongs to the other pane REFUSES THE ASSIGNMENT
 * (adw-navigation-split-view.c:1102-1108 / :1195-1201) — the pane keeps whatever it
 * had. RETAGGING a mounted page instead keeps the page and CLEARS the offending tag
 * (`check_tags_cb`, :431-460), because by then the page is already installed.
 *
 * Tags are held HERE, not written back into the {@link NavigationPageRef} you hand
 * in: {@link setTag} resets a colliding tag, and silently mutating a caller's object
 * to do it would be a surprise. Read {@link sidebarTag} / {@link contentTag} back.
 */
export class NavigationSplitViewState {
    private _sidebar: NavigationPageRef | null = null;
    private _content: NavigationPageRef | null = null;
    private _sidebarTag: string | null = null;
    private _contentTag: string | null = null;
    private _sidebarPosition: AdwPackType;
    private _collapsed: boolean;
    private _showContent: boolean;
    private readonly _handlers: NavigationSplitViewHandlers;
    private readonly _listeners = new Set<NavigationSplitViewListener>();

    constructor(options: NavigationSplitViewOptions = {}) {
        this._sidebarPosition = options.sidebarPosition ?? 'start';
        this._collapsed = options.collapsed ?? false;
        this._showContent = options.showContent ?? false;
        this._handlers = { onCritical: options.onCritical, onDelegate: options.onDelegate };
    }

    /** Subscribe to state changes. Returns an unsubscribe function. */
    subscribe(listener: NavigationSplitViewListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(property: NavigationSplitViewProperty, plan: NavigationStackPlan, interactive = false): void {
        const change: NavigationSplitViewChange = { property, interactive, plan };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    private _critical(message: string): void {
        this._handlers.onCritical?.(message);
    }

    private _plan(changingPage = false): NavigationStackPlan {
        return resolveNavigationStack({
            hasSidebar: this._sidebar !== null,
            hasContent: this._content !== null,
            sidebarPosition: this._sidebarPosition,
            showContent: this._showContent,
            changingPage,
        });
    }

    /** Whether the panes are stacked (one at a time) rather than side by side. */
    get collapsed(): boolean {
        return this._collapsed;
    }

    /** Whether the CONTENT pane is the visible one while collapsed. */
    get showContent(): boolean {
        return this._showContent;
    }

    /** Which side the sidebar is packed on. */
    get sidebarPosition(): AdwPackType {
        return this._sidebarPosition;
    }

    /** The mounted sidebar page, or `null`. Its tag of record is {@link sidebarTag}. */
    get sidebar(): NavigationPageRef | null {
        return this._sidebar;
    }

    /** The mounted content page, or `null`. Its tag of record is {@link contentTag}. */
    get content(): NavigationPageRef | null {
        return this._content;
    }

    /** The sidebar page's tag, or `null` when untagged / unmounted. */
    get sidebarTag(): string | null {
        return this._sidebarTag;
    }

    /** The content page's tag, or `null` when untagged / unmounted. */
    get contentTag(): string | null {
        return this._contentTag;
    }

    /** The settled navigation stack — what SHOULD be mounted right now. */
    get stack(): NavigationStackPlan {
        return this._plan();
    }

    /** The pane on top of the stack, or `null` when neither child is mounted. */
    get visiblePane(): SplitViewPane | null {
        const { stack } = this._plan();
        return stack[stack.length - 1] ?? null;
    }

    /**
     * Mount (or unmount) the sidebar page. REFUSES a page whose tag the content pane
     * already carries, logging the critical and leaving the sidebar untouched.
     * Returns whether the sidebar changed.
     */
    setSidebar(page: NavigationPageRef | null): boolean {
        if (page === this._sidebar) return false;
        const tag = page?.tag ?? null;
        if (tagsConflict(tag, this._contentTag)) {
            this._critical(NAVIGATION_SPLIT_VIEW_CRITICALS.sidebarCollision(tag as string));
            return false;
        }
        this._sidebar = page;
        this._sidebarTag = tag;
        this._emit('sidebar', this._plan());
        return true;
    }

    /**
     * Mount (or unmount) the content page. REFUSES a page whose tag the sidebar
     * already carries. Returns whether the content changed.
     */
    setContent(page: NavigationPageRef | null): boolean {
        if (page === this._content) return false;
        const tag = page?.tag ?? null;
        if (tagsConflict(this._sidebarTag, tag)) {
            this._critical(NAVIGATION_SPLIT_VIEW_CRITICALS.contentCollision(tag as string));
            return false;
        }
        this._content = page;
        this._contentTag = tag;
        this._emit('content', this._plan());
        return true;
    }

    /**
     * Retag a MOUNTED pane. On a collision the page stays but its tag is cleared —
     * `check_tags_cb`'s failure mode, which differs from {@link setSidebar}'s refusal.
     * Returns whether the tag stuck.
     */
    setTag(pane: SplitViewPane, tag: string | null): boolean {
        if (pane === 'sidebar') {
            this._sidebarTag = tag;
            if (!tagsConflict(this._sidebarTag, this._contentTag)) return true;
            this._critical(NAVIGATION_SPLIT_VIEW_CRITICALS.sidebarTagCollision(tag as string));
            this._sidebarTag = null;
            return false;
        }
        this._contentTag = tag;
        if (!tagsConflict(this._sidebarTag, this._contentTag)) return true;
        this._critical(NAVIGATION_SPLIT_VIEW_CRITICALS.contentTagCollision(tag as string));
        this._contentTag = null;
        return false;
    }

    /** Set which side the sidebar is packed on. Returns whether it changed. */
    setSidebarPosition(position: AdwPackType): boolean {
        if (position === this._sidebarPosition) return false;
        this._sidebarPosition = position;
        this._emit('sidebar-position', this._plan());
        return true;
    }

    /** Collapse or expand the view. Returns whether it changed. */
    setCollapsed(value: boolean): boolean {
        const next = !!value;
        if (next === this._collapsed) return false;
        this._collapsed = next;
        this._emit('collapsed', this._plan());
        return true;
    }

    /**
     * Show the content pane (`true`) or the sidebar (`false`).
     *
     * The emitted plan carries a `push`/`pop` transition only when the change is
     * actually animatable — collapsed WITH both children, the condition under which
     * `set_show_content` drives the navigation view instead of just setting the flag
     * (adw-navigation-split-view.c:1403-1428). Returns whether it changed.
     */
    setShowContent(value: boolean, interactive = false): boolean {
        const next = !!value;
        if (next === this._showContent) return false;
        this._showContent = next;
        const animated = this._collapsed && this._sidebar !== null && this._content !== null;
        this._emit('show-content', this._plan(animated), interactive);
        return true;
    }

    /** Activate `navigation.push` with `tag`, applying the result. */
    push(tag: string): NavigationActionResult {
        return this._runAction(
            resolveNavigationAction({
                action: 'push',
                tag,
                sidebarTag: this._sidebarTag,
                contentTag: this._contentTag,
                showContent: this._showContent,
                collapsed: this._collapsed,
            }),
            'push',
            tag,
        );
    }

    /** Activate `navigation.pop`, applying the result. */
    pop(): NavigationActionResult {
        return this._runAction(
            resolveNavigationAction({
                action: 'pop',
                hasSidebar: this._sidebar !== null,
                hasContent: this._content !== null,
                showContent: this._showContent,
            }),
            'pop',
        );
    }

    private _runAction(result: NavigationActionResult, action: 'push' | 'pop', tag?: string): NavigationActionResult {
        switch (result.kind) {
            case 'set-show-content':
                this.setShowContent(result.showContent, true);
                return result;
            case 'already-in-stack':
                this._critical(NAVIGATION_SPLIT_VIEW_CRITICALS.alreadyInStack(result.tag));
                return result;
            default:
                // The parent gets first refusal; only an unclaimed PUSH is a critical
                // — `navigation_pop_cb` walks off the end silently.
                if (this._handlers.onDelegate?.(action, tag)) return result;
                if (action === 'pop') return result;
                this._critical(NAVIGATION_SPLIT_VIEW_CRITICALS.notFound(tag ?? ''));
                return { kind: 'not-found', tag: tag ?? '' };
        }
    }
}

// --- Overlay split view ---

/** A running reveal animation, cancellable when a new one supersedes it. */
export interface SplitViewAnimation {
    /** Stop the animation. Must be safe to call after it already finished. */
    cancel(): void;
}

/** What {@link SplitViewAnimator.animate} is asked to run. */
export interface SplitViewAnimationRequest {
    /** Progress to start from. */
    from: number;
    /** Progress to settle on — 1 shown, 0 hidden. */
    to: number;
    /** Initial velocity, in progress units per second (0 for a plain toggle). */
    velocity: number;
    /** Whether to clamp the spring's overshoot — `to < 0.5` (adw-overlay-split-view.c:288-289). */
    clamp: boolean;
    /** Feed every intermediate progress back to the state. */
    onValue: (progress: number) => void;
    /** Signal that the animation settled. */
    onDone: () => void;
}

/**
 * The injected timing seam for the reveal, mirroring `ToastScheduler`. libadwaita
 * uses a spring with params `(1, 0.5, 500)` (adw-overlay-split-view.c:1163-1165);
 * a renderer supplies whatever its platform has — a CSS transition, NativeScript's
 * `View.animate()`, or a deterministic fake in tests.
 */
export interface SplitViewAnimator {
    animate(request: SplitViewAnimationRequest): SplitViewAnimation;
}

/**
 * The default animator: jump straight to `to`. Keeps `OverlaySplitViewState`
 * timer-free and deterministic, so a renderer that has no animation (or has not
 * wired one yet) still gets correct end states.
 */
export const INSTANT_SPLIT_VIEW_ANIMATOR: SplitViewAnimator = {
    animate(request: SplitViewAnimationRequest): SplitViewAnimation {
        request.onValue(request.to);
        request.onDone();
        return { cancel: () => {} };
    },
};

/** Which property an {@link OverlaySplitViewState} change reports. */
export type OverlaySplitViewProperty =
    | 'show-sidebar'
    | 'collapsed'
    | 'pin-sidebar'
    | 'sidebar-position'
    | 'show-progress';

/** Payload of an {@link OverlaySplitViewState} change. */
export interface OverlaySplitViewChange {
    /** The GObject property that changed — the `notify::<property>` to re-emit. */
    property: OverlaySplitViewProperty;
    /** Whether the sidebar is meant to be shown. */
    showSidebar: boolean;
    /** Whether the sidebar overlays the content instead of sitting beside it. */
    collapsed: boolean;
    /** The reveal progress, 0…1 (and briefly above 1 while overshooting). */
    showProgress: number;
    /** Whether the click-outside shield takes input. */
    shieldVisible: boolean;
    /**
     * True when the change came from the USER (Escape, a shield click, a released
     * swipe). Extra provenance only: libadwaita notifies for both paths, so do NOT
     * gate the `notify::show-sidebar` re-emit on it.
     */
    interactive: boolean;
}

/** Subscriber for {@link OverlaySplitViewState} changes. */
export type OverlaySplitViewListener = (change: OverlaySplitViewChange) => void;

/** What releasing a swipe at a snap point means — see {@link resolveSwipeRelease}. */
export type SwipeReleasePlan =
    /** Settle the progress only; `show-sidebar` already agrees, so nothing notifies. */
    | { kind: 'animate'; to: number }
    /** A real `show-sidebar` change, which notifies. */
    | { kind: 'set-show-sidebar'; showSidebar: boolean };

/** Construction options for {@link OverlaySplitViewState}. */
export interface OverlaySplitViewOptions {
    collapsed?: boolean;
    showSidebar?: boolean;
    pinSidebar?: boolean;
    sidebarPosition?: AdwPackType;
    enableShowGesture?: boolean;
    enableHideGesture?: boolean;
    /** Reveal timing. Defaults to {@link INSTANT_SPLIT_VIEW_ANIMATOR}. */
    animator?: SplitViewAnimator;
}

/**
 * `Adw.OverlaySplitView`'s state machine.
 *
 * The rule worth having lifted is the collapse coupling: unless `pin-sidebar` is
 * set, collapsing HIDES the sidebar and uncollapsing SHOWS it, without animating
 * (`if (!self->pin_sidebar) set_show_sidebar (self, !self->collapsed, FALSE, 0);`,
 * adw-overlay-split-view.c:1454-1455). Neither renderer had it, so BOTH storybooks
 * re-derived it by hand next to their own breakpoint code — the clearest possible
 * evidence that it belongs in the widget.
 *
 * `show-sidebar` defaults to TRUE and `show-progress` to 1 (:1107-1109); the web
 * element's presence-attribute reading had it inverted, so an
 * `<adw-overlay-split-view>` with no attributes started with the sidebar hidden.
 */
export class OverlaySplitViewState {
    private _showSidebar: boolean;
    private _collapsed: boolean;
    private _pinSidebar: boolean;
    private _sidebarPosition: AdwPackType;
    private _enableShowGesture: boolean;
    private _enableHideGesture: boolean;
    private _showProgress: number;
    private _swipeActive = false;
    private _animation: SplitViewAnimation | null = null;
    private readonly _animator: SplitViewAnimator;
    private readonly _listeners = new Set<OverlaySplitViewListener>();

    constructor(options: OverlaySplitViewOptions = {}) {
        this._showSidebar = options.showSidebar ?? true;
        this._collapsed = options.collapsed ?? false;
        this._pinSidebar = options.pinSidebar ?? false;
        this._sidebarPosition = options.sidebarPosition ?? 'start';
        this._enableShowGesture = options.enableShowGesture ?? true;
        this._enableHideGesture = options.enableHideGesture ?? true;
        // `init` sets progress to 1 alongside show_sidebar TRUE; constructing with
        // the sidebar already hidden must start settled at 0, not mid-animation.
        this._showProgress = this._showSidebar ? 1 : 0;
        this._animator = options.animator ?? INSTANT_SPLIT_VIEW_ANIMATOR;
    }

    /** Subscribe to state changes. Returns an unsubscribe function. */
    subscribe(listener: OverlaySplitViewListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(property: OverlaySplitViewProperty, interactive = false): void {
        const change: OverlaySplitViewChange = {
            property,
            showSidebar: this._showSidebar,
            collapsed: this._collapsed,
            showProgress: this._showProgress,
            shieldVisible: this.shieldVisible,
            interactive,
        };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    /** Whether the sidebar is meant to be shown. */
    get showSidebar(): boolean {
        return this._showSidebar;
    }

    /** Whether the sidebar overlays the content instead of sitting beside it. */
    get collapsed(): boolean {
        return this._collapsed;
    }

    /** Whether collapsing/uncollapsing leaves the sidebar's visibility alone. */
    get pinSidebar(): boolean {
        return this._pinSidebar;
    }

    /** Which side the sidebar is packed on. */
    get sidebarPosition(): AdwPackType {
        return this._sidebarPosition;
    }

    /** Whether an edge swipe may OPEN the sidebar. */
    get enableShowGesture(): boolean {
        return this._enableShowGesture;
    }

    /** Whether a swipe may CLOSE the sidebar. */
    get enableHideGesture(): boolean {
        return this._enableHideGesture;
    }

    /** The reveal progress: 0 hidden, 1 shown, briefly above 1 while overshooting. */
    get showProgress(): number {
        return this._showProgress;
    }

    /** Whether the click-outside shield takes input — `update_shield` (:249-256). */
    get shieldVisible(): boolean {
        return this._collapsed && this._showProgress > 0;
    }

    /** Whether the sidebar is painted at all — the snapshot gate (:757). */
    get sidebarPainted(): boolean {
        return this._showProgress > 0;
    }

    /** `gtk_widget_set_can_focus (sidebar_bin, …)` (:330). */
    get sidebarFocusable(): boolean {
        return !this._collapsed || this._showSidebar;
    }

    /** `gtk_widget_set_can_focus (content_bin, …)` (:331). */
    get contentFocusable(): boolean {
        return !this._collapsed || !this._showSidebar;
    }

    /**
     * Show or hide the sidebar — `set_show_sidebar` (:294-360). No-op (and no
     * notification) when the value is unchanged; the public GTK setter animates, so
     * `animate` defaults to true. Returns whether it changed.
     */
    setShowSidebar(
        value: boolean,
        options: { animate?: boolean; velocity?: number; interactive?: boolean } = {},
    ): boolean {
        const next = !!value;
        if (next === this._showSidebar) return false;
        this._showSidebar = next;
        const target = next ? 1 : 0;
        const animate = options.animate ?? true;
        if (!animate) {
            this._cancelAnimation();
            this._showProgress = target;
        }
        // Notify BEFORE the animation starts: GTK's spring only reaches its target
        // callback on the next frame, so a listener always sees `show-sidebar` flip
        // first and the progress ramp after — an instant animator must not reorder that.
        this._emit('show-sidebar', options.interactive ?? false);
        // A swipe already owns the progress; settling is `end_swipe_cb`'s job.
        if (animate && !this._swipeActive) this._startAnimation(target, options.velocity ?? 0);
        return true;
    }

    /**
     * Collapse or expand — `adw_overlay_split_view_set_collapsed` (:1439-1481).
     *
     * Unless the sidebar is pinned this also flips `show-sidebar` to match, WITHOUT
     * animating, and emits that change first: GTK freezes notifications across the
     * whole setter, so `notify::show-sidebar` is queued before `notify::collapsed`
     * and thawed in that order. Returns whether `collapsed` changed.
     */
    setCollapsed(value: boolean): boolean {
        const next = !!value;
        if (next === this._collapsed) return false;
        this._collapsed = next;
        if (!this._pinSidebar) this.setShowSidebar(!next, { animate: false });
        this._emit('collapsed');
        return true;
    }

    /** Pin the sidebar so collapsing no longer hides it. Returns whether it changed. */
    setPinSidebar(value: boolean): boolean {
        const next = !!value;
        if (next === this._pinSidebar) return false;
        this._pinSidebar = next;
        this._emit('pin-sidebar');
        return true;
    }

    /** Set which side the sidebar is packed on. Returns whether it changed. */
    setSidebarPosition(position: AdwPackType): boolean {
        if (position === this._sidebarPosition) return false;
        this._sidebarPosition = position;
        this._emit('sidebar-position');
        return true;
    }

    /** Enable/disable the edge-swipe-to-open gesture. Returns whether it changed. */
    setEnableShowGesture(value: boolean): boolean {
        const next = !!value;
        if (next === this._enableShowGesture) return false;
        this._enableShowGesture = next;
        return true;
    }

    /** Enable/disable the swipe-to-close gesture. Returns whether it changed. */
    setEnableHideGesture(value: boolean): boolean {
        const next = !!value;
        if (next === this._enableHideGesture) return false;
        this._enableHideGesture = next;
        return true;
    }

    /**
     * Drive the reveal progress directly — `set_show_progress` (:258-270), the sink
     * an in-flight animation and a live swipe both write to. Does not touch
     * `show-sidebar`.
     */
    setShowProgress(progress: number): void {
        this._showProgress = progress;
        this._emit('show-progress');
    }

    /**
     * Handle Escape — `escape_shortcut_cb` (:705-716). Only a COLLAPSED view with a
     * visible sidebar consumes the key; otherwise it propagates so an enclosing
     * dialog still closes. Returns whether the key was consumed.
     */
    escape(): boolean {
        // `G_APPROX_VALUE (progress, 0, DBL_EPSILON) || progress < 0` — one test,
        // since anything at or below zero means there is no sidebar to close.
        if (this._showProgress < Number.EPSILON || !this._collapsed) return false;
        this.setShowSidebar(false, { interactive: true });
        return true;
    }

    /**
     * Handle a click on the shield — `released_cb` (:431-439), which hides the
     * sidebar unconditionally. Returns whether anything changed.
     */
    dismissShield(): boolean {
        return this.setShowSidebar(false, { interactive: true });
    }

    // --- swipe plumbing ---

    /** Whether a swipe currently owns the progress. */
    get swipeActive(): boolean {
        return this._swipeActive;
    }

    /** `begin_swipe_cb` (:389-401) — pause the animation and take over the progress. */
    beginSwipe(): void {
        this._cancelAnimation();
        this._swipeActive = true;
    }

    /**
     * `end_swipe_cb` (:414-429) — settle on `to`. When `to` agrees with the current
     * `show-sidebar` this only animates (no property change, no notification);
     * otherwise it is a real `show-sidebar` change. Returns what was done.
     */
    endSwipe(to: number, velocity = 0): SwipeReleasePlan {
        if (!this._swipeActive) return { kind: 'animate', to: this._showProgress };
        this._swipeActive = false;
        const release = resolveSwipeRelease({ to, showSidebar: this._showSidebar });
        if (release.kind === 'animate') this._startAnimation(release.to, velocity);
        else this.setShowSidebar(release.showSidebar, { velocity, interactive: true });
        return release;
    }

    /** The snap points a swipe may settle on right now. */
    get snapPoints(): number[] {
        return resolveSwipeSnapPoints({
            showProgress: this._showProgress,
            enableShowGesture: this._enableShowGesture,
            enableHideGesture: this._enableHideGesture,
            swipeActive: this._swipeActive,
        });
    }

    private _cancelAnimation(): void {
        this._animation?.cancel();
        this._animation = null;
    }

    private _startAnimation(to: number, velocity: number): void {
        this._cancelAnimation();
        let settled = false;
        const handle = this._animator.animate({
            from: this._showProgress,
            to,
            velocity,
            clamp: to < 0.5,
            onValue: (progress) => this.setShowProgress(progress),
            onDone: () => {
                settled = true;
                this._animation = null;
            },
        });
        // An instant animator finishes inside `animate()`, so storing its handle
        // afterwards would keep a settled animation alive forever.
        if (!settled) this._animation = handle;
    }
}

// --- Swipe geometry (Adw.Swipeable) ---

/**
 * `adw_overlay_split_view_get_snap_points` (:1214-1243) — where a swipe may settle.
 *
 * A gesture already in flight (`swipeActive`) unlocks both ends regardless of the
 * `enable-*-gesture` properties, so a swipe that started legally can always be
 * completed or cancelled.
 */
export function resolveSwipeSnapPoints(input: {
    showProgress: number;
    enableShowGesture: boolean;
    enableHideGesture: boolean;
    swipeActive: boolean;
}): number[] {
    const canOpen = input.showProgress > 0 || input.enableShowGesture || input.swipeActive;
    const canClose = input.showProgress < 1 || input.enableHideGesture || input.swipeActive;
    if (canOpen && canClose) return [0, 1];
    return [canOpen ? 1 : 0];
}

/**
 * `prepare_cb` (:362-387) — whether a starting swipe is picked up at all.
 *
 * A MID-FLIGHT swipe (neither fully open nor fully closed) is always resumable,
 * which is why the gesture-enable flags are only consulted at the two ends.
 */
export function resolveSwipeStart(input: {
    showProgress: number;
    collapsed: boolean;
    direction: 'forward' | 'back';
    enableShowGesture: boolean;
    enableHideGesture: boolean;
}): boolean {
    const fullyOpened = Math.abs(input.showProgress - 1) < Number.EPSILON || input.showProgress > 1;
    const fullyClosed = Math.abs(input.showProgress) < Number.EPSILON || input.showProgress < 0;

    // Swiping forward on an open, docked sidebar is a content gesture, not ours.
    if (fullyOpened && !input.collapsed && input.direction === 'forward') return false;
    if (fullyClosed && !input.enableShowGesture) return false;
    if (fullyOpened && !input.enableHideGesture) return false;
    return true;
}

/**
 * `end_swipe_cb` (:414-429) — what releasing a swipe at `to` means.
 *
 * Landing back where `show-sidebar` already is only SETTLES the animation; landing
 * on the other side is a real property change that must notify.
 */
export function resolveSwipeRelease(input: { to: number; showSidebar: boolean }): SwipeReleasePlan {
    if (input.to > 0 === input.showSidebar) return { kind: 'animate', to: input.to };
    return { kind: 'set-show-sidebar', showSidebar: input.to > 0 };
}

/**
 * `adw_overlay_split_view_get_cancel_progress` (:1253-1258) — where a cancelled
 * swipe snaps back to.
 *
 * C's `round()` is half-away-from-zero; JS `Math.round` is half-UP, so it disagrees
 * for every negative half (`Math.round(-0.5)` is `-0`, C's is `-1`). Progress goes
 * negative on a lower overshoot, so the difference is reachable.
 */
export function swipeCancelProgress(showProgress: number): number {
    const rounded = showProgress < 0 ? -Math.round(-showProgress) : Math.round(showProgress);
    return rounded === 0 ? 0 : rounded;
}

/**
 * `adw_overlay_split_view_get_swipe_area` (:1261-1290) — the rectangle that starts
 * a reveal swipe.
 *
 * With the sidebar closed the grabbable strip never shrinks below
 * {@link ADW_SWIPE_BORDER}; once it is open the whole revealed width is grabbable,
 * so the same gesture closes it again.
 */
export function resolveSwipeArea(input: {
    isDrag: boolean;
    sidebarWidth: number;
    showProgress: number;
    totalWidth: number;
    totalHeight: number;
    sidebarPosition?: AdwPackType;
    direction?: AdwTextDirection;
}): { x: number; y: number; width: number; height: number } {
    if (!input.isDrag) return { x: 0, y: 0, width: 0, height: 0 };
    const width = Math.max(Math.trunc(input.sidebarWidth * input.showProgress), ADW_SWIPE_BORDER);
    const atStart = isSidebarAtVisualStart(input.sidebarPosition ?? 'start', input.direction ?? 'ltr');
    return { x: atStart ? 0 : input.totalWidth - width, y: 0, width, height: input.totalHeight };
}
