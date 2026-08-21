// Split-view conformance vectors — the spec both renderers are held to.
//
// Every row is derived from a named function in the libadwaita C source and cites it, so a
// renderer that re-implements the arithmetic instead of calling `@gjsify/adwaita-core` fails
// the moment it drifts, naming the exact input.
//
// The rows that matter most: the same sizing input answered DIFFERENTLY by the two widgets
// (180 vs 100); inverted clamp bounds, which GLib resolves to `low` where JS's usual
// `Math.min(max, Math.max(min, x))` resolves to `high`; a collapsed split view with only ONE
// child; `sidebar-position: end`, where the CONTENT becomes the root page; RTL, where `start`
// is the RIGHT edge; and the unpinned collapse coupling.
//
// Reference: refs/libadwaita/src/adw-navigation-split-view.c
// Reference: refs/libadwaita/src/adw-overlay-split-view.c
// Reference: refs/libadwaita/src/adw-length-unit.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwLengthUnit } from '../length-unit.js';
import type {
    AdwPackType,
    AdwTextDirection,
    NavigationActionResult,
    NavigationStackPlan,
    OverlaySplitViewLayout,
    SidebarWidthSpec,
    SplitViewPaneRect,
} from '../split-view.js';

/** One `adwLengthToPx` expectation. */
export interface AdwLengthUnitVector {
    unit: AdwLengthUnit;
    value: number;
    /** The `gtk-xft-dpi` in play. */
    dpi: number;
    px: number;
    rule: string;
}

/**
 * `adw_length_unit_to_px`.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it
 * separately would assert the same thing twice (SIDEBAR_BOUNDS_VECTORS, driven by the browser suite).
 * ONE renderer, not two: NativeScript drives SIDEBAR_WIDTH_VECTORS instead, and works in DIPs, so
 * `split-view-width.spec.ts` skips every row that sets a unit or a dpi — no NativeScript surface
 * reaches this conversion at all.
 */
export const ADW_LENGTH_UNIT_VECTORS: ReadonlyArray<AdwLengthUnitVector> = [
    { unit: 'px', value: 180, dpi: 96, px: 180, rule: 'px is a passthrough' },
    { unit: 'px', value: 180, dpi: 120, px: 180, rule: 'px ignores the text scale entirely' },
    { unit: 'sp', value: 180, dpi: 96, px: 180, rule: 'sp at the default dpi is a passthrough' },
    { unit: 'sp', value: 180, dpi: 120, px: 225, rule: 'sp scales with the text scale factor (dpi/96)' },
    { unit: 'pt', value: 180, dpi: 96, px: 240, rule: 'pt is dpi/72 — the classic 4/3 at 96 dpi' },
    { unit: 'pt', value: 180, dpi: 120, px: 300, rule: 'pt scales too' },
    { unit: 'sp', value: 0, dpi: 120, px: 0, rule: '0 is a legal min/max width and survives conversion' },
];

/** One `glibClamp` expectation. */
export interface GlibClampVector {
    x: number;
    low: number;
    high: number;
    clamped: number;
    rule: string;
}

/**
 * GLib's `CLAMP` (gmacros.h) — HIGH is tested first.
 *
 * The inverted rows are the point: `Math.min(high, Math.max(low, x))` returns
 * `high` there, and `allocate_uncollapsed` reaches inverted bounds whenever the
 * content pane's own minimum leaves less room than `min-sidebar-width`.
 *
 * CORE-ONLY: GLib’s CLAMP itself, a primitive with no widget surface. What separates it from
 * `Math.min`/`Math.max` is the inverted rows, and those ARE driven — `resolveNavigationSidebarWidth`
 * inverts the bounds at 300px total width, which is a row of SIDEBAR_WIDTH_VECTORS.
 * Its other reachers, `toolbarViewAllocate` and `carouselClampPosition`, do not reach a driven table;
 * the earlier wording here claimed every reacher did, which was false in two places.
 */
export const GLIB_CLAMP_VECTORS: ReadonlyArray<GlibClampVector> = [
    { x: 250, low: 180, high: 280, clamped: 250, rule: 'inside the range, untouched' },
    { x: 150, low: 180, high: 280, clamped: 180, rule: 'below low is raised' },
    { x: 500, low: 180, high: 280, clamped: 280, rule: 'above high is capped' },
    { x: 75, low: 180, high: 100, clamped: 180, rule: 'INVERTED bounds, below both: high fails, low wins' },
    { x: 150, low: 180, high: 100, clamped: 100, rule: 'INVERTED bounds, above high: high is tested FIRST' },
    { x: 180, low: 180, high: 280, clamped: 180, rule: 'exactly low' },
    { x: 280, low: 180, high: 280, clamped: 280, rule: 'exactly high' },
];

/** One `resolveSidebarBounds` expectation. */
export interface SidebarBoundsVector {
    spec: SidebarWidthSpec;
    /** The sidebar child's own minimum width. */
    sidebarChildMin: number;
    /** `true` for the allocate paths (which `ceil()`), `false` for the measure paths. */
    ceil: boolean;
    min: number;
    max: number;
    rule: string;
}

/**
 * The `MAX (…, adw_length_unit_to_px (…))` pair both widgets open with, in both the
 * allocate and the measure flavour.
 */
