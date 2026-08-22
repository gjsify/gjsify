// Carousel conformance vectors — the spec both renderers are held to.
//
// `Adw.Carousel` is arithmetic over one array of per-page reveal sizes, and the two ports
// each re-derived a different, smaller version of it: an inverted `allow-scroll-wheel`
// default, a half-way position resolved to the WRONG page in both, `page-changed` gated on
// an index change in one and absent in the other, and `scrollToPage(NaN)` leaving a NaN
// position with no active dot.
//
// Rows come in two shapes: the pure-function tables are single input/output pairs, the state
// tables are SCRIPTS — a page list, a sequence of operations, and the snapshot they must
// land in — because what is pinned is a state machine: which page is current, where the
// position ended up, and which `page-changed` indices came out on the way. Where a row
// contradicts what a port shipped, the `rule` says so, and that row is the regression pin.
//
// NOT covered here, and deliberately: the indicator metrics (per-dot progress
// ramp, line lengths, measure/centering, the RTL draw flip). They consume widget
// measurements neither renderer produces, so vectors for them would pin
// behaviour with no caller.
//
// Reference: refs/libadwaita/src/adw-carousel.c
// Reference: refs/libadwaita/src/adw-carousel-indicator-dots.c (the snap-point inverse)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type {
    CarouselDirection,
    CarouselOrientation,
    CarouselPageMeasurement,
    CarouselScrollSource,
} from '../carousel.js';

/** One `carouselSnapPoints` expectation. */
export interface CarouselSnapPointVector {
    /** Per-page reveal sizes: 0 while a page animates in, 1 once settled. */
    sizes: readonly number[];
    /** `snapPoint[i] = (Σ_{j≤i} size[j]) − 1`. */
    snapPoints: readonly number[];
    rule: string;
}

/**
 * `adw_carousel_size_allocate`'s accumulation.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (CAROUSEL_PAGE_LIST_VECTORS)
 */
export const CAROUSEL_SNAP_POINT_VECTORS: ReadonlyArray<CarouselSnapPointVector> = [
    { sizes: [1, 1, 1], snapPoints: [0, 1, 2], rule: 'settled pages sit one unit apart, starting at 0' },
    { sizes: [1], snapPoints: [0], rule: 'a single page is always at position 0' },
    { sizes: [1, 0.5, 1], snapPoints: [0, 0.5, 1.5], rule: 'a half-revealed page makes the snap points fractional' },
    {
        sizes: [0, 1, 1],
        snapPoints: [-1, 0, 1],
        rule: 'a page inserted at 0 starts at size 0 (:1385), so its snap point is NEGATIVE — which is what keeps the pages behind it in place',
    },
    { sizes: [1, 1, 0], snapPoints: [0, 1, 1], rule: 'a trailing size-0 page shares its predecessor’s snap point' },
    { sizes: [], snapPoints: [], rule: 'no pages, no snap points — the swipeable view pads this to [0] (:1269)' },
];

/** One `carouselSizesFromSnapPoints` expectation. */
export interface CarouselSizesFromSnapPointsVector {
    /** Snap points as `AdwSwipeable` hands them to an indicator. */
    snapPoints: readonly number[];
    /** `sizes[0] = points[0] + 1`, `sizes[i] = points[i] − points[i−1]`. */
    sizes: readonly number[];
    rule: string;
}

/**
 * The inverse both indicators reconstruct sizes with — the only channel through which an
 * indicator can learn per-page reveal state.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (CAROUSEL_PAGE_LIST_VECTORS)
 */
export const CAROUSEL_SIZES_FROM_SNAP_POINTS_VECTORS: ReadonlyArray<CarouselSizesFromSnapPointsVector> = [
    { snapPoints: [0, 1, 2], sizes: [1, 1, 1], rule: 'settled pages round-trip to size 1' },
    { snapPoints: [0, 0.5, 1.5], sizes: [1, 0.5, 1], rule: 'a mid-reveal page is recovered as a fraction' },
    { snapPoints: [-1, 0, 1], sizes: [0, 1, 1], rule: 'the +1 offset recovers a just-inserted page as size 0' },
    { snapPoints: [0], sizes: [1], rule: 'an EMPTY carousel still measures as one page (:1269 pads to a single 0)' },
    { snapPoints: [], sizes: [], rule: 'nothing in, nothing out' },
];

