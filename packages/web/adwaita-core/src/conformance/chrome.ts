// Window-chrome conformance vectors — the spec both renderers are held to.
//
// Every row cites the C function it was derived from. The rows that matter most are the
// inputs the three implementations each answered differently: `maximum-size="0"`, a
// non-numeric `maximum-size`, a clamp narrower than its tightening threshold, a spinner at
// 24px, a spinner at 200px, and a toolbar view squeezed below its content's minimum.
//
// Reference: refs/libadwaita/src/adw-clamp-layout.c
// Reference: refs/libadwaita/src/adw-toolbar-view.c
// Reference: refs/libadwaita/src/adw-spinner.c
// Reference: refs/libadwaita/src/adw-spinner-paintable.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type {
    AdwClampSizeClass,
    AdwToolbarStyle,
    ClampParams,
    ToolbarViewAllocateInput,
    ToolbarViewClassInput,
    ToolbarViewContentForSizeInput,
    ToolbarViewMeasureInput,
} from '../chrome.js';

/** One `clampThresholds` expectation. */
export interface ClampThresholdsVector {
    /** The clamp properties plus the child's measured min/nat. */
    params: ClampParams;
    /** `MAX (MIN (tightening_threshold, maximum_size), min)`. */
    lower: number;
    /** `MAX (lower, maximum_size)`. */
    max: number;
    /** `lower + 3 * (max - lower)`. */
    upper: number;
    rule: string;
}

/**
 * `lower`/`max`/`upper`.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (CLAMP_ALLOCATE_VECTORS)
 * Not for every row: both renderer suites filter that table to `params.childMin === 0`, so the
 * three rows below that set a child minimum are asserted here alone. Tracked in #1072
 */
export const CLAMP_THRESHOLD_VECTORS: ReadonlyArray<ClampThresholdsVector> = [
    {
        params: { maximumSize: 600, tighteningThreshold: 400, childMin: 0, childNat: 1000 },
        lower: 400,
        max: 600,
        upper: 1000,
        rule: 'the property defaults — a 200px tightening region reached at 1000px available',
    },
    {
        params: { maximumSize: 600, tighteningThreshold: 800, childMin: 0, childNat: 1000 },
        lower: 600,
        max: 600,
        upper: 600,
        rule: 'threshold ABOVE the maximum collapses the tightening region entirely',
    },
    {
        params: { maximumSize: 600, tighteningThreshold: 400, childMin: 800, childNat: 900 },
        lower: 800,
        max: 800,
        upper: 800,
        rule: "a child minimum above the maximum raises all three — the clamp cannot squeeze below the child's min",
    },
    {
        params: { maximumSize: 0, tighteningThreshold: 400, childMin: 150, childNat: 400 },
        lower: 150,
        max: 150,
        upper: 150,
        rule: 'maximum-size 0 means "the child\'s own minimum", not "nothing"',
    },
    {
        params: { maximumSize: 600, tighteningThreshold: 400, childMin: 500, childNat: 700 },
        lower: 500,
        max: 600,
        upper: 800,
        rule: 'a child minimum BETWEEN the threshold and the maximum shortens the tightening region',
    },
];

/** One `clampChildSize` expectation. */
export interface ClampChildSizeVector {
    /** The available size (`for_size`); `-1` is GTK's "unconstrained". */
    forSize: number;
    /** The clamp properties plus the child's measured min/nat. */
    params: ClampParams;
    /** What the child is allocated. */
    childSize: number;
    rule: string;
}

const CLAMP_DEFAULT_PARAMS: ClampParams = {
    maximumSize: 600,
    tighteningThreshold: 400,
    childMin: 0,
    childNat: 1000,
};

/**
 * `child_size_from_clamp`.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (CLAMP_ALLOCATE_VECTORS)
 * Not for every row: one row below sets `childMin: 150`, and both renderer suites filter that
 * table to `params.childMin === 0`, so that row is asserted here alone. Tracked in #1072
 */