export const SIDEBAR_BOUNDS_VECTORS: ReadonlyArray<SidebarBoundsVector> = [
    {
        spec: {},
        sidebarChildMin: 0,
        ceil: true,
        min: 180,
        max: 280,
        rule: 'libadwaita defaults, 180sp/280sp at 96 dpi',
    },
    { spec: {}, sidebarChildMin: 0, ceil: false, min: 180, max: 280, rule: 'measure agrees at the default dpi' },
    {
        spec: { minSidebarWidth: 181, sidebarWidthUnit: 'sp', dpi: 100 },
        sidebarChildMin: 0,
        ceil: false,
        min: 188,
        max: 291,
        rule: 'MEASURE truncates the int assignment: 181*100/96 = 188.54 → 188',
    },
    {
        spec: { minSidebarWidth: 181, sidebarWidthUnit: 'sp', dpi: 100 },
        sidebarChildMin: 0,
        ceil: true,
        min: 189,
        max: 292,
        rule: 'ALLOCATE ceils the same conversion → 189; a real 1px asymmetry at dpi ≠ 96',
    },
    {
        spec: { minSidebarWidth: 300, maxSidebarWidth: 200 },
        sidebarChildMin: 0,
        ceil: true,
        min: 300,
        max: 300,
        rule: 'max is raised to min BEFORE anything else, never inverted here',
    },
    {
        spec: {},
        sidebarChildMin: 400,
        ceil: true,
        min: 400,
        max: 400,
        rule: "the sidebar child's own minimum wins over max-sidebar-width",
    },
    {
        spec: { minSidebarWidth: 0, maxSidebarWidth: 0 },
        sidebarChildMin: 0,
        ceil: true,
        min: 0,
        max: 0,
        rule: '0 is a legal bound (pspec range [0, G_MAXDOUBLE]) — never a default fallback',
    },
];

/** One allocated-sidebar-width expectation. */
export interface SidebarWidthVector {
    /** Which widget's rule applies — they answer the same input differently. */
    widget: 'navigation' | 'overlay';
    spec: SidebarWidthSpec;
    totalWidth: number;
    /** The content pane's own minimum width. */
    contentMin: number;
    /** The sidebar child's own minimum width. */
    sidebarChildMin: number;
    /** Overlay only: collapsed ignores the fraction and clamps the VIEW width. */
    collapsed: boolean;
    width: number;
    rule: string;
}

/**
 * `allocate_uncollapsed` versus
 * `get_sidebar_width` + `allocate_uncollapsed`.
 *
 * The 300px pair is the reason this table keys on `widget`: identical input, 180 in
 * the navigation split view and 100 in the overlay, because one caps the BOUND and
 * the other caps the RESULT.
 */
export const SIDEBAR_WIDTH_VECTORS: ReadonlyArray<SidebarWidthVector> = [
    {
        widget: 'navigation',
        spec: {},
        totalWidth: 1000,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 250,
        rule: 'trunc(1000 * 0.25) sits inside [180, 280]',
    },
    {
        widget: 'navigation',
        spec: {},
        totalWidth: 600,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 180,
        rule: 'trunc(150) is raised to min-sidebar-width',
    },
    {
        widget: 'navigation',
        spec: {},
        totalWidth: 2000,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 280,
        rule: 'trunc(500) is capped at max-sidebar-width',
    },
    {
        widget: 'navigation',
        spec: {},
        totalWidth: 1000,
        contentMin: 900,
        sidebarChildMin: 0,
        collapsed: false,
        width: 100,
        rule: 'the max BOUND drops to width - contentMin = 100',
    },
    {
        widget: 'navigation',
        spec: {},
        totalWidth: 300,
        contentMin: 200,
        sidebarChildMin: 0,
        collapsed: false,
        width: 180,
        rule: 'bounds INVERT (min 180 > max 100); GLib CLAMP keeps the sidebar at its minimum',
    },
    {
        widget: 'overlay',
        spec: {},
        totalWidth: 300,
        contentMin: 200,
        sidebarChildMin: 0,
        collapsed: false,
        width: 100,
        rule: 'SAME INPUT as the row above: the overlay caps the RESULT, so it yields 100, not 180',
    },
    {
        widget: 'navigation',
        spec: { minSidebarWidth: 300, maxSidebarWidth: 200 },
        totalWidth: 1000,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 300,
        rule: 'max below min is raised to min first',
    },
    {
        widget: 'navigation',
        spec: {},
        totalWidth: 1000,
        contentMin: 0,
        sidebarChildMin: 400,
        collapsed: false,
        width: 400,
        rule: "the sidebar child's own minimum overrides max-sidebar-width",
    },
    {
        widget: 'navigation',
        spec: { sidebarWidthFraction: 0 },
        totalWidth: 1000,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 180,
        rule: 'fraction 0 still gets min-sidebar-width',
    },
    {
        widget: 'navigation',
        spec: { sidebarWidthFraction: 1 },
        totalWidth: 1000,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 280,
        rule: 'fraction 1 is capped at max-sidebar-width (the allocate path is well-defined)',
    },
    {
        widget: 'overlay',
        spec: {},
        totalWidth: 1000,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 250,
        rule: 'uncollapsed the overlay agrees with the navigation widget when nothing binds',
    },
    {
        widget: 'overlay',
        spec: {},
        totalWidth: 320,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: true,
        width: 280,
        rule: 'COLLAPSED ignores the fraction and clamps the VIEW width — 320 → max 280',
    },
    {
        widget: 'overlay',
        spec: {},
        totalWidth: 150,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: true,
        width: 180,
        rule: 'collapsed on a very narrow view, the sidebar is legitimately WIDER than the view',
    },
    {
        widget: 'overlay',
        spec: { sidebarWidthUnit: 'sp', dpi: 120 },
        totalWidth: 1000,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 250,
        rule: 'at 120 dpi the bounds become [225, 350] and 250 fits between them',
    },
    {
        widget: 'overlay',
        spec: { sidebarWidthUnit: 'sp', dpi: 120 },
        totalWidth: 800,
        contentMin: 0,
        sidebarChildMin: 0,
        collapsed: false,
        width: 225,
        rule: 'same dpi, trunc(200) is raised to the scaled minimum 180sp = 225px',
    },
];

