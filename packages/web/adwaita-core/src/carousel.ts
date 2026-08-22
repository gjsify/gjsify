// Headless `Adw.Carousel` — the position arithmetic and the page-list state
// machine (ADR 0004 — headless Adwaita core).
//
// An ordered list of pages, each with a `size` (the reveal fraction: 0 while a page
// animates in, 1 once settled), a snap point per page from a prefix sum, and one
// fractional `position` clamped into the range those snap points span. Every lookup
// the widget performs falls out of that arithmetic.
//
// Four rules a reader would otherwise get wrong:
// - `allow-scroll-wheel` and `interactive` default to TRUE; an HTML boolean
// attribute is absent-means-false, so a renderer must invert deliberately.
// - a fractional position of exactly `.5` resolves to the LOWER page: the
// comparison in `get_closest_child_at` is a strict `>`, so an equidistant later
// child never replaces the earlier one. `Math.round` rounds.5 UP and is wrong.
// - the keynav step deliberately uses a DIFFERENT rule — C's `round()`, half away
// from zero — so {@link carouselPageAtPosition} and
// {@link carouselNavigateTarget} must NOT share a rounding helper. That
// inconsistency is ground truth, not a bug to iron out.
// - `page-changed` fires after EVERY completed scroll animation, including a
// settle back onto the same page, and reports `-1` for an empty carousel.
//
// No platform import and no timer: the 150 ms wheel lockout runs off an injected
// `now()`, and the reveal animation stays in the renderer, which feeds its eased
// values back through {@link CarouselState.setPageSize}.
//
// NOT lifted: the indicator metrics — per-dot progress ramp, line lengths,
// measure/centering arithmetic, RTL draw flip. They consume per-page sizes and
// widget measurements no renderer produces today, so they would be spec with no
// caller. `conformance/carousel.ts` has what IS pinned.
//
// Reference: refs/libadwaita/src/adw-carousel.c (AdwCarousel)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { swipeClosestPointIndex } from './swipe.js';

import { glibClamp } from './glib.js';

/** `SCROLL_TIMEOUT_DURATION` — the lockout after a wheel step. */
export const CAROUSEL_SCROLL_TIMEOUT_MS = 150;

/**
 * How close to a snap point counts as "arrived", in pages — {@link
 * CarouselState.settleIfArrived}. Not a libadwaita constant: C knows a scroll finished
 * from its own spring animation, while a renderer that lets the platform scroll (CSS
 * scroll-snap, a NativeScript `ScrollView`) has only a sub-pixel offset.
 */
export const CAROUSEL_SETTLE_EPSILON = 0.01;

/** Which axis the carousel pages along — `GtkOrientable:orientation`. */
export type CarouselOrientation = 'horizontal' | 'vertical';

/** One keynav / wheel step — `AdwNavigationDirection`. */
export type CarouselDirection = 'back' | 'forward';

/**
 * The `GdkInputSource` cases `scroll_cb` distinguishes.
 * Everything that is neither a touchpad nor a mouse behaves the same, so the
 * three-way split is the whole vocabulary the rule needs.
 */
export type CarouselScrollSource = 'touchpad' | 'mouse' | 'other';

/** The scrollable interval a position is clamped into — `get_range`. */
export interface CarouselRange {
    /** Always 0. */
    lower: number;
    /** `MAX (0, position_shift + last snap point)`. */
    upper: number;
}

/** Input to {@link carouselWheelStep} — one scroll event, already normalized. */
export interface CarouselWheelInput {
    /** Horizontal delta; positive scrolls forward. */
    deltaX: number;
    /** Vertical delta; positive scrolls forward. */
    deltaY: number;
    /** The carousel's orientation, which decides which axis counts. */
    orientation: CarouselOrientation;
    /** The device the event came from. */
    source: CarouselScrollSource;
}

/** Arguments of {@link carouselReorderShift} — all four snap-point values it compares. */
export interface CarouselReorderShiftInput {
    /** Snap point of the page the carousel is currently closest to. */
    closestPoint: number;
    /** Snap point the moved page had before the move. */
    oldPoint: number;
    /** Snap point it lands on. */
    newPoint: number;
    /** The moved page's reveal size — how much geometry crosses the position. */
    size: number;
}

/**
 * `G_APPROX_VALUE (a, b, DBL_EPSILON)` — the tolerance every snap-point comparison in
 * `adw_carousel_reorder` is written with, because snap points are accumulated sums and
 * two pages at "the same" point routinely differ in the last bit.
 */
function approx(a: number, b: number): boolean {
    return Math.abs(a - b) < Number.EPSILON;
}

/**
 * The snap point of every page, from their reveal sizes:
 * `snapPoint[i] = (Σ_{j≤i} size[j]) − 1` (`adw_carousel_size_allocate`).
 *
 * Sizes are reveal FRACTIONS, so mid-animation snap points are fractional and a
 * just-inserted page (size 0) pushes the first one NEGATIVE — legal, and what keeps the
 * following pages in place while the new one grows in.
 */
export function carouselSnapPoints(sizes: readonly number[]): number[] {
    let accumulated = 0;
    return sizes.map((size) => {
        const point = accumulated + size - 1;
        accumulated += size;
        return point;
    });
}

/**
 * The inverse of {@link carouselSnapPoints}: `sizes[0] = points[0] + 1` and
 * `sizes[i] = points[i] − points[i−1]`. The ONLY channel by which an indicator learns
 * per-page reveal state, since `AdwSwipeable` hands out snap points and never sizes.
 */