/** One `carouselPageAllocation` expectation. */
export interface CarouselPageAllocationVector {
    /** The carousel's own size along its axis: `width` as `size_allocate` receives it. */
    available: number;
    /** What each page measures, in C's terms. */
    pages: readonly CarouselPageMeasurement[];
    /** `child_width`: the size every page is allocated. */
    pageSize: number;
    /** `(available − pageSize) / 2`, the half-gap the strip starts at. */
    leadingInset: number;
    rule: string;
}

/**
 * `adw_carousel_size_allocate`'s page sizing (:748-767) and the centring offset it
 * feeds (:796-806).
 *
 * The regression pin for the peek: in GTK the pages of the Carousel story (440px cards
 * in a 480px carousel) leave 20px of the previous and next page showing at the two
 * edges, and the web port showed neither, because its pages were CSS `flex: 0 0 100%`.
 * A row here is a page size and the inset that follows from it; where the neighbours
 * then land is `distance` away from that, which CAROUSEL_PAGE_LIST_VECTORS already owns.
 */
export const CAROUSEL_PAGE_ALLOCATION_VECTORS: ReadonlyArray<CarouselPageAllocationVector> = [
    {
        available: 480,
        pages: [{ natural: 440 }, { natural: 440 }, { natural: 440 }],
        pageSize: 440,
        leadingInset: 20,
        rule: 'a page narrower than the carousel keeps its natural size, and the 40px left over is split so BOTH neighbours peek in by 20px',
    },
    {
        available: 480,
        pages: [{ natural: 200 }, { natural: 440 }, { natural: 300 }],
        pageSize: 440,
        leadingInset: 20,
        rule: 'every page is allocated the SAME size, the largest of them (:764)',
    },
    {
        available: 480,
        pages: [{ natural: 900 }],
        pageSize: 480,
        leadingInset: 0,
        rule: 'a page wider than the carousel is capped at it (:754), the only case in which a page IS the carousel width',
    },
    {
        available: 480,
        pages: [{ natural: 200, expand: true }, { natural: 200 }],
        pageSize: 480,
        leadingInset: 0,
        rule: 'an expanding page takes the whole carousel (:751-752), and one expanding page sizes them all',
    },
    {
        available: 480,
        pages: [{ natural: 450, minimum: 600 }],
        pageSize: 600,
        leadingInset: -60,
        rule: 'CLAMP tests the HIGH bound first, so a page whose MINIMUM exceeds the carousel gets its minimum and the strip overhangs both edges',
    },
    {
        available: 0,
        pages: [{ natural: 440 }],
        pageSize: 0,
        leadingInset: 0,
        rule: 'a carousel with no width allocates no page, which is why a renderer must wait for its first layout before measuring anything',
    },
    {
        available: 480,
        pages: [],
        pageSize: 0,
        leadingInset: 240,
        rule: 'no pages, no size: `size` starts at 0 (:738) with nothing to MAX it against',
    },
];

/** One `carouselRange` expectation. */
export interface CarouselRangeVector {
    snapPoints: readonly number[];
    /** Pending `position_shift`, which C folds into the bound. */
    positionShift: number;
    /** Always 0. */
    lower: number;
    /** `MAX (0, positionShift + last snap point)`. */
    upper: number;
    rule: string;
}

/**
 * `get_range`.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (CAROUSEL_PAGE_LIST_VECTORS)
 */
export const CAROUSEL_RANGE_VECTORS: ReadonlyArray<CarouselRangeVector> = [
    { snapPoints: [0, 1, 2], positionShift: 0, lower: 0, upper: 2, rule: 'the last snap point is the upper bound' },
    { snapPoints: [], positionShift: 0, lower: 0, upper: 0, rule: 'an empty carousel cannot scroll (:212-219)' },
    { snapPoints: [0], positionShift: 0, lower: 0, upper: 0, rule: 'one page cannot scroll either' },
    {
        snapPoints: [0, 1, 2],
        positionShift: -5,
        lower: 0,
        upper: 0,
        rule: 'MAX(0, …) floors the bound — a large pending shift collapses the range instead of inverting it',
    },
    {
        snapPoints: [-1, 0, 1],
        positionShift: 0,
        lower: 0,
        upper: 1,
        rule: 'a negative FIRST snap point does not lower the bound; only the last one is read',
    },
];

/** One `carouselClampPosition` expectation. */
export interface CarouselClampVector {
    position: number;
    snapPoints: readonly number[];
    /** `CLAMP (position, lower, upper)`. */
    clamped: number;
    rule: string;
}

/**
 * `set_position`'s guard.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (CAROUSEL_PAGE_LIST_VECTORS)
 */