/** One `resolveNaturalSidebarWidth` expectation. */
export interface NaturalSidebarWidthVector {
    contentNatural: number;
    min: number;
    max: number;
    fraction: number;
    natural: number;
    rule: string;
}

/**
 * `measure_uncollapsed`'s sidebar estimate  — the sidebar's OWN natural width is ignored.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (SIDEBAR_WIDTH_VECTORS)
 */
export const NATURAL_SIDEBAR_WIDTH_VECTORS: ReadonlyArray<NaturalSidebarWidthVector> = [
    { contentNatural: 800, min: 180, max: 280, fraction: 0.25, natural: 267, rule: 'ceil(800 * 0.25 / 0.75) = 267' },
    { contentNatural: 200, min: 180, max: 280, fraction: 0.25, natural: 180, rule: 'ceil(66.67) = 67, raised to min' },
    {
        contentNatural: 2000,
        min: 180,
        max: 280,
        fraction: 0.25,
        natural: 280,
        rule: 'ceil(666.67) = 667, capped at max',
    },
    { contentNatural: 800, min: 180, max: 280, fraction: 0, natural: 180, rule: 'fraction 0 asks for nothing → min' },
    {
        contentNatural: 800,
        min: 180,
        max: 280,
        fraction: 1,
        natural: 280,
        rule: 'fraction 1 divides by zero in C (UB); the limit is +inf, so the clamp gives max',
    },
    {
        contentNatural: 0,
        min: 180,
        max: 280,
        fraction: 1,
        natural: 280,
        rule: 'fraction 1 with no content is C 0/0 = NaN; the deviation keeps it at max',
    },
];

/** One `measureSplitViewHorizontal` expectation. */
export interface SplitViewMeasureVector {
    min: number;
    max: number;
    sidebarNatural: number;
    contentMin: number;
    contentNatural: number;
    showProgress: number;
    minimum: number;
    natural: number;
    rule: string;
}

/**
 * `measure_uncollapsed`; the navigation variant is the same rule at progress 1.
 *
 * Without this container minimum the content pane shrinks to nothing instead of the window
 * refusing to get narrower.
 *
 * CORE-ONLY: GAP — the container minimum lands as `min-width: min-content` on the content pane,
 * CSS’s own spelling of the same rule, so there is no computed number of ours for a renderer to
 * compare against. What the browser suite checks is the weaker property that the pane is not
 * crushable (`getComputedStyle(content).minWidth !== '0px'`, split-views.spec.ts); the numbers in
 * these rows reach no renderer. Tracked in #1072
 */
export const SPLIT_VIEW_MEASURE_VECTORS: ReadonlyArray<SplitViewMeasureVector> = [
    {
        min: 180,
        max: 280,
        sidebarNatural: 267,
        contentMin: 400,
        contentNatural: 800,
        showProgress: 1,
        minimum: 580,
        natural: 1067,
        rule: 'fully shown: the sidebar contributes its whole min/natural',
    },
    {
        min: 180,
        max: 280,
        sidebarNatural: 267,
        contentMin: 400,
        contentNatural: 800,
        showProgress: 0.5,
        minimum: 490,
        natural: 933,
        rule: 'half revealed: trunc(180*0.5)=90 and trunc(267*0.5)=133',
    },
    {
        min: 180,
        max: 280,
        sidebarNatural: 267,
        contentMin: 400,
        contentNatural: 800,
        showProgress: 0,
        minimum: 400,
        natural: 800,
        rule: 'hidden: the sidebar contributes nothing to the request',
    },
    {
        min: 180,
        max: 280,
        sidebarNatural: 267,
        contentMin: 400,
        contentNatural: 800,
        showProgress: 1.4,
        minimum: 580,
        natural: 1067,
        rule: 'overshoot is clamped to 1 for the request — CLAMP(show_progress, 0, 1)',
    },
];

/** One `layoutNavigationSplitView` expectation. */
export interface NavigationLayoutVector {
    totalWidth: number;
    sidebarWidth: number;
    sidebarPosition: AdwPackType;
    direction: AdwTextDirection;
    sidebar: SplitViewPaneRect;
    content: SplitViewPaneRect;
    rule: string;
}