export const CLAMP_CHILD_SIZE_VECTORS: ReadonlyArray<ClampChildSizeVector> = [
    {
        forSize: -1,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 600,
        rule: 'unconstrained: MIN (nat, ceil (max)) — the cap wins over a larger natural',
    },
    {
        forSize: -1,
        params: { maximumSize: 600, tighteningThreshold: 400, childMin: 0, childNat: 320 },
        childSize: 320,
        rule: 'unconstrained: a natural below the cap wins over the cap',
    },
    {
        forSize: 360,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 360,
        rule: 'the phone case — a 360 DIP viewport gets a 360 DIP child, never a 600 DIP one',
    },
    { forSize: 300, params: CLAMP_DEFAULT_PARAMS, childSize: 300, rule: 'below the threshold the child gets it all' },
    { forSize: 400, params: CLAMP_DEFAULT_PARAMS, childSize: 400, rule: 'the `<= lower` boundary is inclusive' },
    {
        forSize: 500,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 484,
        rule: 'inside the tightening region: floor(lerp(400, 600, easeOutCubic(1/6)))',
    },
    { forSize: 700, params: CLAMP_DEFAULT_PARAMS, childSize: 575, rule: 'mid-region: easeOutCubic(0.5) = 0.875' },
    { forSize: 800, params: CLAMP_DEFAULT_PARAMS, childSize: 592, rule: 'late region — still short of the cap' },
    {
        forSize: 1000,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 600,
        rule: 'at `upper` the child finally reaches the cap',
    },
    { forSize: 1500, params: CLAMP_DEFAULT_PARAMS, childSize: 600, rule: 'past `upper` nothing changes' },
    {
        forSize: 800,
        params: { maximumSize: 0, tighteningThreshold: 400, childMin: 150, childNat: 400 },
        childSize: 150,
        rule: 'maximum-size 0 — NOT 0 (what the browser port rendered) and NOT 600 (what the NS port substituted)',
    },
    {
        forSize: 500,
        params: { maximumSize: 600, tighteningThreshold: 800, childMin: 0, childNat: 1000 },
        childSize: 500,
        rule: 'threshold above the maximum: everything below the cap passes straight through',
    },
    {
        forSize: 900,
        params: { maximumSize: 600, tighteningThreshold: 800, childMin: 0, childNat: 1000 },
        childSize: 600,
        rule: 'threshold above the maximum: the cap applies with no easing at all',
    },
];

/** One `clampSizeFromChild` expectation. */
export interface ClampSizeFromChildVector {
    /** The child's size. */
    childSize: number;
    /** The clamp properties plus the child's measured min/nat. */
    params: ClampParams;
    /** The size the clamp itself reports for it. */
    clampSize: number;
    rule: string;
}

/**
 * `clamp_size_from_child` — the inverse ease.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (CLAMP_ALLOCATE_VECTORS)
 */
export const CLAMP_SIZE_FROM_CHILD_VECTORS: ReadonlyArray<ClampSizeFromChildVector> = [
    { childSize: 300, params: CLAMP_DEFAULT_PARAMS, clampSize: 300, rule: 'below the threshold it is the identity' },
    { childSize: 400, params: CLAMP_DEFAULT_PARAMS, clampSize: 400, rule: 'the `<= lower` boundary is inclusive' },
    {
        childSize: 450,
        params: CLAMP_DEFAULT_PARAMS,
        clampSize: 455,
        rule: 'inverse ease: progress = 1 + cbrt(0.25 - 1), then ceil',
    },
    {
        childSize: 500,
        params: CLAMP_DEFAULT_PARAMS,
        clampSize: 524,
        rule: 'the mid-region inverse — 523.78 rounds UP where the forward direction rounds down',
    },
    {
        childSize: 600,
        params: CLAMP_DEFAULT_PARAMS,
        clampSize: 1000,
        rule: 'a child at the cap needs the full `upper` to be reached',
    },
    {
        childSize: 700,
        params: CLAMP_DEFAULT_PARAMS,
        clampSize: 1000,
        rule: 'a child ABOVE the cap still only ever reports `upper`',
    },
];

/** One `clampAllocate` expectation. */
export interface ClampAllocateVector {
    /** The size the clamp itself was allocated. */
    availableSize: number;
    /** The clamp properties plus the child's measured min/nat. */
    params: ClampParams;
    /** The size the child is allocated. */
    childSize: number;
    /** `ceil(max)`. */
    childMaximum: number;
    /** `ceil(lower)`. */
    lowerThreshold: number;
    /** The style class the CHILD carries. */
    sizeClass: AdwClampSizeClass;
    offset: number;
    rule: string;
}