export function carouselSizesFromSnapPoints(points: readonly number[]): number[] {
    if (points.length === 0) return [];
    const sizes = [points[0]! + 1];
    for (let i = 1; i < points.length; i++) sizes.push(points[i]! - points[i - 1]!);
    return sizes;
}

/**
 * One page's measurement along the carousel's axis, in the terms
 * `adw_carousel_size_allocate` asks each child for.
 */
export interface CarouselPageMeasurement {
    /** What `gtk_widget_measure` reports as the natural size along that axis. */
    natural: number;
    /** What it reports as the minimum, `CLAMP`'s LOW bound. Defaults to 0. */
    minimum?: number;
    /** `gtk_widget_get_hexpand` (`get_vexpand` when vertical): this page wants the whole carousel. */
    expand?: boolean;
}

/** The two lengths `adw_carousel_size_allocate` settles before it places anything. */
export interface CarouselPageAllocation {
    /** `child_width` / `child_height`: the size EVERY page is allocated, not just the current one. */
    pageSize: number;
    /** `(width − child_width) / 2`: the empty half-gap the page strip starts at. */
    leadingInset: number;
}

/**
 * How big every page is, and how far in from the carousel's edge the strip of pages
 * starts (`adw_carousel_size_allocate`, adw-carousel.c:748-767 and :796-806).
 *
 * A page is NOT "the carousel's size". Every page is allocated the SAME size, the
 * largest of what the pages ask for and never more than the carousel has: a page that
 * expands takes the whole carousel, any other takes `CLAMP (natural, minimum,
 * available)`. Whatever is left over is then split in half, because the strip is drawn
 * at an offset of `-(width - child_width) / 2`, which centres the current page and lets
 * the two neighbours show through at the edges by `leadingInset - spacing` each.
 *
 * That peek is why this is core arithmetic rather than a renderer's CSS: the web port
 * pinned its pages at 100% of the carousel, which is right only when `leadingInset`
 * happens to be 0, so a 440px page in a 480px carousel had both neighbours entirely off
 * screen where GTK shows 20px of each.
 *
 * `glibClamp`, not `Math.min`/`Math.max`: `CLAMP` tests its HIGH bound first, so a page
 * whose MINIMUM exceeds the carousel gets its minimum and the strip legitimately
 * overhangs, with `leadingInset` going negative.
 *
 * The gap BETWEEN pages is not here: that is `spacing`, which
 * {@link CarouselState.pageDistance} adds to this size to get `self->distance`.
 */
export function carouselPageAllocation(
    available: number,
    pages: readonly CarouselPageMeasurement[],
): CarouselPageAllocation {
    let pageSize = 0;
    for (const page of pages) {
        const size = page.expand ? available : glibClamp(page.natural, page.minimum ?? 0, available);
        pageSize = Math.max(pageSize, size);
    }
    return { pageSize, leadingInset: (available - pageSize) / 2 };
}

/**
 * The scrollable range — `get_range`. `positionShift` is the pending compensation an
 * insert/remove/reorder accumulates before the next allocation, and is part of the bound
 * because C adds it there: a shift large enough to cancel the last snap point collapses
 * the range to `[0, 0]` rather than going negative.
 */
export function carouselRange(snapPoints: readonly number[], positionShift = 0): CarouselRange {
    const last = snapPoints.length > 0 ? snapPoints[snapPoints.length - 1]! : 0;
    return { lower: 0, upper: Math.max(0, positionShift + last) };
}

/**
 * `set_position`'s guard — the single clamp every position write goes through. Fractional
 * positions pass through untouched: this bounds the scroll, it does not snap to a page.
 * Uses GLib's `CLAMP`, which tests the HIGH bound first.
 */
export function carouselClampPosition(position: number, snapPoints: readonly number[], positionShift = 0): number {
    const range = carouselRange(snapPoints, positionShift);
    return glibClamp(position, range.lower, range.upper);
}

/**
 * The index of the snap point nearest `position`, `-1` for an empty list —
 * `get_closest_child_at`. C replaces its current best only on a strict `>`, so at an
 * exact half-way position the EARLIER page wins. Exported because C calls it with four
 * different adding/removing include combinations and each must get the same tie-break.
 */
export function carouselClosestSnapPoint(position: number, snapPoints: readonly number[]): number {
    // Delegated to `find_closest_point` in `./swipe.ts`, which is the identical scan with
    // the identical tie-break. Two copies of it were here and there for as long as both
    // modules existed, and the whole rule is one comparison operator: flipping `<` to
    // `<=` in either would move every half-way position by a page in that renderer only.
    // What stays here is the `-1` contract, which the tracker's callers do not need
    // because they guard emptiness first.
    if (snapPoints.length === 0) return -1;
    return swipeClosestPointIndex(snapPoints, position);
}

/**
 * The page `position` settles on — `get_page_at_position`: clamp into the range, then
 * take the nearest snap point. `-1` for an empty carousel. Rounds an exact `.5` DOWN via
 * {@link carouselClosestSnapPoint}; do not "simplify" it to `Math.round`, which disagrees
 * with GTK on every half-way position.
 */
export function carouselPageAtPosition(position: number, snapPoints: readonly number[]): number {
    return carouselClosestSnapPoint(carouselClampPosition(position, snapPoints), snapPoints);
}