export const CAROUSEL_CLAMP_VECTORS: ReadonlyArray<CarouselClampVector> = [
    { position: 5, snapPoints: [0, 1, 2], clamped: 2, rule: 'past the end clamps to the last snap point' },
    { position: -3, snapPoints: [0, 1, 2], clamped: 0, rule: 'below the start clamps to 0' },
    {
        position: 1.7,
        snapPoints: [0, 1, 2],
        clamped: 1.7,
        rule: 'the clamp BOUNDS the scroll, it does not snap — a fractional position passes through',
    },
    { position: 5, snapPoints: [], clamped: 0, rule: 'an empty carousel clamps everything to 0' },
    { position: 0, snapPoints: [0, 1, 2], clamped: 0, rule: 'an in-range position is untouched' },
];

/** One `carouselPageAtPosition` expectation. */
export interface CarouselPageAtPositionVector {
    position: number;
    /** The snap points of the pages that count. */
    snapPoints: readonly number[];
    /** The page index, `-1` when there are no pages. */
    page: number;
    rule: string;
}

/**
 * `get_page_at_position` → `get_closest_child_at` . The `.5` rows are the regression pins: C's comparison is a strict
 * `>`, so an equidistant LATER page never replaces the earlier one, while both
 * ports used `Math.round`, which rounds .5 up.
 */
export const CAROUSEL_PAGE_AT_POSITION_VECTORS: ReadonlyArray<CarouselPageAtPositionVector> = [
    { position: 0, snapPoints: [0, 1, 2], page: 0, rule: 'exactly on a snap point' },
    { position: 2, snapPoints: [0, 1, 2], page: 2, rule: 'exactly on the last snap point' },
    {
        position: 0.5,
        snapPoints: [0, 1, 2],
        page: 0,
        rule: 'an exact tie resolves to the LOWER page — Math.round would answer 1 here, and both ports did',
    },
    { position: 0.5000001, snapPoints: [0, 1, 2], page: 1, rule: 'a hair past the tie flips to the later page' },
    { position: 0.4999999, snapPoints: [0, 1, 2], page: 0, rule: 'a hair before the tie stays on the earlier page' },
    { position: 1.5, snapPoints: [0, 1, 2], page: 1, rule: 'the tie-break is the same at every boundary' },
    { position: 9, snapPoints: [0, 1, 2], page: 2, rule: 'the position is clamped into the range BEFORE the search' },
    { position: -1, snapPoints: [0, 1, 2], page: 0, rule: 'clamped from below the same way' },
    {
        position: 0,
        snapPoints: [],
        page: -1,
        rule: 'an empty carousel has no current page — the -1 `page-changed` documents (:1150-1151)',
    },
    {
        position: 0.5,
        snapPoints: [-1, 0, 1],
        page: 1,
        rule: 'mid-insert geometry: the search runs on snap points, not on indices',
    },
];

/** One `carouselNavigateTarget` expectation. */
export interface CarouselNavigateVector {
    position: number;
    nPages: number;
    direction: CarouselDirection;
    /** The target page, `null` when C returns FALSE. */
    target: number | null;
    rule: string;
}

/**
 * `navigate_to_direction`.
 *
 * The rounding here is C's `round()` — half AWAY FROM ZERO — and it is
 * deliberately not the half-down tie-break of
 * {@link CAROUSEL_PAGE_AT_POSITION_VECTORS}: at position 0.5 the carousel shows
 * page 0 but an arrow key steps from page 1. libadwaita is internally
 * inconsistent there and that is ground truth, not a defect to iron out.
 */
export const CAROUSEL_NAVIGATE_VECTORS: ReadonlyArray<CarouselNavigateVector> = [
    { position: 0, nPages: 3, direction: 'back', target: null, rule: 'already at the first page (:489-494)' },
    { position: 2, nPages: 3, direction: 'forward', target: null, rule: 'already at the last page (:495-499)' },
    { position: 0, nPages: 3, direction: 'forward', target: 1, rule: 'one page forward' },
    { position: 2, nPages: 3, direction: 'back', target: 1, rule: 'one page back' },
    {
        position: 0.5,
        nPages: 3,
        direction: 'forward',
        target: 2,
        rule: 'round(0.5) = 1 — half AWAY FROM ZERO, where the page lookup would have answered 0',
    },
    { position: 0.5, nPages: 3, direction: 'back', target: 0, rule: 'the same rounding backwards: 1 − 1' },
    { position: 1.4, nPages: 3, direction: 'back', target: 0, rule: 'round(1.4) = 1, then −1' },
    { position: 1.6, nPages: 3, direction: 'forward', target: null, rule: 'round(1.6) = 2, already the last page' },
    {
        position: 0,
        nPages: 0,
        direction: 'forward',
        target: null,
        rule: 'an empty carousel never navigates (:482-484)',
    },
    { position: 0, nPages: 1, direction: 'forward', target: null, rule: 'a single page is both bounds' },
];