/** `adw_clamp_layout_allocate`. */
export const CLAMP_ALLOCATE_VECTORS: ReadonlyArray<ClampAllocateVector> = [
    {
        availableSize: 300,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 300,
        childMaximum: 600,
        lowerThreshold: 400,
        sizeClass: 'small',
        offset: 0,
        rule: 'narrow: the child fills the clamp and is `small`',
    },
    {
        availableSize: 400,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 400,
        childMaximum: 600,
        lowerThreshold: 400,
        sizeClass: 'small',
        offset: 0,
        rule: 'exactly at the lower threshold — `<=` keeps it `small`',
    },
    {
        availableSize: 700,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 575,
        childMaximum: 600,
        lowerThreshold: 400,
        sizeClass: 'medium',
        offset: 62,
        rule: 'the tightening region is `medium`; the offset is C integer division, so 62.5 truncates',
    },
    {
        availableSize: 1000,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 600,
        childMaximum: 600,
        lowerThreshold: 400,
        sizeClass: 'large',
        offset: 200,
        rule: 'at the cap the child becomes `large`',
    },
    {
        availableSize: 1500,
        params: CLAMP_DEFAULT_PARAMS,
        childSize: 600,
        childMaximum: 600,
        lowerThreshold: 400,
        sizeClass: 'large',
        offset: 450,
        rule: 'a very wide clamp only widens the margins',
    },
    {
        availableSize: 800,
        params: { maximumSize: 0, tighteningThreshold: 400, childMin: 150, childNat: 400 },
        childSize: 150,
        childMaximum: 150,
        lowerThreshold: 150,
        sizeClass: 'large',
        offset: 325,
        rule: 'maximum-size 0: the child sits at its own minimum, and `>=` wins the tie so it is `large`',
    },
];

/** One `normalizeClampSize` expectation. */
export interface ClampPropertyVector {
    /** The raw attribute value or property assignment. */
    value: number | string | null | undefined;
    fallback: number;
    /** The value that reaches the layout. */
    size: number;
    rule: string;
}

/**
 * `maximum-size` / `tightening-threshold` as `g_param_spec_int (…, 0, G_MAXINT, …)`.
 *
 * The three interesting rows: `"0"` (valid, and NOT the default), a non-numeric value
 * (never reaches the layout, so the DEFAULT applies rather than the cap already set), and a
 * negative (out of range, clamped to the range floor).
 */
export const CLAMP_PROPERTY_VECTORS: ReadonlyArray<ClampPropertyVector> = [
    { value: '600', fallback: 600, size: 600, rule: 'the ordinary case' },
    { value: '400', fallback: 600, size: 400, rule: 'an explicit narrower cap' },
    { value: '0', fallback: 600, size: 0, rule: '"0" is IN RANGE — the browser port rendered max-width: 0px' },
    { value: 0, fallback: 600, size: 0, rule: 'numeric 0 likewise — the NS port silently substituted 600' },
    {
        value: 'abc',
        fallback: 600,
        size: 600,
        rule: 'unparsable: the browser port assigned NaNpx and kept the old cap',
    },
    { value: '', fallback: 600, size: 600, rule: 'an empty attribute is an unset property' },
    { value: null, fallback: 600, size: 600, rule: 'an absent attribute is an unset property' },
    { value: undefined, fallback: 400, size: 400, rule: 'the fallback is the PROPERTY default, not a constant 600' },
    { value: Number.NaN, fallback: 600, size: 600, rule: 'NaN is not an int GObject would accept' },
    { value: Number.POSITIVE_INFINITY, fallback: 600, size: 600, rule: 'nor is Infinity' },
    { value: -5, fallback: 600, size: 0, rule: 'below the range floor clamps to 0, it does not fall back' },
    { value: 600.7, fallback: 600, size: 600, rule: 'an int property truncates a fractional assignment' },
    { value: '420px', fallback: 600, size: 420, rule: 'a CSS-flavoured attribute still yields its number' },
];

/** One `toolbarViewAllocate` expectation. */
export interface ToolbarViewAllocateVector {
    input: ToolbarViewAllocateInput;
    /** `Adw.ToolbarView:top-bar-height`. */
    topBarHeight: number;
    /** `Adw.ToolbarView:bottom-bar-height`. */
    bottomBarHeight: number;
    /** The content's allocated height. */
    contentHeight: number;
    /** The content's offset from the top edge. */
    contentOffset: number;
    rule: string;
}