/** `allocate_uncollapsed`. */
export const NAVIGATION_SPLIT_VIEW_LAYOUT_VECTORS: ReadonlyArray<NavigationLayoutVector> = [
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        sidebarPosition: 'start',
        direction: 'ltr',
        sidebar: { x: 0, width: 250 },
        content: { x: 250, width: 750 },
        rule: 'the ordinary LTR docked layout',
    },
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        sidebarPosition: 'end',
        direction: 'ltr',
        sidebar: { x: 750, width: 250 },
        content: { x: 0, width: 750 },
        rule: 'sidebar-position: end docks the sidebar to the right edge',
    },
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        sidebarPosition: 'start',
        direction: 'rtl',
        sidebar: { x: 750, width: 250 },
        content: { x: 0, width: 750 },
        rule: "RTL mirrors: 'start' is the RIGHT edge — get_start_or_end returns GTK_PACK_END",
    },
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        sidebarPosition: 'end',
        direction: 'rtl',
        sidebar: { x: 0, width: 250 },
        content: { x: 250, width: 750 },
        rule: "RTL mirrors: 'end' is the LEFT edge",
    },
];

/** One `layoutOverlaySplitView` expectation. */
export interface OverlayLayoutVector {
    totalWidth: number;
    sidebarWidth: number;
    showProgress: number;
    collapsed: boolean;
    sidebarPosition: AdwPackType;
    direction: AdwTextDirection;
    /** The full expected allocation, including the shield/paint/shadow state. */
    layout: OverlaySplitViewLayout;
    rule: string;
}

/**
 * `allocate_uncollapsed` and `allocate_collapsed`,
 * plus `update_shield` and the snapshot gate.
 *
 * `shadowProgress` is inverted relative to the reveal — 1 means NO shadow.
 */
export const OVERLAY_SPLIT_VIEW_LAYOUT_VECTORS: ReadonlyArray<OverlayLayoutVector> = [
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        showProgress: 1,
        collapsed: false,
        sidebarPosition: 'start',
        direction: 'ltr',
        layout: {
            sidebar: { x: 0, width: 250 },
            content: { x: 250, width: 750 },
            shieldVisible: false,
            sidebarPainted: true,
            shadowProgress: 1,
            shadowSide: 'left',
        },
        rule: 'docked and shown — the same rects the navigation widget produces',
    },
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        showProgress: 0.5,
        collapsed: false,
        sidebarPosition: 'start',
        direction: 'ltr',
        layout: {
            sidebar: { x: -125, width: 250 },
            content: { x: 125, width: 875 },
            shieldVisible: false,
            sidebarPainted: true,
            shadowProgress: 1,
            shadowSide: 'left',
        },
        rule: 'docked mid-slide: the pane hangs off the left edge and the content follows it',
    },
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        showProgress: 0,
        collapsed: false,
        sidebarPosition: 'start',
        direction: 'ltr',
        layout: {
            sidebar: { x: -250, width: 250 },
            content: { x: 0, width: 1000 },
            shieldVisible: false,
            sidebarPainted: false,
            shadowProgress: 1,
            shadowSide: 'left',
        },
        rule: 'docked and hidden: the offset is the FRESH width, so no dead strip can appear',
    },
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        showProgress: 1.2,
        collapsed: false,
        sidebarPosition: 'start',
        direction: 'ltr',
        layout: {
            sidebar: { x: 0, width: 300 },
            content: { x: 250, width: 750 },
            shieldVisible: false,
            sidebarPainted: true,
            shadowProgress: 1,
            shadowSide: 'left',
        },
        rule: 'OVERSHOOT: the pane widens to 300 and the offset pins to the measured 250',
    },
    {
        totalWidth: 1000,
        sidebarWidth: 250,
        showProgress: 0.5,
        collapsed: false,
        sidebarPosition: 'end',
        direction: 'ltr',
        layout: {
            sidebar: { x: 875, width: 250 },
            content: { x: 0, width: 875 },
            shieldVisible: false,
            sidebarPainted: true,
            shadowProgress: 1,
            shadowSide: 'right',
        },
        rule: 'docked at the end edge, mid-slide: the pane hangs off the RIGHT edge',
    },
    {
        totalWidth: 400,
        sidebarWidth: 280,
        showProgress: 0.5,
        collapsed: true,
        sidebarPosition: 'start',
        direction: 'ltr',
        layout: {
            sidebar: { x: -140, width: 280 },
            content: { x: 0, width: 400 },
            shieldVisible: true,
            sidebarPainted: true,
            shadowProgress: 0.5,
            shadowSide: 'left',
        },
        rule: 'collapsed mid-reveal: the content keeps the whole view and the shield is live',
    },
    {
        totalWidth: 400,
        sidebarWidth: 280,
        showProgress: 1,
        collapsed: true,
        sidebarPosition: 'end',
        direction: 'ltr',
        layout: {
            sidebar: { x: 120, width: 280 },
            content: { x: 0, width: 400 },
            shieldVisible: true,
            sidebarPainted: true,
            shadowProgress: 0,
            shadowSide: 'right',
        },
        rule: 'collapsed, fully open at the end edge: the shadow is at full strength',
    },
    {
        totalWidth: 400,
        sidebarWidth: 280,
        showProgress: 0,
        collapsed: true,
        sidebarPosition: 'start',
        direction: 'ltr',
        layout: {
            sidebar: { x: -280, width: 280 },
            content: { x: 0, width: 400 },
            shieldVisible: false,
            sidebarPainted: false,
            shadowProgress: 1,
            shadowSide: 'left',
        },
        rule: 'collapsed and closed: nothing is painted and the shield takes no input',
    },
    {
        totalWidth: 400,
        sidebarWidth: 280,
        showProgress: 1,
        collapsed: true,
        sidebarPosition: 'start',
        direction: 'rtl',
        layout: {
            sidebar: { x: 120, width: 280 },
            content: { x: 0, width: 400 },
            shieldVisible: true,
            sidebarPainted: true,
            shadowProgress: 0,
            shadowSide: 'right',
        },
        rule: "collapsed under RTL: a 'start' sidebar overlays from the RIGHT",
    },
];