/** One `carouselWheelStep` expectation. */
export interface CarouselWheelVector {
    deltaX: number;
    deltaY: number;
    orientation: CarouselOrientation;
    /** The `GdkInputSource` class of the event. */
    source: CarouselScrollSource;
    /** Pages to step; `0` means the event propagates. */
    step: -1 | 0 | 1;
    rule: string;
}

/**
 * `scroll_cb`'s axis/source rules.
 *
 * CORE-ONLY: GAP — the browser carousel routes `wheel` through `CarouselState.handleWheel` but publishes no per-notch answer to assert, and the NativeScript one has no wheel at all. Tracked in #1072
 */
export const CAROUSEL_WHEEL_VECTORS: ReadonlyArray<CarouselWheelVector> = [
    {
        deltaX: 0,
        deltaY: 53,
        orientation: 'horizontal',
        source: 'mouse',
        step: 1,
        rule: 'a mouse wheel pages a HORIZONTAL carousel — mice rarely have a horizontal wheel (:540-542)',
    },
    { deltaX: 0, deltaY: -53, orientation: 'horizontal', source: 'mouse', step: -1, rule: 'the same, backwards' },
    {
        deltaX: -30,
        deltaY: 0,
        orientation: 'horizontal',
        source: 'mouse',
        step: -1,
        rule: 'the dx FALLBACK the web port dropped: it returned early on |dy| <= |dx|, so this did nothing',
    },
    {
        deltaX: 30,
        deltaY: -53,
        orientation: 'horizontal',
        source: 'mouse',
        step: -1,
        rule: 'dx is only consulted when the vertical branch produced nothing (:554)',
    },
    {
        deltaX: -30,
        deltaY: 0,
        orientation: 'horizontal',
        source: 'touchpad',
        step: 0,
        rule: 'a touchpad always propagates — its kinetic scroll drives the swipe tracker (:537-538)',
    },
    {
        deltaX: 0,
        deltaY: 53,
        orientation: 'horizontal',
        source: 'other',
        step: 0,
        rule: 'a non-mouse device may only scroll ALONG the carousel’s axis',
    },
    {
        deltaX: 53,
        deltaY: 0,
        orientation: 'horizontal',
        source: 'other',
        step: 1,
        rule: 'and along the axis it works for any source',
    },
    {
        deltaX: 0,
        deltaY: -10,
        orientation: 'vertical',
        source: 'other',
        step: -1,
        rule: 'a vertical carousel reads dy',
    },
    {
        deltaX: 53,
        deltaY: 0,
        orientation: 'vertical',
        source: 'mouse',
        step: 0,
        rule: 'a vertical carousel NEVER reads dx — the fallback branch requires GTK_ORIENTATION_HORIZONTAL (:554)',
    },
    { deltaX: 0, deltaY: 0, orientation: 'horizontal', source: 'mouse', step: 0, rule: 'a null event propagates' },
];

/** One step of a wheel-lockout script. */
export interface CarouselWheelLockoutStep {
    /** The value the injected `now()` returns for this event, in ms. */
    at: number;
    /** Vertical delta of the event (all lockout rows use a mouse wheel). */
    deltaY: number;
    /** What `handleWheel` must return. */
    step: -1 | 0 | 1;
    position: number;
}

/** One end-to-end wheel-lockout expectation. */
export interface CarouselWheelLockoutVector {
    /** How many settled pages the carousel starts with. */
    pages: number;
    /** The events, in order, each with the clock reading it arrives at. */
    steps: readonly CarouselWheelLockoutStep[];
    rule: string;
}

/**
 * `SCROLL_TIMEOUT_DURATION` and the `scroll_timeout_id` gate — a wheel notch arms a 150 ms
 * lockout during which further notches propagate instead of paging.
 *
 * A non-decaying delta accumulator is the wrong shape for this: +30 then −30 cancels out
 * where libadwaita pages twice, and a slow wheel never reaches the threshold at all.
 *
 * CORE-ONLY: GAP — the lockout is a real elapsed-time rule and neither element has a clock seam to drive it with. Tracked in #1072
 */