/**
 * `adw_toolbar_view_size_allocate`.
 *
 * CORE-ONLY: both renderers let the BROWSER and NativeScript lay the bars out rather than allocating by hand, so there is no allocation of theirs to compare — the rule they DO apply is TOOLBAR_VIEW_CLASS_VECTORS, which both drive. This reason used to live in the two `adw-toolbar-view.ts` files and nowhere a reader of this table would look
 */
export const TOOLBAR_VIEW_ALLOCATE_VECTORS: ReadonlyArray<ToolbarViewAllocateVector> = [
    {
        input: {
            height: 600,
            topMin: 46,
            topNat: 46,
            bottomMin: 0,
            bottomNat: 0,
            contentMin: 200,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
        },
        topBarHeight: 46,
        bottomBarHeight: 0,
        contentHeight: 554,
        contentOffset: 46,
        rule: 'the ordinary case — one rigid header bar over the content',
    },
    {
        input: {
            height: 100,
            topMin: 46,
            topNat: 46,
            bottomMin: 30,
            bottomNat: 30,
            contentMin: 200,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
        },
        topBarHeight: 46,
        bottomBarHeight: 30,
        contentHeight: 24,
        contentOffset: 46,
        rule: 'squeezed below the content minimum: CLAMP(-130, 46, 46) keeps the BARS whole and shortens the content',
    },
    {
        input: {
            height: 600,
            topMin: 46,
            topNat: 100,
            bottomMin: 0,
            bottomNat: 0,
            contentMin: 200,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
        },
        topBarHeight: 100,
        bottomBarHeight: 0,
        contentHeight: 500,
        contentOffset: 100,
        rule: 'a STRETCHY top bar takes its natural height while there is room — CLAMP(400, 46, 100)',
    },
    {
        input: {
            height: 230,
            topMin: 46,
            topNat: 100,
            bottomMin: 0,
            bottomNat: 0,
            contentMin: 200,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
        },
        topBarHeight: 46,
        bottomBarHeight: 0,
        contentHeight: 184,
        contentOffset: 46,
        rule: "and shrinks back to its minimum as the content's minimum claims the space — CLAMP(30, 46, 100)",
    },
    {
        input: {
            height: 250,
            topMin: 0,
            topNat: 0,
            bottomMin: 30,
            bottomNat: 80,
            contentMin: 200,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
        },
        topBarHeight: 0,
        bottomBarHeight: 50,
        contentHeight: 200,
        contentOffset: 0,
        rule: 'the same shrink on the BOTTOM bar, which is clamped against the top bar’s actual height',
    },
    {
        input: {
            height: 600,
            topMin: 46,
            topNat: 46,
            bottomMin: 0,
            bottomNat: 0,
            contentMin: 200,
            extendContentToTopEdge: true,
            extendContentToBottomEdge: false,
        },
        topBarHeight: 46,
        bottomBarHeight: 0,
        contentHeight: 600,
        contentOffset: 0,
        rule: 'extend-to-top: the content spans the full height and the bar overlays it',
    },
    {
        input: {
            height: 600,
            topMin: 46,
            topNat: 46,
            bottomMin: 30,
            bottomNat: 30,
            contentMin: 40,
            extendContentToTopEdge: true,
            extendContentToBottomEdge: true,
        },
        topBarHeight: 46,
        bottomBarHeight: 30,
        contentHeight: 600,
        contentOffset: 0,
        rule: 'both extends with a small content: MAX(40 - 46 - 30, 0) floors the reserved minimum at 0',
    },
];

/** One `toolbarViewMeasure` expectation. */
export interface ToolbarViewMeasureVector {
    input: ToolbarViewMeasureInput;
    /** The view's minimum along the measured axis. */
    minimum: number;
    /** The view's natural along the measured axis. */
    natural: number;
    rule: string;
}

/**
 * `adw_toolbar_view_measure`.
 *
 * CORE-ONLY: same as TOOLBAR_VIEW_ALLOCATE_VECTORS — neither renderer measures the bars itself
 */