/** One `tagsConflict` expectation. */
export interface TagsConflictVector {
    sidebarTag: string | null;
    contentTag: string | null;
    conflict: boolean;
    rule: string;
}

/**
 * `tags_equal`.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (the tag guard, driven through NAVIGATION_ACTION_VECTORS and the refusal tests in both renderer suites)
 */
export const TAGS_CONFLICT_VECTORS: ReadonlyArray<TagsConflictVector> = [
    { sidebarTag: null, contentTag: null, conflict: false, rule: 'two untagged pages never collide' },
    { sidebarTag: 'a', contentTag: null, conflict: false, rule: 'an absent tag never matches a present one' },
    { sidebarTag: null, contentTag: 'a', conflict: false, rule: 'and the same the other way round' },
    { sidebarTag: 'a', contentTag: 'a', conflict: true, rule: 'identical tags collide' },
    { sidebarTag: 'a', contentTag: 'b', conflict: false, rule: 'different tags are fine' },
    { sidebarTag: '', contentTag: '', conflict: true, rule: 'two EMPTY-STRING tags DO collide — "" is not absent' },
    { sidebarTag: '', contentTag: null, conflict: false, rule: 'but an empty tag does not match an absent one' },
    { sidebarTag: 'A', contentTag: 'a', conflict: false, rule: 'strcmp is case-sensitive' },
    {
        // Written as escapes on purpose: the two spellings are indistinguishable in
        // an editor, and the whole point of the row is that they are not equal.
        sidebarTag: '\u00DC', // LATIN CAPITAL LETTER U WITH DIAERESIS
        contentTag: 'U\u0308', // U + COMBINING DIAERESIS
        conflict: false,
        rule: 'byte-exact: precomposed vs decomposed U-umlaut are DIFFERENT tags - no NFC normalisation',
    },
    {
        sidebarTag: '\u00DC',
        contentTag: '\u00DC',
        conflict: true,
        rule: 'the same encoding of U-umlaut does collide',
    },
];

/** One `resolveNavigationStack` expectation. */
export interface NavigationStackVector {
    hasSidebar: boolean;
    hasContent: boolean;
    sidebarPosition: AdwPackType;
    showContent: boolean;
    /** Whether the animated (`set_show_content`) branch applies. */
    changingPage: boolean;
    plan: NavigationStackPlan;
    rule: string;
}

/**
 * `update_navigation_stack`.
 *
 * The lone-child rows are the ones both renderers fail: their CSS / `visibility`
 * tables key on `show-content` alone, so a collapsed split view holding only a
 * sidebar renders nothing at all.
 */
export const NAVIGATION_STACK_VECTORS: ReadonlyArray<NavigationStackVector> = [
    {
        hasSidebar: true,
        hasContent: true,
        sidebarPosition: 'start',
        showContent: false,
        changingPage: false,
        plan: { stack: ['sidebar'], transition: 'replace', page: null },
        rule: 'start-rooted, showing the sidebar',
    },
    {
        hasSidebar: true,
        hasContent: true,
        sidebarPosition: 'start',
        showContent: true,
        changingPage: false,
        plan: { stack: ['sidebar', 'content'], transition: 'replace', page: null },
        rule: 'start-rooted, content pushed on top',
    },
    {
        hasSidebar: true,
        hasContent: true,
        sidebarPosition: 'end',
        showContent: false,
        changingPage: false,
        plan: { stack: ['content', 'sidebar'], transition: 'replace', page: null },
        rule: "with 'end' the CONTENT is the root, so hiding it means pushing the sidebar OVER it",
    },
    {
        hasSidebar: true,
        hasContent: true,
        sidebarPosition: 'end',
        showContent: true,
        changingPage: false,
        plan: { stack: ['content'], transition: 'replace', page: null },
        rule: "with 'end' showing the content is the ROOT state",
    },
    {
        hasSidebar: true,
        hasContent: false,
        sidebarPosition: 'start',
        showContent: true,
        changingPage: false,
        plan: { stack: ['sidebar'], transition: 'replace', page: null },
        rule: 'a LONE sidebar stays visible even with show-content — both ports render blank here',
    },
    {
        hasSidebar: false,
        hasContent: true,
        sidebarPosition: 'start',
        showContent: false,
        changingPage: false,
        plan: { stack: ['content'], transition: 'replace', page: null },
        rule: 'a LONE content stays visible even without show-content',
    },
    {
        hasSidebar: false,
        hasContent: true,
        sidebarPosition: 'end',
        showContent: true,
        changingPage: false,
        plan: { stack: ['content'], transition: 'replace', page: null },
        rule: 'lone content, end-packed',
    },
    {
        hasSidebar: false,
        hasContent: false,
        sidebarPosition: 'start',
        showContent: false,
        changingPage: false,
        plan: { stack: [], transition: 'replace', page: null },
        rule: 'no children, no stack',
    },
    {
        hasSidebar: true,
        hasContent: true,
        sidebarPosition: 'start',
        showContent: true,
        changingPage: true,
        plan: { stack: ['sidebar', 'content'], transition: 'push', page: 'content' },
        rule: 'animated: same final stack as the static branch, reached by a PUSH',
    },
    {
        hasSidebar: true,
        hasContent: true,
        sidebarPosition: 'start',
        showContent: false,
        changingPage: true,
        plan: { stack: ['sidebar'], transition: 'pop', page: 'content' },
        rule: 'animated back: replace([sidebar, content]) then pop',
    },
    {
        hasSidebar: true,
        hasContent: true,
        sidebarPosition: 'end',
        showContent: true,
        changingPage: true,
        plan: { stack: ['content'], transition: 'pop', page: 'sidebar' },
        rule: "animated with 'end': showing the content is a POP, not a push",
    },
    {
        hasSidebar: true,
        hasContent: true,
        sidebarPosition: 'end',
        showContent: false,
        changingPage: true,
        plan: { stack: ['content', 'sidebar'], transition: 'push', page: 'sidebar' },
        rule: "animated with 'end': hiding the content PUSHES the sidebar",
    },
    {
        hasSidebar: true,
        hasContent: false,
        sidebarPosition: 'start',
        showContent: true,
        changingPage: true,
        plan: { stack: ['sidebar'], transition: 'replace', page: null },
        rule: 'the animated branch needs BOTH children; with one it falls back to replace',
    },
];