export const CAROUSEL_WHEEL_LOCKOUT_VECTORS: ReadonlyArray<CarouselWheelLockoutVector> = [
    {
        pages: 3,
        steps: [
            { at: 1000, deltaY: 53, step: 1, position: 1 },
            { at: 1100, deltaY: 53, step: 0, position: 1 },
            { at: 1150, deltaY: 53, step: 1, position: 2 },
        ],
        rule: 'a notch 100 ms later propagates; at exactly 150 ms the lockout has expired (g_timeout_add_once fires AT the duration)',
    },
    {
        pages: 3,
        steps: [
            { at: 0, deltaY: 30, step: 1, position: 1 },
            { at: 200, deltaY: -30, step: -1, position: 0 },
        ],
        rule: 'opposite notches page BOTH ways — the accumulator the web port used cancelled them out instead',
    },
    {
        pages: 2,
        steps: [
            { at: 0, deltaY: 53, step: 1, position: 1 },
            { at: 500, deltaY: 53, step: 1, position: 1 },
        ],
        rule: 'a notch at the last page still consumes the event and still arms the lockout (:561-576, :567)',
    },
];

/** One `carouselReorderShift` expectation. */
export interface CarouselReorderShiftVector {
    /** Snap point of the page the carousel is closest to. */
    closestPoint: number;
    oldPoint: number;
    newPoint: number;
    size: number;
    /** How far `position` must move so the visible page does not jump. */
    shift: number;
    rule: string;
}

/**
 * The three branches of `adw_carousel_reorder`'s compensation.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (CAROUSEL_PAGE_LIST_VECTORS)
 */
export const CAROUSEL_REORDER_SHIFT_VECTORS: ReadonlyArray<CarouselReorderShiftVector> = [
    {
        closestPoint: 1,
        oldPoint: 2,
        newPoint: 0,
        size: 1,
        shift: 1,
        rule: 'a page from AFTER the current one moved BEFORE it: one page of content appeared ahead (:1490-1492)',
    },
    {
        closestPoint: 1,
        oldPoint: 0,
        newPoint: 2,
        size: 1,
        shift: -1,
        rule: 'a page from BEFORE moved AFTER: one page of content disappeared ahead (:1493-1495)',
    },
    {
        closestPoint: 1,
        oldPoint: 1,
        newPoint: 2,
        size: 1,
        shift: 1,
        rule: 'the CURRENT page is the one moved, so the position follows it (:1488-1489)',
    },
    {
        closestPoint: 0,
        oldPoint: 1,
        newPoint: 2,
        size: 1,
        shift: 0,
        rule: 'a move entirely on one side of the position changes nothing',
    },
    {
        closestPoint: 1,
        oldPoint: 2,
        newPoint: 0,
        size: 0.5,
        shift: 0.5,
        rule: 'the shift is the moved page’s SIZE, so a half-revealed page shifts by half',
    },
];

/**
 * One operation in a page-list script.
 *
 * `insert` and `remove` mean "and finish the reveal immediately", which is what a carousel
 * with the default `reveal-duration` of 0 does and what both renderers' page APIs do. The
 * mid-animation states are pinned separately by {@link CAROUSEL_REVEAL_VECTORS}.
 */
export type CarouselPageOp =
    | { readonly kind: 'insert'; readonly id: string; readonly position?: number }
    | { readonly kind: 'remove'; readonly id: string }
    | { readonly kind: 'reorder'; readonly id: string; readonly position: number }
    | { readonly kind: 'scrollTo'; readonly index: number }
    | { readonly kind: 'setPosition'; readonly position: number }
    | { readonly kind: 'settle' };

/** The observable state a script must land in. */
export interface CarouselStateSnapshot {
    /** Page ids in order, excluding any whose removal is still animating. */
    ids: readonly string[];
    /** `adw_carousel_get_n_pages` — the same exclusion. */
    nPages: number;
    /** Reveal sizes of every TRACKED child, including ones being removed. */
    sizes: readonly number[];
    snapPoints: readonly number[];
    position: number;
    /** The current page index, `-1` when empty. */
    page: number;
}

/** One end-to-end page-list expectation. */
export interface CarouselPageListVector {
    /** Pages the carousel starts with, all settled at size 1. */
    pages: readonly string[];
    ops: readonly CarouselPageOp[];
    /** What each op returned (`settle` reports `true`). */
    opResults: readonly boolean[];
    /** The `page-changed` indices emitted while the script ran, in order. */
    pageChanged: readonly number[];
    expected: CarouselStateSnapshot;
    rule: string;
}