export const TOOLBAR_VIEW_MEASURE_VECTORS: ReadonlyArray<ToolbarViewMeasureVector> = [
    {
        input: {
            orientation: 'vertical',
            topMin: 46,
            topNat: 46,
            bottomMin: 30,
            bottomNat: 30,
            contentMin: 200,
            contentNat: 200,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
        },
        minimum: 276,
        natural: 276,
        rule: 'no extends: the three slots simply add up',
    },
    {
        input: {
            orientation: 'vertical',
            topMin: 46,
            topNat: 46,
            bottomMin: 30,
            bottomNat: 30,
            contentMin: 200,
            contentNat: 200,
            extendContentToTopEdge: true,
            extendContentToBottomEdge: false,
        },
        minimum: 230,
        natural: 230,
        rule: 'extend-to-top: the top bar is MAXed with the content, the bottom bar still added',
    },
    {
        input: {
            orientation: 'vertical',
            topMin: 46,
            topNat: 46,
            bottomMin: 30,
            bottomNat: 30,
            contentMin: 200,
            contentNat: 200,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: true,
        },
        minimum: 246,
        natural: 246,
        rule: 'extend-to-bottom is the mirror image',
    },
    {
        input: {
            orientation: 'vertical',
            topMin: 46,
            topNat: 46,
            bottomMin: 30,
            bottomNat: 30,
            contentMin: 50,
            contentNat: 50,
            extendContentToTopEdge: true,
            extendContentToBottomEdge: true,
        },
        minimum: 76,
        natural: 76,
        rule: 'both extends: the bars are summed FIRST (they still cannot overlap) and MAXed as a pair',
    },
    {
        input: {
            orientation: 'vertical',
            topMin: 46,
            topNat: 60,
            bottomMin: 30,
            bottomNat: 30,
            contentMin: 200,
            contentNat: 300,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
        },
        minimum: 276,
        natural: 390,
        rule: 'minimum and natural are independent sums — a stretchy bar only moves the natural',
    },
    {
        input: {
            orientation: 'horizontal',
            topMin: 360,
            topNat: 360,
            bottomMin: 100,
            bottomNat: 100,
            contentMin: 200,
            contentNat: 200,
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
        },
        minimum: 360,
        natural: 360,
        rule: 'horizontally the three slots overlap, so it is MAX and the extend flags do not matter',
    },
    {
        input: {
            orientation: 'horizontal',
            topMin: 100,
            topNat: 100,
            bottomMin: 100,
            bottomNat: 400,
            contentMin: 200,
            contentNat: 200,
            extendContentToTopEdge: true,
            extendContentToBottomEdge: true,
        },
        minimum: 200,
        natural: 400,
        rule: 'the horizontal form ignores the extend flags entirely',
    },
];

/** One `toolbarViewContentForSize` expectation. */
export interface ToolbarViewContentForSizeVector {
    /** The `for_size` the view was measured at. */
    forSize: number;
    input: ToolbarViewContentForSizeInput;
    /** `for_size` for the content's minimum. */
    forSizeMin: number;
    /** `for_size` for the content's natural. */
    forSizeNat: number;
    rule: string;
}

/**
 * `adw_toolbar_view_measure`'s height-for-width branch.
 *
 * CORE-ONLY: same as TOOLBAR_VIEW_ALLOCATE_VECTORS — neither renderer measures the bars itself
 */
export const TOOLBAR_VIEW_CONTENT_FOR_SIZE_VECTORS: ReadonlyArray<ToolbarViewContentForSizeVector> = [
    {
        forSize: 600,
        input: {
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
            topMinHeight: 46,
            topNatHeight: 60,
            bottomMinHeight: 30,
            bottomNatHeight: 30,
        },
        forSizeMin: 524,
        forSizeNat: 510,
        rule: 'a stretchy top bar leaves the content two DIFFERENT heights to be measured against',
    },
    {
        forSize: 600,
        input: {
            extendContentToTopEdge: false,
            extendContentToBottomEdge: false,
            topMinHeight: 46,
            topNatHeight: 46,
            bottomMinHeight: 30,
            bottomNatHeight: 30,
        },
        forSizeMin: 524,
        forSizeNat: 524,
        rule: 'rigid bars make the two coincide — which is why one value looked sufficient',
    },
    {
        forSize: 600,
        input: {
            extendContentToTopEdge: true,
            extendContentToBottomEdge: false,
            topMinHeight: 46,
            topNatHeight: 60,
            bottomMinHeight: 30,
            bottomNatHeight: 30,
        },
        forSizeMin: 570,
        forSizeNat: 570,
        rule: 'a bar the content extends under costs it nothing',
    },
    {
        forSize: 600,
        input: {
            extendContentToTopEdge: true,
            extendContentToBottomEdge: true,
            topMinHeight: 46,
            topNatHeight: 60,
            bottomMinHeight: 30,
            bottomNatHeight: 30,
        },
        forSizeMin: 600,
        forSizeNat: 600,
        rule: 'both extends: the content is measured against the whole view',
    },
];