/** One `resolveNavigationAction` expectation. */
export interface NavigationActionVector {
    action: 'push' | 'pop';
    /** `push` only — the tag the action names. */
    tag?: string;
    sidebarTag?: string | null;
    contentTag?: string | null;
    /** `pop` only. */
    hasSidebar?: boolean;
    /** `pop` only. */
    hasContent?: boolean;
    showContent: boolean;
    collapsed: boolean;
    result: NavigationActionResult;
    rule: string;
}

/**
 * `navigation_push_cb` and `navigation_pop_cb`
 * — documented as working even when NOT collapsed.
 */
export const NAVIGATION_ACTION_VECTORS: ReadonlyArray<NavigationActionVector> = [
    {
        action: 'push',
        tag: 'detail',
        sidebarTag: 'list',
        contentTag: 'detail',
        showContent: false,
        collapsed: true,
        result: { kind: 'set-show-content', showContent: true },
        rule: 'the content tag shows the content',
    },
    {
        action: 'push',
        tag: 'detail',
        sidebarTag: 'list',
        contentTag: 'detail',
        showContent: true,
        collapsed: true,
        result: { kind: 'already-in-stack', tag: 'detail' },
        rule: 'collapsed AND already showing it: pushing again is a programming error',
    },
    {
        action: 'push',
        tag: 'detail',
        sidebarTag: 'list',
        contentTag: 'detail',
        showContent: true,
        collapsed: false,
        result: { kind: 'set-show-content', showContent: true },
        rule: 'uncollapsed both panes are visible, so the same push is a harmless no-op set',
    },
    {
        action: 'push',
        tag: 'list',
        sidebarTag: 'list',
        contentTag: 'detail',
        showContent: false,
        collapsed: false,
        result: { kind: 'already-in-stack', tag: 'list' },
        rule: "pushing the SIDEBAR's tag is always an error, collapsed or not",
    },
    {
        action: 'push',
        tag: 'other',
        sidebarTag: 'list',
        contentTag: 'detail',
        showContent: false,
        collapsed: false,
        result: { kind: 'delegate' },
        rule: 'an unknown tag goes to the parent BEFORE it may become a critical',
    },
    {
        action: 'push',
        tag: '',
        sidebarTag: null,
        contentTag: null,
        showContent: false,
        collapsed: false,
        result: { kind: 'delegate' },
        rule: 'untagged pages never match — g_strcmp0("", NULL) is non-zero',
    },
    {
        action: 'push',
        tag: 'shared',
        sidebarTag: 'shared',
        contentTag: 'shared',
        showContent: false,
        collapsed: true,
        result: { kind: 'set-show-content', showContent: true },
        rule: 'the CONTENT tag is tested first, so it wins a (guarded-against) collision',
    },
    {
        action: 'pop',
        hasSidebar: true,
        hasContent: true,
        showContent: true,
        collapsed: false,
        result: { kind: 'set-show-content', showContent: false },
        rule: 'pop works uncollapsed too — it just flips show-content back',
    },
    {
        action: 'pop',
        hasSidebar: false,
        hasContent: true,
        showContent: true,
        collapsed: true,
        result: { kind: 'delegate' },
        rule: 'pop needs BOTH children; otherwise the parent gets it',
    },
    {
        action: 'pop',
        hasSidebar: true,
        hasContent: true,
        showContent: false,
        collapsed: true,
        result: { kind: 'delegate' },
        rule: 'already at the root: nothing to pop, so it propagates',
    },
];

/** The observable state of an `OverlaySplitViewState`. */
export interface OverlaySplitViewSnapshot {
    showSidebar: boolean;
    collapsed: boolean;
    showProgress: number;
    shieldVisible: boolean;
    sidebarFocusable: boolean;
    contentFocusable: boolean;
}