/**
 * Insert / remove / reorder ordering and the position compensation, on a carousel whose
 * reveals complete instantly — the shape both renderers expose.
 */
export const CAROUSEL_PAGE_LIST_VECTORS: ReadonlyArray<CarouselPageListVector> = [
    {
        pages: ['a', 'b', 'c'],
        ops: [],
        opResults: [],
        pageChanged: [],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 0, page: 0 },
        rule: 'three settled pages sit one unit apart and start on page 0',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'insert', id: 'd' }],
        opResults: [true],
        pageChanged: [],
        expected: {
            ids: ['a', 'b', 'c', 'd'],
            nPages: 4,
            sizes: [1, 1, 1, 1],
            snapPoints: [0, 1, 2, 3],
            position: 0,
            page: 0,
        },
        rule: 'append — `adw_carousel_append` is insert at -1 (:1349-1357)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'insert', id: 'd', position: 7 }],
        opResults: [true],
        pageChanged: [],
        expected: {
            ids: ['a', 'b', 'c', 'd'],
            nPages: 4,
            sizes: [1, 1, 1, 1],
            snapPoints: [0, 1, 2, 3],
            position: 0,
            page: 0,
        },
        rule: 'a position past the end appends — `get_nth_link` returns NULL there (:1388-1391)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'insert', id: 'd', position: 0 }],
        opResults: [true],
        pageChanged: [],
        expected: {
            ids: ['d', 'a', 'b', 'c'],
            nPages: 4,
            sizes: [1, 1, 1, 1],
            snapPoints: [0, 1, 2, 3],
            position: 1,
            page: 1,
        },
        rule: 'prepend — `adw_carousel_prepend` is insert at 0 (:1330-1339). The position moves to 1 so the page on screen is still `a`: a page revealed AT OR BEFORE the current one drags the position with it (`shift_position`, :241-258, :293-294)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'insert', id: 'd', position: -2 }],
        opResults: [false],
        pageChanged: [],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 0, page: 0 },
        rule: 'below -1 fails C’s own precondition (:1381) and adds nothing',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 2 },
            { kind: 'insert', id: 'd', position: 0 },
        ],
        opResults: [true, true],
        pageChanged: [],
        expected: {
            ids: ['d', 'a', 'b', 'c'],
            nPages: 4,
            sizes: [1, 1, 1, 1],
            snapPoints: [0, 1, 2, 3],
            position: 3,
            page: 3,
        },
        rule: 'inserting BEFORE the current page moves the position with it, so the same page stays on screen (`shift_position`, :241-258)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'insert', id: 'd', position: 2 }],
        opResults: [true],
        pageChanged: [],
        expected: {
            ids: ['a', 'b', 'd', 'c'],
            nPages: 4,
            sizes: [1, 1, 1, 1],
            snapPoints: [0, 1, 2, 3],
            position: 0,
            page: 0,
        },
        rule: 'inserting AFTER the current page leaves the position alone',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 2 },
            { kind: 'remove', id: 'a' },
        ],
        opResults: [true, true],
        pageChanged: [],
        expected: { ids: ['b', 'c'], nPages: 2, sizes: [1, 1], snapPoints: [0, 1], position: 1, page: 1 },
        rule: 'removing a page BEFORE the current one pulls the position back so `c` stays on screen',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'remove', id: 'c' }],
        opResults: [true],
        pageChanged: [],
        expected: { ids: ['a', 'b'], nPages: 2, sizes: [1, 1], snapPoints: [0, 1], position: 0, page: 0 },
        rule: 'removing a page AFTER the current one leaves the position alone',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'remove', id: 'zz' }],
        opResults: [false],
        pageChanged: [],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 0, page: 0 },
        rule: 'removing a page that is not there changes nothing',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 1 },
            { kind: 'reorder', id: 'c', position: 0 },
        ],
        opResults: [true, true],
        pageChanged: [],
        expected: { ids: ['c', 'a', 'b'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 2, page: 2 },
        rule: 'a page from after the current one moved before it shifts the position +size, so `b` is still shown (:1490-1492)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 1 },
            { kind: 'reorder', id: 'a', position: 2 },
        ],
        opResults: [true, true],
        pageChanged: [],
        expected: { ids: ['b', 'c', 'a'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 0, page: 0 },
        rule: 'a page from before the current one moved after it shifts −size, so `b` is still shown (:1493-1495)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 1 },
            { kind: 'reorder', id: 'b', position: 2 },
        ],
        opResults: [true, true],
        pageChanged: [],
        expected: { ids: ['a', 'c', 'b'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 2, page: 2 },
        rule: 'moving the CURRENT page carries the position along with it (:1488-1489)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'reorder', id: 'a', position: 0 }],
        opResults: [false],
        pageChanged: [],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 0, page: 0 },
        rule: 'reordering a page to where it already is returns before doing anything (:1439-1440)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'reorder', id: 'c', position: -1 }],
        opResults: [false],
        pageChanged: [],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 0, page: 0 },
        rule: 'moving the LAST page to the end is the second early-out, checked after normalisation (:1448-1449)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'scrollTo', index: 2 }],
        opResults: [true],
        pageChanged: [2],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 2, page: 2 },
        rule: 'a completed scroll emits `page-changed` (:363-376)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'scrollTo', index: 1 },
            { kind: 'scrollTo', index: 1 },
        ],
        opResults: [true, true],
        pageChanged: [1, 1],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 1, page: 1 },
        rule: 'settling back onto the SAME page emits again — the web port’s index-change gate swallowed this',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'scrollTo', index: 99 },
            { kind: 'scrollTo', index: -1 },
            { kind: 'scrollTo', index: 1.5 },
            { kind: 'scrollTo', index: Number.NaN },
        ],
        opResults: [false, false, false, false],
        pageChanged: [],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 0, page: 0 },
        rule: 'out-of-range, fractional and NaN targets are REFUSED, not clamped — `get_nth_page` fails its precondition and `scroll_to` returns on the NULL widget (:1616, :385-386). NaN used to set the NS position to NaN',
    },
    {
        pages: [],
        ops: [{ kind: 'settle' }],
        opResults: [true],
        pageChanged: [-1],
        expected: { ids: [], nPages: 0, sizes: [], snapPoints: [], position: 0, page: -1 },
        rule: 'an empty carousel reports index -1, the case the signal documents (:1150-1151) and neither port could produce',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'setPosition', position: 0.5 }, { kind: 'settle' }],
        opResults: [true, true],
        pageChanged: [0],
        expected: { ids: ['a', 'b', 'c'], nPages: 3, sizes: [1, 1, 1], snapPoints: [0, 1, 2], position: 0.5, page: 0 },
        rule: 'settling half-way reports the LOWER page; both ports reported 1',
    },
];