/** One `toolbarViewClasses` expectation. */
export interface ToolbarViewClassVector {
    /** The styles, extend flags and ALLOCATED bar heights. */
    input: ToolbarViewClassInput;
    /** Classes on the view node. */
    view: readonly string[];
    /** Classes on the top-bar box. */
    topBar: readonly string[];
    /** Classes on the bottom-bar box. */
    bottomBar: readonly string[];
    rule: string;
}

const FLAT_BARS = {
    topBarStyle: 'flat' as AdwToolbarStyle,
    bottomBarStyle: 'flat' as AdwToolbarStyle,
    extendContentToTopEdge: false,
    extendContentToBottomEdge: false,
};

/** `update_undershoots` + the style setters. */
export const TOOLBAR_VIEW_CLASS_VECTORS: ReadonlyArray<ToolbarViewClassVector> = [
    {
        input: { ...FLAT_BARS, topBarHeight: 46, bottomBarHeight: 30 },
        view: ['undershoot-top', 'undershoot-bottom'],
        topBar: [],
        bottomBar: [],
        rule: 'flat bars with a height on both sides: the scroll fade appears under each',
    },
    {
        input: { ...FLAT_BARS, topBarHeight: 0, bottomBarHeight: 30 },
        view: ['undershoot-bottom'],
        topBar: [],
        bottomBar: [],
        rule: 'no top bar was allocated, so there is nothing for the content to fade under',
    },
    {
        input: { ...FLAT_BARS, topBarHeight: 46, bottomBarHeight: 0 },
        view: ['undershoot-top'],
        topBar: [],
        bottomBar: [],
        rule: 'the mirror case',
    },
    {
        input: { ...FLAT_BARS, extendContentToTopEdge: true, topBarHeight: 46, bottomBarHeight: 30 },
        view: ['undershoot-bottom'],
        topBar: [],
        bottomBar: [],
        rule: 'content extending UNDER the bar has nothing to fade into',
    },
    {
        input: { ...FLAT_BARS, topBarStyle: 'raised', topBarHeight: 46, bottomBarHeight: 30 },
        view: ['undershoot-bottom'],
        topBar: ['raised'],
        bottomBar: [],
        rule: 'a raised bar carries its own shadow, so it suppresses the undershoot',
    },
    {
        input: { ...FLAT_BARS, topBarStyle: 'raised-border', topBarHeight: 46, bottomBarHeight: 0 },
        view: [],
        topBar: ['raised', 'border'],
        bottomBar: [],
        rule: 'raised-border is raised PLUS border — the border replaces the SHADOW, not the background',
    },
    {
        input: {
            topBarStyle: 'raised',
            bottomBarStyle: 'raised-border',
            extendContentToTopEdge: false,
            extendContentToBottomEdge: true,
            topBarHeight: 46,
            bottomBarHeight: 30,
        },
        view: [],
        topBar: ['raised'],
        bottomBar: ['raised', 'border'],
        rule: 'the two bars are styled independently',
    },
];

/** One `spinnerGeometry` expectation. */
export interface SpinnerGeometryVector {
    width: number;
    height: number;
    /** `MIN (floorf (MIN (w, h) / 2), MAX_RADIUS)`. */
    radius: number;
    /** `2 * radius`. */
    diameter: number;
    /** `diameter / 8`. */
    lineWidth: number;
    /** `roundf (width / 2)`. */
    centerX: number;
    /** `roundf (height / 2)`. */
    centerY: number;
    /**
     * The pre-lift browser formula `max(2, round(size / 12))`, or `null` for a
     * non-square box, which that element had no notion of.
     */
    legacyWebLineWidth: number | null;
    rule: string;
}