/** One collapse-coupling expectation. */
export interface OverlayCollapseVector {
    initial: { collapsed?: boolean; showSidebar?: boolean; pinSidebar?: boolean };
    before: OverlaySplitViewSnapshot;
    /** The `collapsed` value to set. */
    setCollapsed: boolean;
    after: OverlaySplitViewSnapshot;
    /** Which `notify::*` properties fire, in order. */
    notifications: ReadonlyArray<'show-sidebar' | 'collapsed'>;
    rule: string;
}

/**
 * `adw_overlay_split_view_init` + `set_collapsed` +
 * the can-focus pair.
 *
 * `if (!self->pin_sidebar) set_show_sidebar (self, !self->collapsed, FALSE, 0);` is
 * the single rule BOTH storybooks re-implemented by hand because neither widget
 * offered it. `show-sidebar` is notified before `collapsed` because GTK freezes
 * notifications across the whole setter and thaws them in queue order.
 */
export const OVERLAY_COLLAPSE_VECTORS: ReadonlyArray<OverlayCollapseVector> = [
    {
        initial: {},
        before: {
            showSidebar: true,
            collapsed: false,
            showProgress: 1,
            shieldVisible: false,
            sidebarFocusable: true,
            contentFocusable: true,
        },
        setCollapsed: true,
        after: {
            showSidebar: false,
            collapsed: true,
            showProgress: 0,
            shieldVisible: false,
            sidebarFocusable: false,
            contentFocusable: true,
        },
        notifications: ['show-sidebar', 'collapsed'],
        rule: 'DEFAULTS: show-sidebar TRUE / progress 1; collapsing auto-hides an unpinned sidebar',
    },
    {
        initial: { pinSidebar: true },
        before: {
            showSidebar: true,
            collapsed: false,
            showProgress: 1,
            shieldVisible: false,
            sidebarFocusable: true,
            contentFocusable: true,
        },
        setCollapsed: true,
        after: {
            showSidebar: true,
            collapsed: true,
            showProgress: 1,
            shieldVisible: true,
            sidebarFocusable: true,
            contentFocusable: false,
        },
        notifications: ['collapsed'],
        rule: 'pin-sidebar suppresses the coupling entirely — the sidebar stays up as an overlay',
    },
    {
        initial: { collapsed: true, showSidebar: false },
        before: {
            showSidebar: false,
            collapsed: true,
            showProgress: 0,
            shieldVisible: false,
            sidebarFocusable: false,
            contentFocusable: true,
        },
        setCollapsed: false,
        after: {
            showSidebar: true,
            collapsed: false,
            showProgress: 1,
            shieldVisible: false,
            sidebarFocusable: true,
            contentFocusable: true,
        },
        notifications: ['show-sidebar', 'collapsed'],
        rule: 'uncollapsing re-shows an unpinned sidebar; constructing hidden starts settled at progress 0',
    },
    {
        initial: { collapsed: true, showSidebar: true },
        before: {
            showSidebar: true,
            collapsed: true,
            showProgress: 1,
            shieldVisible: true,
            sidebarFocusable: true,
            contentFocusable: false,
        },
        setCollapsed: true,
        after: {
            showSidebar: true,
            collapsed: true,
            showProgress: 1,
            shieldVisible: true,
            sidebarFocusable: true,
            contentFocusable: false,
        },
        notifications: [],
        rule: 'setting the value it already has changes nothing and notifies nothing',
    },
];

/** One `resolveSwipeSnapPoints` expectation. */
export interface SwipeSnapPointVector {
    showProgress: number;
    enableShowGesture: boolean;
    enableHideGesture: boolean;
    swipeActive: boolean;
    snapPoints: number[];
    rule: string;
}

/** `adw_overlay_split_view_get_snap_points`. */
export const OVERLAY_SWIPE_SNAP_POINT_VECTORS: ReadonlyArray<SwipeSnapPointVector> = [
    {
        showProgress: 0,
        enableShowGesture: false,
        enableHideGesture: true,
        swipeActive: false,
        snapPoints: [0],
        rule: 'closed with opening disabled: nowhere to go but closed',
    },
    {
        showProgress: 1,
        enableShowGesture: true,
        enableHideGesture: false,
        swipeActive: false,
        snapPoints: [1],
        rule: 'open with closing disabled: nowhere to go but open',
    },
    {
        showProgress: 0.5,
        enableShowGesture: false,
        enableHideGesture: false,
        swipeActive: false,
        snapPoints: [0, 1],
        rule: 'mid-flight both ends are reachable regardless of the gesture flags',
    },
    {
        showProgress: 0,
        enableShowGesture: false,
        enableHideGesture: false,
        swipeActive: true,
        snapPoints: [0, 1],
        rule: 'a swipe in progress unlocks both ends so it can always be completed or cancelled',
    },
];

/** One `resolveSwipeStart` expectation. */
export interface SwipeStartVector {
    showProgress: number;
    collapsed: boolean;
    direction: 'forward' | 'back';
    enableShowGesture: boolean;
    enableHideGesture: boolean;
    detected: boolean;
    rule: string;
}