/**
 * C's `round()` — half away from zero — as `navigate_to_direction` uses it. Deliberately
 * NOT shared with {@link carouselPageAtPosition}, which resolves a tie to the LOWER
 * index: at position 0.5 the carousel DISPLAYS page 0 but an arrow key steps from page 1.
 * Written out rather than `Math.round` so a negative position cannot take the other
 * branch.
 */
function cRound(value: number): number {
    return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * The page an arrow key moves to, or `null` when the step is refused —
 * `navigate_to_direction`.
 *
 * `null` means C returned `FALSE`: an empty carousel, or already at the bound in that
 * direction. Home/End are the same operation with targets `0` and `nPages − 1`
 * (`keynav_bounds_cb`). The returned index is C's raw `index ± 1`, NOT clamped — only the
 * WHEEL path clamps; outside `[0, nPages − 1]` `adw_carousel_get_nth_page`'s precondition
 * rejects it, as {@link CarouselState.scrollTo} does.
 */
export function carouselNavigateTarget(position: number, nPages: number, direction: CarouselDirection): number | null {
    if (nPages <= 0) return null;
    const index = cRound(position);
    if (direction === 'back') return index > 0 ? index - 1 : null;
    return index < nPages - 1 ? index + 1 : null;
}

/**
 * How many pages one scroll event moves — `scroll_cb`'s axis rules. `0` means "propagate
 * the event", the only case where C returns `GDK_EVENT_PROPAGATE` here. Three rules:
 * - a TOUCHPAD source is always ignored, because its kinetic scrolling is already
 * driving the swipe tracker;
 * - the vertical delta counts when the carousel is vertical OR the source is a
 * mouse — "mice often don't have easily accessible horizontal scrolling";
 * - the horizontal delta is a FALLBACK: consulted only for a horizontal carousel,
 * and only when the vertical branch produced nothing.
 */
export function carouselWheelStep(input: CarouselWheelInput): -1 | 0 | 1 {
    if (input.source === 'touchpad') return 0;

    const allowVertical = input.source === 'mouse';
    let index: -1 | 0 | 1 = 0;

    if (input.orientation === 'vertical' || allowVertical) {
        if (input.deltaY > 0) index = 1;
        else if (input.deltaY < 0) index = -1;
    }

    if (input.orientation === 'horizontal' && index === 0) {
        if (input.deltaX > 0) index = 1;
        else if (input.deltaX < 0) index = -1;
    }

    return index;
}

/**
 * How far the position must move so the visible page does not jump when a page is
 * reordered — the `position_shift` delta of `adw_carousel_reorder`. Three branches: the
 * moved page IS the current one (follow it, `newPoint − oldPoint`); it crossed the
 * position from after to before (`+size`); or from before to after (`−size`). Anything
 * that does not cross the position leaves it alone.
 */
export function carouselReorderShift(args: CarouselReorderShiftInput): number {
    const { closestPoint, oldPoint, newPoint, size } = args;
    if (approx(closestPoint, oldPoint)) return newPoint - oldPoint;
    if (
        (approx(oldPoint, closestPoint) || oldPoint > closestPoint) &&
        (approx(closestPoint, newPoint) || closestPoint > newPoint)
    ) {
        return size;
    }
    if (
        (approx(newPoint, closestPoint) || newPoint > closestPoint) &&
        (approx(closestPoint, oldPoint) || closestPoint > oldPoint)
    ) {
        return -size;
    }
    return 0;
}

/**
 * Which of C's three notification sites a {@link CarouselStateChange} came from;
 * collapsing them into one opaque notification would lose what the GObject API has:
 * - `position` — `set_position` notified `notify::position`;
 * - `n-pages` — an insert or a remove notified `notify::n-pages`;
 * - `geometry` — only `gtk_widget_queue_allocate` ran: a size or order change that
 * moved no position.
 */
export type CarouselChangeReason = 'position' | 'n-pages' | 'geometry';

/** Payload of a {@link CarouselState} notification. */
export interface CarouselStateChange {
    /** The clamped fractional scroll position. */
    position: number;
    /** Number of pages, excluding ones whose removal is still animating. */
    nPages: number;
    /** {@link carouselPageAtPosition} for the current position; `-1` when empty. */
    page: number;
    /**
     * `true` for a user navigation (wheel, keynav, interactive scroll), `false` for a
     * programmatic one. libadwaita notifies unconditionally — the flag lets a bound
     * indicator tell the two apart, not a renderer drop the notification.
     */
    interactive: boolean;
    /** Which C notification site this corresponds to. */
    reason: CarouselChangeReason;
}

/** Subscriber for {@link CarouselState} changes. */
export type CarouselStateListener = (change: CarouselStateChange) => void;

/** Subscriber for `page-changed` — `index` is `-1` for an empty carousel. */
export type CarouselPageChangedListener = (index: number) => void;

/**
 * A scroll the state machine wants performed — the renderer seam, in the shape of
 * `AdwToastQueueHandlers`' `onShow`/`onHide`. The core owns WHICH page is scrolled to
 * and no renderer should redo that; the renderer owns HOW, because that is a DOM
 * `scrollTo` on one side and a `scrollToHorizontalOffset` on the other.
 */
export interface CarouselScrollRequest {
    /** Target page index, always a valid index into the non-removing pages. */
    index: number;
    /** Its snap point — the value `position` must end up at. */
    position: number;
    /** Whether this came from a user navigation. */
    interactive: boolean;
    /** Whether the renderer is expected to animate (and then call `settle()`). */
    animate: boolean;
}

/** Construction seams and the libadwaita property DEFAULTS. */
export interface CarouselStateOptions {
    /** `GtkOrientable:orientation`, default `'horizontal'`. */
    orientation?: CarouselOrientation;
    /** `AdwCarousel:interactive`, default TRUE. Gates wheel + keynav. */
    interactive?: boolean;
    /** `AdwCarousel:allow-scroll-wheel`, default TRUE. */
    allowScrollWheel?: boolean;
    /** `AdwCarousel:allow-mouse-drag`, default TRUE. */
    allowMouseDrag?: boolean;
    /** `AdwCarousel:allow-long-swipes`, default FALSE. */
    allowLongSwipes?: boolean;
    /** `AdwCarousel:spacing` in px, default 0. Feeds `distance`. */
    spacing?: number;
    /** `AdwCarousel:reveal-duration` in ms, default 0. */
    revealDuration?: number;
    /** Clock for the wheel lockout. Injected, never a global — default `Date.now`. */
    now?: () => number;
    /** Renderer seam invoked for every accepted {@link CarouselState.scrollTo}. */
    onScrollTo?: (request: CarouselScrollRequest) => void;
    /**
     * Default for `adw_carousel_scroll_to`'s `animate` argument. The core has no animator,
     * so `true` means the RENDERER drives the ramp — `scrollTo` issues the
     * {@link CarouselScrollRequest} and waits for positions fed back through
     * {@link CarouselState.setPosition} then {@link CarouselState.settle}. `false` (the
     * default) is `do_scroll_to`'s skip path: the position jumps and `page-changed` fires.
     */
    animateScroll?: boolean;
}

/** Per-call overrides for {@link CarouselState.scrollTo}. */
export interface CarouselScrollOptions {
    /** Tag the resulting change as a user navigation. Default `false`. */
    interactive?: boolean;
    /** Override {@link CarouselStateOptions.animateScroll} for this scroll. */
    animate?: boolean;
}

/** Internal page record — the fields of C's `ChildInfo` that are not geometry. */
interface CarouselChild {
    id: string;
    /** Reveal fraction in `[0, 1]`; 0 while animating in, 1 once settled. */
    size: number;
    /** `ChildInfo.adding` — set on insert, cleared when the reveal completes. */
    adding: boolean;
    /** `ChildInfo.removing` — the page is gone from `n-pages` but still occupies geometry. */
    removing: boolean;
    /** `ChildInfo.shift_position` — whether growing this page must move the position with it. */
    shiftPosition: boolean;
}

/** `adw_carousel_get_nth_page`'s precondition, as a recorded string. */
function nthPageDiagnostic(index: number, nPages: number): string {
    return `adw_carousel_get_nth_page: assertion 'n < adw_carousel_get_n_pages (self)' failed (n = ${index}, n_pages = ${nPages})`;
}

/** `adw_carousel_insert`/`_reorder`'s precondition. */
function positionDiagnostic(fn: string, position: number): string {
    return `${fn}: assertion 'position >= -1' failed (position = ${position})`;
}

/** No C equivalent — C holds widget pointers, this model holds ids. */
function unknownPageDiagnostic(id: string): string {
    return `AdwCarousel: no page with id '${id}'`;
}

/** The `AdwCarousel:position` param spec's own bounds. */
function nonFiniteDiagnostic(what: string, value: number): string {
    return `AdwCarousel: ${what} must be a finite double (got ${value})`;
}

/**
 * The page list of an `Adw.Carousel` plus its fractional position — the insert /
 * reorder / remove ordering rules, the `position_shift` bookkeeping, the wheel
 * lockout and the `page-changed` emission, once, for every renderer.
 *
 * The reveal ANIMATION is not here: a renderer feeds its eased values through
 * {@link setPageSize}, and a carousel with the default `reveal-duration` of 0 calls
 * {@link skipReveal} instead.
 *
 * Two array shapes appear and they are NOT the same length while a removal animates:
 * {@link snapPoints} and {@link sizes} cover every tracked child
 * (`adw_carousel_get_snap_points` walks all of them), while {@link nPages} and
 * {@link indexOf} skip the ones being removed (`adw_carousel_get_n_pages`). That is
 * C; an indicator that conflated them would drop a dot the moment a page started
 * shrinking.
 */
export class CarouselState {
    private readonly _children: CarouselChild[] = [];
    private _position = 0;
    private _orientation: CarouselOrientation;
    private _interactive: boolean;
    private _allowScrollWheel: boolean;
    private _allowMouseDrag: boolean;
    private _allowLongSwipes: boolean;
    private _spacing: number;
    private _revealDuration: number;
    private readonly _now: () => number;
    private readonly _onScrollTo: ((request: CarouselScrollRequest) => void) | undefined;
    private readonly _animateScroll: boolean;
    /** When the current wheel lockout started, `null` while no lockout is armed. */
    private _wheelLockedAt: number | null = null;
    /** The page {@link settleIfArrived} last reported, `null` while the scroll is moving. */
    private _settledPage: number | null = null;
    private readonly _listeners = new Set<CarouselStateListener>();
    private readonly _pageChangedListeners = new Set<CarouselPageChangedListener>();
    private readonly _diagnostics: string[] = [];

    constructor(options: CarouselStateOptions = {}) {
        this._orientation = options.orientation ?? 'horizontal';
        this._interactive = options.interactive ?? true;
        this._allowScrollWheel = options.allowScrollWheel ?? true;
        this._allowMouseDrag = options.allowMouseDrag ?? true;
        this._allowLongSwipes = options.allowLongSwipes ?? false;
        this._spacing = options.spacing ?? 0;
        this._revealDuration = options.revealDuration ?? 0;
        this._now = options.now ?? (() => Date.now());
        this._onScrollTo = options.onScrollTo;
        this._animateScroll = options.animateScroll ?? false;
    }

    /** Subscribe to state changes. Returns an unsubscribe function. */
    subscribe(listener: CarouselStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Subscribe to `page-changed`. Returns an unsubscribe function. */
    onPageChanged(listener: CarouselPageChangedListener): () => void {
        this._pageChangedListeners.add(listener);
        return () => {
            this._pageChangedListeners.delete(listener);
        };
    }

    private _emit(reason: CarouselChangeReason, interactive: boolean): void {
        const change: CarouselStateChange = {
            position: this._position,
            nPages: this.nPages,
            page: this.pageAt(this._position),
            interactive,
            reason,
        };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live
        for (const listener of [...this._listeners]) listener(change);
    }

    /** Number of pages, skipping ones whose removal is still animating. */
    get nPages(): number {
        let count = 0;
        for (const child of this._children) if (!child.removing) count++;
        return count;
    }

    /** The ids of the pages that count towards {@link nPages}, in order. */
    get ids(): readonly string[] {
        return this._children.filter((child) => !child.removing).map((child) => child.id);
    }

    /** The clamped fractional scroll position (`AdwCarousel:position`). */
    get position(): number {
        return this._position;
    }

    /** Every tracked child's reveal size, INCLUDING ones being removed. */
    get sizes(): number[] {
        return this._children.map((child) => child.size);
    }

    /** Every tracked child's snap point — `adw_carousel_get_snap_points`. */
    get snapPoints(): number[] {
        return carouselSnapPoints(this.sizes);
    }

    /** The scrollable range the position is clamped into. */
    get range(): CarouselRange {
        return carouselRange(this.snapPoints);
    }

    /**
     * Snap points of the pages that still count — the array every page LOOKUP runs
     * against, because `get_page_at_position` excludes removing children
     * (`get_closest_child_at (…, TRUE, FALSE)`) and `find_child_index` numbers them out
     * too. Their values still come from the full accumulation, so a shrinking page
     * keeps pushing the pages after it until it reaches size 0.
     */
    private _visibleSnapPoints(): number[] {
        const points = this.snapPoints;
        return points.filter((_point, index) => !this._children[index]!.removing);
    }

    /**
     * The page `position` settles on, `-1` when the carousel is empty.
     *
     * C clamps against the FULL range here while searching only the
     * visible children; clamping against the visible points instead cannot
     * change the answer, because snap points ascend and both clamps land at or
     * beyond the last visible one, where the nearest visible point is the same.
     */
    pageAt(position: number): number {
        return carouselPageAtPosition(position, this._visibleSnapPoints());
    }

    /**
     * Index of the page with `id` among the pages that count, `-1` when it is
     * unknown OR is being removed — `find_child_index (…, count_removing =
     * FALSE)` skips a removing child before it ever compares.
     */
    indexOf(id: string): number {
        let index = 0;
        for (const child of this._children) {
            if (child.removing) continue;
            if (child.id === id) return index;
            index++;
        }
        return -1;
    }

    /**
     * The snap point of the `index`-th page that counts, `undefined` when the
     * index is out of range — `adw_carousel_get_nth_page` followed by reading
     * `info->snap_point`, which is what `scroll_to` animates towards.
     *
     * A renderer needs this to tell "the scroll has arrived" from "the scroll is
     * still moving", and it must not index {@link snapPoints} by a page index to
     * get it: those two arrays disagree while a removal is animating.
     */
    snapPointOf(index: number): number | undefined {
        const link = this._nthLink(index);
        return link < 0 ? undefined : this.snapPoints[link];
    }

    /** Full-list index of the `n`-th page that counts, `-1` when out of range — `get_nth_link`. */
    private _nthLink(n: number): number {
        let remaining = n;
        for (let i = 0; i < this._children.length; i++) {
            if (this._children[i]!.removing) continue;
            if (remaining-- === 0) return i;
        }
        return -1;
    }

    /** Full-list index of the child nearest `position`, honouring C's include flags. */
    private _closestChildIndex(position: number, countAdding: boolean, countRemoving: boolean): number {
        const points = this.snapPoints;
        const candidateIndices: number[] = [];
        const candidatePoints: number[] = [];
        this._children.forEach((child, index) => {
            if (child.adding && !countAdding) return;
            if (child.removing && !countRemoving) return;
            candidateIndices.push(index);
            candidatePoints.push(points[index]!);
        });
        const closest = carouselClosestSnapPoint(position, candidatePoints);
        return closest < 0 ? -1 : candidateIndices[closest]!;
    }

    /**
     * `update_shift_position_flag`: a page at or BEFORE the currently-shown one must
     * drag the position along as it grows or shrinks, otherwise the visible page slides
     * sideways under the user. The lookup deliberately EXCLUDES adding children and
     * INCLUDES removing ones, so the position still follows a page being removed while
     * it is the active one.
     */
    private _updateShiftPositionFlag(index: number): void {
        const closest = this._closestChildIndex(this._position, false, true);
        if (closest < 0) return;
        this._children[index]!.shiftPosition = closest >= index;
    }

    /** `set_position`'s per-child refresh of the shift flags. */
    private _updateShiftFlags(): void {
        this._children.forEach((child, index) => {
            if (child.adding || child.removing) this._updateShiftPositionFlag(index);
        });
    }

    /**
     * `set_position` — clamp, store, refresh the shift flags, notify. Returns whether
     * the stored value changed; the notification fires either way, because C's
     * `g_object_notify_by_pspec` is unconditional and a bound indicator that only
     * repaints on a CHANGE misses the settle back onto the page it started from.
     *
     * A non-finite position is refused outright and recorded in {@link diagnostics}:
     * `AdwCarousel:position` is a double declared over `[0, G_MAXDOUBLE]`, so NaN is
     * outside the property's own contract.
     */
    setPosition(position: number, interactive = false): boolean {
        if (!Number.isFinite(position)) {
            this._diagnostics.push(nonFiniteDiagnostic('position', position));
            return false;
        }
        const next = carouselClampPosition(position, this.snapPoints);
        const changed = next !== this._position;
        this._position = next;
        this._updateShiftFlags();
        this._emit('position', interactive);
        return changed;
    }

    /**
     * Scroll to a page — `adw_carousel_get_nth_page` + `scroll_to`. Returns whether the
     * scroll was accepted.
     *
     * Out-of-range, negative and non-integer indices are REFUSED, not clamped:
     * `get_nth_page` fails its precondition and hands `scroll_to` a NULL widget, which
     * returns before touching anything. Only the wheel path clamps, and it does so
     * before it gets here. The refusal is recorded in {@link diagnostics}.
     */
    scrollTo(index: number, options: CarouselScrollOptions = {}): boolean {
        const nPages = this.nPages;
        if (!Number.isInteger(index) || index < 0 || index >= nPages) {
            this._diagnostics.push(nthPageDiagnostic(index, nPages));
            return false;
        }
        const interactive = options.interactive ?? false;
        const animate = options.animate ?? this._animateScroll;
        const target = this.snapPointOf(index)!;

        this._onScrollTo?.({ index, position: target, interactive, animate });
        if (!animate) {
            this.setPosition(target, interactive);
            this.settle();
        }
        return true;
    }

    /**
     * `scroll_animation_done_cb` — the scroll has come to rest, so emit `page-changed`
     * with the page the position landed on. Emitted after EVERY completed scroll,
     * including one that settles back onto the page it started from, and with index
     * `-1` when the carousel is empty (a case the signal's documentation calls out).
     */
    settle(): void {
        const index = this.pageAt(this._position);
        this._settledPage = index;
        // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: a listener may unsubscribe mid-fan-out
        for (const listener of [...this._pageChangedListeners]) listener(index);
    }

    /**
     * {@link settle} for a renderer that does not own its scroll animation:
     * emits `page-changed` the first time the position comes to rest on a snap
     * point, and re-arms as soon as it leaves one. Returns whether it emitted.
     *
     * A DEVIATION with a reason: `scroll_animation_done_cb` is driven by the spring
     * animation finishing, and neither CSS scroll-snap nor a NativeScript `ScrollView`
     * has an equivalent — both only report offsets. ARRIVAL at a snap point therefore
     * stands in for "the animation finished".
     */
    settleIfArrived(epsilon = CAROUSEL_SETTLE_EPSILON): boolean {
        const page = this.pageAt(this._position);
        const target = this.snapPointOf(page);
        if (target === undefined || Math.abs(this._position - target) >= epsilon) {
            this._settledPage = null;
            return false;
        }
        if (this._settledPage === page) return false;
        this.settle();
        return true;
    }

    /**
     * One keynav step — `keynav_cb` → `navigate_to_direction`. Returns whether the
     * carousel moved. The `interactive` gate lives here because `keynav_cb` checks it
     * before calling `navigate_to_direction`; `adw_carousel_scroll_to` is NOT gated,
     * which is why {@link scrollTo} isn't either.
     */
    navigate(direction: CarouselDirection): boolean {
        if (!this._interactive) return false;
        const target = carouselNavigateTarget(this._position, this.nPages, direction);
        if (target === null) return false;
        return this.scrollTo(target, { interactive: true });
    }

    /**
     * One scroll-wheel event — `scroll_cb`. Returns the step taken; `0` means the event
     * was NOT consumed and must propagate, the only value for which C returns
     * `GDK_EVENT_PROPAGATE`.
     *
     * The four gates run in C's order — the property, the 150 ms lockout,
     * `interactive`, an empty carousel — then the axis rules, then one clamped page step
     * and a fresh lockout. A step refused by the clamp (already on the last page) still
     * consumes the event and still arms the lockout, exactly as C does.
     */
    handleWheel(input: Omit<CarouselWheelInput, 'orientation'>): -1 | 0 | 1 {
        if (!this._allowScrollWheel) return 0;
        if (this._wheelLockedAt !== null && this._now() - this._wheelLockedAt < CAROUSEL_SCROLL_TIMEOUT_MS) return 0;
        if (!this._interactive) return 0;

        const nPages = this.nPages;
        if (nPages === 0) return 0;

        const step = carouselWheelStep({ ...input, orientation: this._orientation });
        if (step === 0) return 0;

        const target = glibClamp(this.pageAt(this._position) + step, 0, nPages - 1);
        this.scrollTo(target, { interactive: true });
        this._wheelLockedAt = this._now();
        return step;
    }

    /**
     * `adw_carousel_insert`. Returns whether the page was added.
     *
     * `position` is `-1` (append, the default) or an index to insert BEFORE; an index
     * past the end appends too, because `get_nth_link` returns NULL there. Anything
     * below `-1` fails C's precondition and is recorded instead.
     *
     * The page starts at size 0 and `adding` — it occupies no geometry yet, which is
     * what pushes the first snap point negative. A renderer either ramps it with
     * {@link setPageSize} or, with the default `reveal-duration` of 0, finishes it at
     * once with {@link skipReveal}.
     */
    insertPage(id: string, position = -1): boolean {
        if (!Number.isInteger(position) || position < -1) {
            this._diagnostics.push(positionDiagnostic('adw_carousel_insert', position));
            return false;
        }

        const child: CarouselChild = { id, size: 0, adding: true, removing: false, shiftPosition: false };
        const before = position >= 0 ? this._nthLink(position) : -1;
        const at = before < 0 ? this._children.length : before;
        this._children.splice(at, 0, child);

        // `animate_child_resize` sets the flag before it starts the reveal.
        this._updateShiftPositionFlag(at);
        this._emit('n-pages', false);
        return true;
    }

    /**
     * `adw_carousel_remove`. Returns whether a page was removed.
     *
     * The page leaves {@link nPages} immediately but keeps its geometry until its size
     * reaches 0, so the pages after it slide over instead of jumping. A page still
     * ANIMATING IN disappears at once instead: `animate_child_resize` skips the
     * in-flight reveal, and finishing it runs `resize_animation_done_cb`, which frees a
     * removing child on the spot. C runs that skipped reveal to its target first and
     * banks the shift; dropping the child outright lands in the same state, because the
     * banked shift and the geometry it paid for are freed together.
     */
    removePage(id: string): boolean {
        const index = this._children.findIndex((child) => child.id === id && !child.removing);
        if (index < 0) {
            this._diagnostics.push(unknownPageDiagnostic(id));
            return false;
        }

        const child = this._children[index]!;
        child.removing = true;
        this._updateShiftPositionFlag(index);
        if (child.adding) this._children.splice(index, 1);

        this._emit('n-pages', false);
        return true;
    }

    /**
     * `adw_carousel_reorder`. Returns whether the page moved.
     *
     * `position` is `-1` or past the end for "move to the end". The three early-outs are
     * C's and are not interchangeable: a `position` equal to the page's CURRENT one
     * returns before normalisation, and moving the last page to the end is a no-op
     * checked after it. The position compensation is {@link carouselReorderShift}.
     */
    reorderPage(id: string, position: number): boolean {
        if (!Number.isInteger(position) || position < -1) {
            this._diagnostics.push(positionDiagnostic('adw_carousel_reorder', position));
            return false;
        }

        const oldIndex = this._children.findIndex((child) => child.id === id);
        if (oldIndex < 0) {
            this._diagnostics.push(unknownPageDiagnostic(id));
            return false;
        }
        if (position === oldIndex) return false;

        // `get_closest_snap_point` counts adding AND removing children.
        const closestIndex = this._closestChildIndex(this._position, true, true);
        const points = this.snapPoints;
        const closestPoint = closestIndex < 0 ? 0 : points[closestIndex]!;
        const oldPoint = points[oldIndex]!;

        const nPages = this.nPages;
        const target = position < 0 || position > nPages ? nPages : position;
        if (oldIndex === nPages - 1 && target === nPages) return false;

        // `next_link` — the entry to insert before, resolved BEFORE the move so
        // `prev` still points at the pre-move neighbour.
        let nextIndex: number;
        if (target === nPages) nextIndex = -1;
        else if (target > oldIndex) nextIndex = this._nthLink(target + 1);
        else nextIndex = this._nthLink(target);

        let newPoint: number;
        if (nextIndex >= 0) newPoint = target > oldIndex ? points[nextIndex - 1]! : points[nextIndex]!;
        else newPoint = points[points.length - 1]!;

        const [child] = this._children.splice(oldIndex, 1);
        if (nextIndex < 0) this._children.push(child!);
        else this._children.splice(nextIndex > oldIndex ? nextIndex - 1 : nextIndex, 0, child!);

        const shift = carouselReorderShift({ closestPoint, oldPoint, newPoint, size: child!.size });
        if (shift === 0) {
            this._emit('geometry', false);
            return true;
        }
        this._position = carouselClampPosition(this._position + shift, this.snapPoints);
        this._updateShiftFlags();
        this._emit('position', false);
        return true;
    }

    /**
     * Feed one frame of a page's reveal animation — `resize_animation_value_cb` +
     * `resize_animation_done_cb`. Returns whether the size was applied.
     *
     * A size change on a page at or before the current one moves the position by the
     * same delta, which keeps the visible page still while a page grows in ahead of it.
     * C banks that delta in `position_shift` and applies it at the next `size_allocate`;
     * with no allocation cycle to wait for it is applied here — the settled state is
     * identical.
     *
     * Reaching the animation's target ENDS it: a page that arrives at 1 stops being
     * `adding`, one that arrives at 0 while removing is dropped from the geometry.
     */
    setPageSize(id: string, size: number): boolean {
        if (!Number.isFinite(size)) {
            this._diagnostics.push(nonFiniteDiagnostic(`size of page '${id}'`, size));
            return false;
        }
        const index = this._children.findIndex((child) => child.id === id);
        if (index < 0) {
            this._diagnostics.push(unknownPageDiagnostic(id));
            return false;
        }

        const child = this._children[index]!;
        const delta = size - child.size;
        const shifts = child.shiftPosition && delta !== 0;
        child.size = size;

        if (child.removing && size <= 0) this._children.splice(index, 1);
        else if (child.adding && size >= 1) child.adding = false;

        if (!shifts) {
            this._emit('geometry', false);
            return true;
        }
        this._position = carouselClampPosition(this._position + delta, this.snapPoints);
        this._updateShiftFlags();
        this._emit('position', false);
        return true;
    }

    /**
     * Finish a page's pending reveal or removal at once — `adw_animation_skip`,
     * which jumps a timed animation to its target value.
     *
     * This is the whole reveal for a carousel with the default `reveal-duration` of 0.
     * Returns whether anything was pending.
     *
     * An unknown id is NOT a diagnostic here, unlike everywhere else: removing a page
     * that was still revealing frees it on the spot, so a renderer that finishes what it
     * just removed legitimately finds nothing.
     */
    skipReveal(id: string): boolean {
        const child = this._children.find((entry) => entry.id === id);
        if (!child) return false;
        if (!child.adding && !child.removing) return false;
        return this.setPageSize(id, child.removing ? 0 : 1);
    }

    /** `GtkOrientable:orientation` — which axis the carousel pages along. */
    get orientation(): CarouselOrientation {
        return this._orientation;
    }

    /** Set the orientation. Returns whether it changed. */
    setOrientation(orientation: CarouselOrientation): boolean {
        if (orientation === this._orientation) return false;
        this._orientation = orientation;
        this._emit('geometry', false);
        return true;
    }

    /** `AdwCarousel:interactive` — whether the carousel can be navigated at all. */
    get interactive(): boolean {
        return this._interactive;
    }

    /** Set `interactive`. Returns whether it changed. */
    setInteractive(value: boolean): boolean {
        const next = !!value;
        if (next === this._interactive) return false;
        this._interactive = next;
        return true;
    }

    /** `AdwCarousel:allow-scroll-wheel` — default TRUE. */
    get allowScrollWheel(): boolean {
        return this._allowScrollWheel;
    }

    /** Set `allow-scroll-wheel`. Returns whether it changed. */
    setAllowScrollWheel(value: boolean): boolean {
        const next = !!value;
        if (next === this._allowScrollWheel) return false;
        this._allowScrollWheel = next;
        return true;
    }

    /**
     * `AdwCarousel:allow-mouse-drag` — whether a POINTER may drag the strip, as opposed
     * to touch, which always can. Defaults TRUE (:1091-1094), and the C documents the
     * off switch as "dragging is only available on touch".
     *
     * Carried here and not in the renderer for the same reason `allow-long-swipes` is:
     * it is a property of the widget, so both ports declare it and one vector table pins
     * its default. The GESTURE is the renderer's — in a browser a mouse drag has to be
     * implemented, because unlike touch there is no native one to inherit.
     */
    get allowMouseDrag(): boolean {
        return this._allowMouseDrag;
    }

    /** Set `allow-mouse-drag`. Returns whether it changed. */
    setAllowMouseDrag(value: boolean): boolean {
        const next = !!value;
        if (next === this._allowMouseDrag) return false;
        this._allowMouseDrag = next;
        return true;
    }

    /**
     * `AdwCarousel:allow-long-swipes` — whether one flick may cross more than one
     * snap point. Forwarded to the swipe tracker in C; the state
     * machine only carries it, because the gesture itself is the renderer's.
     */
    get allowLongSwipes(): boolean {
        return this._allowLongSwipes;
    }

    /** Set `allow-long-swipes`. Returns whether it changed. */
    setAllowLongSwipes(value: boolean): boolean {
        const next = !!value;
        if (next === this._allowLongSwipes) return false;
        this._allowLongSwipes = next;
        return true;
    }

    /** `AdwCarousel:spacing` in px — the gap between pages, part of `distance`. */
    get spacing(): number {
        return this._spacing;
    }

    /** Set `spacing`. Returns whether it changed. A `guint` in C, so negatives are refused. */
    setSpacing(spacing: number): boolean {
        if (!Number.isFinite(spacing) || spacing < 0) {
            this._diagnostics.push(nonFiniteDiagnostic('spacing', spacing));
            return false;
        }
        if (spacing === this._spacing) return false;
        this._spacing = spacing;
        this._emit('geometry', false);
        return true;
    }

    /** `AdwCarousel:reveal-duration` in ms — how long a page takes to grow in. */
    get revealDuration(): number {
        return this._revealDuration;
    }

    /** Set `reveal-duration`. Returns whether it changed. A `guint` in C. */
    setRevealDuration(ms: number): boolean {
        if (!Number.isFinite(ms) || ms < 0) {
            this._diagnostics.push(nonFiniteDiagnostic('reveal-duration', ms));
            return false;
        }
        if (ms === this._revealDuration) return false;
        this._revealDuration = ms;
        return true;
    }

    /**
     * The px distance between two page origins — `self->distance`, the unit a renderer
     * converts a position into a scroll offset with. `pageLength` is the measured size of
     * the largest page along the carousel's own axis.
     */
    pageDistance(pageLength: number): number {
        return pageLength + this._spacing;
    }

    /**
     * Every warning C would have printed, in order — refused scroll targets, bad
     * insert/reorder positions, unknown page ids, non-finite values. Data rather than
     * stderr so a test can assert on the CLASS of mistake.
     */
    get diagnostics(): readonly string[] {
        return this._diagnostics;
    }
}