/**
 * `adw_spinner_paintable_snapshot_with_weight`
 * + `calculate_line_width` at the default weight 400.
 *
 * `legacyWebLineWidth` stays in the table on purpose: it is the formula the
 * browser element shipped, and it is wrong at every size above 16 — 2px where
 * Adwaita strokes 3px at 24, 4px against 6px at 48, 5px against 8px at 64.
 */
export const SPINNER_GEOMETRY_VECTORS: ReadonlyArray<SpinnerGeometryVector> = [
    {
        width: 16,
        height: 16,
        radius: 8,
        diameter: 16,
        lineWidth: 2,
        centerX: 8,
        centerY: 8,
        legacyWebLineWidth: 2,
        rule: 'the measured minimum, and the documented "2px for 16px" — the one size both agreed on',
    },
    {
        width: 24,
        height: 24,
        radius: 12,
        diameter: 24,
        lineWidth: 3,
        centerX: 12,
        centerY: 12,
        legacyWebLineWidth: 2,
        rule: 'the browser element drew 2px here',
    },
    {
        width: 48,
        height: 48,
        radius: 24,
        diameter: 48,
        lineWidth: 6,
        centerX: 24,
        centerY: 24,
        legacyWebLineWidth: 4,
        rule: 'the storybook default size — the browser element drew 4px',
    },
    {
        width: 64,
        height: 64,
        radius: 32,
        diameter: 64,
        lineWidth: 8,
        centerX: 32,
        centerY: 32,
        legacyWebLineWidth: 5,
        rule: 'exactly at MAX_RADIUS — the largest ring Adwaita draws',
    },
    {
        width: 200,
        height: 200,
        radius: 32,
        diameter: 64,
        lineWidth: 8,
        centerX: 100,
        centerY: 100,
        legacyWebLineWidth: 17,
        rule: 'the ring is capped at 64 but stays CENTRED in the oversized box',
    },
    {
        width: 100,
        height: 40,
        radius: 20,
        diameter: 40,
        lineWidth: 5,
        centerX: 50,
        centerY: 20,
        legacyWebLineWidth: null,
        rule: 'the SHORTER side decides the radius; the centre follows the box on both axes',
    },
    {
        width: 31,
        height: 31,
        radius: 15,
        diameter: 30,
        lineWidth: 3.75,
        centerX: 16,
        centerY: 16,
        legacyWebLineWidth: 3,
        rule: 'floorf(15.5) = 15, so an odd box draws a 30px ring — and the line width is fractional',
    },
    {
        width: 12,
        height: 12,
        radius: 6,
        diameter: 12,
        lineWidth: 1.5,
        centerX: 6,
        centerY: 6,
        legacyWebLineWidth: 2,
        rule: 'below the measured minimum the geometry is still defined — which is why resolveSpinnerSize exists',
    },
];

/** One `resolveSpinnerSize` expectation. */
export interface SpinnerSizeVector {
    /** The raw attribute value or property assignment. */
    value: number | string | null | undefined;
    /** The box the spinner is given. */
    size: number;
    rule: string;
}

/**
 * `adw_spinner_measure` — minimum AND natural are both
 * `MIN_SIZE`, and GTK never allocates below a widget's minimum.
 *
 * The rows without a usable value all land on 16, which is the measured natural
 * size — NOT the 24 the browser element invented nor the 32 the NativeScript
 * widget invented.
 */
export const SPINNER_SIZE_VECTORS: ReadonlyArray<SpinnerSizeVector> = [
    { value: 48, size: 48, rule: 'an explicit size above the minimum is honoured' },
    { value: '24', size: 24, rule: 'read off an attribute' },
    { value: 16, size: 16, rule: 'exactly the minimum' },
    { value: '8', size: 16, rule: 'below the minimum is not representable — the browser element rendered 8px' },
    { value: 0, size: 16, rule: 'zero likewise — the browser element rendered a 0×0 box with a 2px border' },
    { value: -5, size: 16, rule: 'and a negative' },
    { value: null, size: 16, rule: 'unset falls back to the measured NATURAL, which equals the minimum' },
    { value: undefined, size: 16, rule: 'so does an absent property' },
    { value: '', size: 16, rule: 'and an empty attribute' },
    { value: 'abc', size: 16, rule: 'and an unparsable one' },
    { value: Number.NaN, size: 16, rule: 'NaN is not a size' },
    { value: 200, size: 200, rule: 'an oversized box stays oversized — spinnerGeometry caps the RING, not the box' },
];