/** One operation in a reveal script — the mid-animation half of the state machine. */
export type CarouselRevealOp =
    | { readonly kind: 'insert'; readonly id: string; readonly position?: number }
    | { readonly kind: 'reveal'; readonly id: string }
    | { readonly kind: 'size'; readonly id: string; readonly size: number }
    | { readonly kind: 'remove'; readonly id: string }
    | { readonly kind: 'setPosition'; readonly position: number };

/** One end-to-end reveal expectation. */
export interface CarouselRevealVector {
    /** Pages the carousel starts with, all settled at size 1. */
    pages: readonly string[];
    ops: readonly CarouselRevealOp[];
    expected: CarouselStateSnapshot;
    rule: string;
}

/**
 * The reveal lifecycle: a page enters at size 0 and grows, leaves `n-pages` before its
 * geometry, and drags the position along whenever it sits at or before the page on screen.
 */
export const CAROUSEL_REVEAL_VECTORS: ReadonlyArray<CarouselRevealVector> = [
    {
        pages: ['a', 'b', 'c'],
        ops: [{ kind: 'insert', id: 'd', position: 0 }],
        expected: {
            ids: ['d', 'a', 'b', 'c'],
            nPages: 4,
            sizes: [0, 1, 1, 1],
            snapPoints: [-1, 0, 1, 2],
            position: 0,
            page: 1,
        },
        rule: 'immediately after the insert the page has size 0 and a NEGATIVE snap point, and the carousel still shows `a` (:1385-1386, :782)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 1 },
            { kind: 'insert', id: 'd', position: 0 },
            { kind: 'size', id: 'd', size: 0.5 },
        ],
        expected: {
            ids: ['d', 'a', 'b', 'c'],
            nPages: 4,
            sizes: [0.5, 1, 1, 1],
            snapPoints: [-0.5, 0.5, 1.5, 2.5],
            position: 1.5,
            page: 2,
        },
        rule: 'half-way through the reveal the position has moved half a page, so `b` has not slid sideways (`resize_animation_value_cb`, :284-297)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 1 },
            { kind: 'insert', id: 'd', position: 0 },
            { kind: 'reveal', id: 'd' },
        ],
        expected: {
            ids: ['d', 'a', 'b', 'c'],
            nPages: 4,
            sizes: [1, 1, 1, 1],
            snapPoints: [0, 1, 2, 3],
            position: 2,
            page: 2,
        },
        rule: 'once revealed the shift has moved a full page and `b` is still the current one',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 2 },
            { kind: 'remove', id: 'b' },
        ],
        expected: {
            ids: ['a', 'c'],
            nPages: 2,
            sizes: [1, 1, 1],
            snapPoints: [0, 1, 2],
            position: 2,
            page: 1,
        },
        rule: 'a removed page leaves n-pages at once (:1522, :1640-1645) but keeps its geometry, so the pages after it have not moved yet',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 2 },
            { kind: 'remove', id: 'b' },
            { kind: 'size', id: 'b', size: 0.5 },
        ],
        expected: {
            ids: ['a', 'c'],
            nPages: 2,
            sizes: [1, 0.5, 1],
            snapPoints: [0, 0.5, 1.5],
            position: 1.5,
            page: 1,
        },
        rule: 'while it shrinks the position follows, keeping `c` on screen',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 2 },
            { kind: 'remove', id: 'b' },
            { kind: 'reveal', id: 'b' },
        ],
        expected: { ids: ['a', 'c'], nPages: 2, sizes: [1, 1], snapPoints: [0, 1], position: 1, page: 1 },
        rule: 'reaching size 0 drops the entry from the geometry entirely (`resize_animation_done_cb`, :309-313)',
    },
    {
        pages: ['a', 'b'],
        ops: [
            { kind: 'insert', id: 'c' },
            { kind: 'remove', id: 'c' },
        ],
        expected: { ids: ['a', 'b'], nPages: 2, sizes: [1, 1], snapPoints: [0, 1], position: 0, page: 0 },
        rule: 'removing a page that is still revealing frees it on the spot — the skip finishes the animation, which runs the done handler (:329-337 → :309-313)',
    },
    {
        pages: ['a', 'b', 'c'],
        ops: [
            { kind: 'setPosition', position: 1 },
            { kind: 'remove', id: 'b' },
            { kind: 'reveal', id: 'b' },
        ],
        expected: { ids: ['a', 'c'], nPages: 2, sizes: [1, 1], snapPoints: [0, 1], position: 0, page: 0 },
        rule: 'removing the CURRENT page shifts too — `update_shift_position_flag` counts removing children on purpose (:248-249)',
    },
];