/** `prepare_cb`. */
export const OVERLAY_SWIPE_START_VECTORS: ReadonlyArray<SwipeStartVector> = [
    {
        showProgress: 1,
        collapsed: false,
        direction: 'forward',
        enableShowGesture: true,
        enableHideGesture: true,
        detected: false,
        rule: 'forward on an open DOCKED sidebar belongs to the content, not to us',
    },
    {
        showProgress: 1,
        collapsed: true,
        direction: 'forward',
        enableShowGesture: true,
        enableHideGesture: true,
        detected: true,
        rule: 'the same gesture on a COLLAPSED overlay is ours',
    },
    {
        showProgress: 0,
        collapsed: false,
        direction: 'forward',
        enableShowGesture: false,
        enableHideGesture: true,
        detected: false,
        rule: 'closed with the show gesture disabled',
    },
    {
        showProgress: 1,
        collapsed: true,
        direction: 'back',
        enableShowGesture: true,
        enableHideGesture: false,
        detected: false,
        rule: 'open with the hide gesture disabled',
    },
    {
        showProgress: 0.5,
        collapsed: false,
        direction: 'forward',
        enableShowGesture: false,
        enableHideGesture: false,
        detected: true,
        rule: 'a mid-flight swipe is ALWAYS resumable — the flags only guard the two ends',
    },
];

/** One `resolveSwipeRelease` expectation. */
export interface SwipeReleaseVector {
    to: number;
    showSidebar: boolean;
    /** `animate` = settle only; `set-show-sidebar` = a real property change. */
    kind: 'animate' | 'set-show-sidebar';
    /** The resulting `show-sidebar`, for the `set-show-sidebar` case. */
    showSidebarAfter: boolean;
    rule: string;
}

/** `end_swipe_cb`. */
export const OVERLAY_SWIPE_RELEASE_VECTORS: ReadonlyArray<SwipeReleaseVector> = [
    {
        to: 1,
        showSidebar: true,
        kind: 'animate',
        showSidebarAfter: true,
        rule: 'released where it already was: settle only, no notify',
    },
    {
        to: 0,
        showSidebar: true,
        kind: 'set-show-sidebar',
        showSidebarAfter: false,
        rule: 'swiped closed: a real show-sidebar change',
    },
    {
        to: 1,
        showSidebar: false,
        kind: 'set-show-sidebar',
        showSidebarAfter: true,
        rule: 'swiped open: a real show-sidebar change',
    },
    {
        to: 0,
        showSidebar: false,
        kind: 'animate',
        showSidebarAfter: false,
        rule: 'cancelled back to closed: settle only',
    },
];

/** One `swipeCancelProgress` expectation. */
export interface SwipeCancelVector {
    showProgress: number;
    cancelProgress: number;
    rule: string;
}

/** `adw_overlay_split_view_get_cancel_progress`. */
export const OVERLAY_SWIPE_CANCEL_VECTORS: ReadonlyArray<SwipeCancelVector> = [
    { showProgress: 0.5, cancelProgress: 1, rule: 'C round() is half-AWAY-from-zero' },
    { showProgress: 0.4999, cancelProgress: 0, rule: 'just below the half' },
    { showProgress: 1.2, cancelProgress: 1, rule: 'an upper overshoot snaps back to open' },
    { showProgress: 0, cancelProgress: 0, rule: 'already closed' },
    {
        showProgress: -0.5,
        cancelProgress: -1,
        rule: 'a lower overshoot: JS Math.round(-0.5) is -0, C round(-0.5) is -1',
    },
];

/** One `resolveSwipeArea` expectation. */
export interface SwipeAreaVector {
    isDrag: boolean;
    sidebarWidth: number;
    showProgress: number;
    totalWidth: number;
    totalHeight: number;
    sidebarPosition: AdwPackType;
    direction: AdwTextDirection;
    area: { x: number; y: number; width: number; height: number };
    rule: string;
}

/**
 * `adw_overlay_split_view_get_swipe_area`;
 * `ADW_SWIPE_BORDER` is 32.
 */
export const OVERLAY_SWIPE_AREA_VECTORS: ReadonlyArray<SwipeAreaVector> = [
    {
        isDrag: false,
        sidebarWidth: 280,
        showProgress: 1,
        totalWidth: 400,
        totalHeight: 800,
        sidebarPosition: 'start',
        direction: 'ltr',
        area: { x: 0, y: 0, width: 0, height: 0 },
        rule: 'a non-drag (scroll/keyboard) swipe has no area at all',
    },
    {
        isDrag: true,
        sidebarWidth: 280,
        showProgress: 0,
        totalWidth: 400,
        totalHeight: 800,
        sidebarPosition: 'start',
        direction: 'ltr',
        area: { x: 0, y: 0, width: 32, height: 800 },
        rule: 'closed: only the ADW_SWIPE_BORDER edge strip is grabbable',
    },
    {
        isDrag: true,
        sidebarWidth: 280,
        showProgress: 1,
        totalWidth: 400,
        totalHeight: 800,
        sidebarPosition: 'end',
        direction: 'ltr',
        area: { x: 120, y: 0, width: 280, height: 800 },
        rule: 'open at the end edge: the whole revealed width is grabbable, flush right',
    },
    {
        isDrag: true,
        sidebarWidth: 280,
        showProgress: 1,
        totalWidth: 400,
        totalHeight: 800,
        sidebarPosition: 'start',
        direction: 'rtl',
        area: { x: 120, y: 0, width: 280, height: 800 },
        rule: "RTL mirrors the strip: a 'start' sidebar is grabbed from the RIGHT",
    },
];