/** One property-default expectation. */
export interface CarouselPropertyDefaultVector {
    property:
        | 'orientation'
        | 'interactive'
        | 'allowScrollWheel'
        | 'allowMouseDrag'
        | 'allowLongSwipes'
        | 'spacing'
        | 'revealDuration';
    value: string | number | boolean;
    rule: string;
}

/**
 * The `AdwCarousel` property defaults. Three are regression pins: `allow-scroll-wheel` is
 * TRUE, which a bare attribute-presence read inverts (a plain `<adw-carousel>` then ignores
 * the wheel entirely); `allow-long-swipes` is FALSE; and `allow-mouse-drag` is TRUE, which
 * neither port had at all — a `<adw-carousel>` could not be dragged with a mouse, measured.
 */
export const CAROUSEL_PROPERTY_DEFAULT_VECTORS: ReadonlyArray<CarouselPropertyDefaultVector> = [
    { property: 'orientation', value: 'horizontal', rule: 'adw_carousel_init (:1205)' },
    { property: 'interactive', value: true, rule: 'AdwCarousel:interactive defaults TRUE (:1051-1054)' },
    {
        property: 'allowScrollWheel',
        value: true,
        rule: 'AdwCarousel:allow-scroll-wheel defaults TRUE (:1103-1106, :1201) — the web port defaulted it FALSE',
    },
    {
        property: 'allowMouseDrag',
        value: true,
        rule:
            'AdwCarousel:allow-mouse-drag defaults TRUE (:1091-1094) — the property was ' +
            'absent from both ports, and with it the whole mouse-drag gesture',
    },
    {
        property: 'allowLongSwipes',
        value: false,
        rule: 'AdwCarousel:allow-long-swipes defaults FALSE (:1115-1118) — one flick, one page',
    },
    { property: 'spacing', value: 0, rule: 'AdwCarousel:spacing defaults 0 (:1061-1066)' },
    { property: 'revealDuration', value: 0, rule: 'AdwCarousel:reveal-duration defaults 0 (:1127-1132, :1206)' },
];
