// Headless `Adw.Carousel` — the position arithmetic and the page-list state
// machine (ADR 0004 — headless Adwaita core).
//
// Almost nothing an `AdwCarousel` does is rendering. It keeps an ordered list of
// pages, each with a `size` (the reveal fraction: 0 while a page animates in, 1
// once settled), derives a snap point per page from a prefix sum, and clamps one
// fractional `position` into the range those snap points span. Every lookup the
// widget performs — which page a position settles on, which page a wheel notch
// or an arrow key moves to, how far the position must shift so an insert or a
// reorder does not make the visible page jump — falls out of that arithmetic.
//
// Both renderers re-derived the shallow end of it and diverged from libadwaita
// in ways nothing could catch, because nothing compared them:
//   - `allow-scroll-wheel` defaults to TRUE (adw-carousel.c:1103-1106, :1201).
//     The web port read it as a bare attribute presence, so a plain
//     `<adw-carousel>` ignored the wheel entirely while its own header comment
//     claimed the opposite.
//   - a fractional position of exactly `.5` resolves to the LOWER page: the
//     comparison in `get_closest_child_at` is a strict `>`, so an equidistant
//     later child never replaces the earlier one (:198-201). Both ports used
//     `Math.round`, which rounds .5 UP.
//   - the keynav step deliberately uses a DIFFERENT rule — C's `round()`, half
//     away from zero (:486) — so {@link carouselPageAtPosition} and
//     {@link carouselNavigateTarget} must NOT share a rounding helper. That
//     inconsistency is ground truth, not a bug to iron out.
//   - `page-changed` fires after EVERY completed scroll animation, including a
//     settle back onto the same page, and reports `-1` for an empty carousel
//     (:363-376, :1150-1151). The web port gated it on an index CHANGE (so `-1`
//     was unreachable) and the NS port never emitted it at all.
//   - `scrollToPage(NaN)` corrupted the NS port's position and every dot with
//     it. `AdwCarousel:position` is declared as a double in `[0, G_MAXDOUBLE]`
//     (:1036-1041), so NaN is not a value the property can hold.
//
// This module renders nothing, imports no platform and holds no timer: the
// 150 ms wheel lockout runs off an injected `now()`, the same seam style as
// `ToastScheduler`, and the reveal animation stays in the renderer, which feeds
// its eased values back through {@link CarouselState.setPageSize}.
//
// NOT lifted (deliberately): the indicator metrics — the per-dot progress ramp,
// the line lengths, the measure/centering arithmetic and the RTL draw flip. They
// consume per-page sizes and widget measurements no renderer produces today, so
// they would be spec with no caller. See `conformance/carousel.ts` for what IS
// pinned.
//
// Reference: refs/libadwaita/src/adw-carousel.c (AdwCarousel)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { glibClamp } from './glib.js';

/** `SCROLL_TIMEOUT_DURATION` (adw-carousel.c:22) — the lockout after a wheel step. */
export const CAROUSEL_SCROLL_TIMEOUT_MS = 150;

/**
 * How close to a snap point counts as "the scroll has arrived", in pages —
 * see {@link CarouselState.settleIfArrived}.
 *
 * Not a libadwaita constant: C knows a scroll finished because its own spring
 * animation says so, while a renderer that lets the platform scroll (CSS
 * scroll-snap, a NativeScript `ScrollView`) has only the offset, which lands on
 * a sub-pixel value an exact compare would never match. A hundredth of a page is
 * invisible and far tighter than the 0.02 the web port's old heuristic used.
 */
export const CAROUSEL_SETTLE_EPSILON = 0.01;

/** Which axis the carousel pages along — `GtkOrientable:orientation`. */
export type CarouselOrientation = 'horizontal' | 'vertical';

/** One keynav / wheel step — `AdwNavigationDirection`. */
export type CarouselDirection = 'back' | 'forward';

/**
 * The `GdkInputSource` cases `scroll_cb` distinguishes (adw-carousel.c:537-542).
 * Everything that is neither a touchpad nor a mouse behaves the same, so the
 * three-way split is the whole vocabulary the rule needs.
 */
export type CarouselScrollSource = 'touchpad' | 'mouse' | 'other';

/** The scrollable interval a position is clamped into — `get_range`. */
export interface CarouselRange {
    /** Always 0 (adw-carousel.c:215-216). */
    lower: number;
    /** `MAX (0, position_shift + last snap point)` (:219). */
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
 * `G_APPROX_VALUE (a, b, DBL_EPSILON)` — the tolerance every snap-point
 * comparison in `adw_carousel_reorder` is written with (adw-carousel.c:1488-1495).
 * Snap points are accumulated sums, so two pages that "are" at the same point
 * routinely differ in the last bit.
 */
function approx(a: number, b: number): boolean {
    return Math.abs(a - b) < Number.EPSILON;
}

/**
 * The snap point of every page, from their reveal sizes:
 * `snapPoint[i] = (Σ_{j≤i} size[j]) − 1` (`adw_carousel_size_allocate`,
 * adw-carousel.c:777-789).
 *
 * Sizes are reveal FRACTIONS, not pixels, so mid-animation snap points are
 * fractional — and a page that was just inserted (size 0, :1385) pushes the
 * first snap point NEGATIVE. That is legal and load-bearing: it is what makes
 * the following pages keep their positions while the new one grows in.
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
 * `sizes[i] = points[i] − points[i−1]` (adw-carousel-indicator-dots.c:189-191).
 *
 * This is the ONLY channel through which an indicator learns per-page reveal
 * state — `AdwSwipeable` hands out snap points, never sizes — so an indicator
 * that wants to fade a page in has to reconstruct them.
 */
export function carouselSizesFromSnapPoints(points: readonly number[]): number[] {
    if (points.length === 0) return [];
    const sizes = [points[0]! + 1];
    for (let i = 1; i < points.length; i++) sizes.push(points[i]! - points[i - 1]!);
    return sizes;
}

/**
 * The scrollable range — `get_range` (adw-carousel.c:207-220).
 *
 * `positionShift` is the pending compensation an insert/remove/reorder
 * accumulates before the next allocation; it is part of the bound because C adds
 * it there (:219), so a shift large enough to cancel the last snap point
 * collapses the range to `[0, 0]` rather than going negative.
 */
export function carouselRange(snapPoints: readonly number[], positionShift = 0): CarouselRange {
    const last = snapPoints.length > 0 ? snapPoints[snapPoints.length - 1]! : 0;
    return { lower: 0, upper: Math.max(0, positionShift + last) };
}

/**
 * `set_position`'s guard (adw-carousel.c:269) — the single clamp every position
 * write in the widget goes through.
 *
 * Fractional positions pass through untouched: this bounds the scroll, it does
 * not snap to a page. Uses GLib's `CLAMP`, which tests the HIGH bound first —
 * the range here can never invert, but the primitive is the one C uses.
 */
export function carouselClampPosition(position: number, snapPoints: readonly number[], positionShift = 0): number {
    const range = carouselRange(snapPoints, positionShift);
    return glibClamp(position, range.lower, range.upper);
}

/**
 * The index of the snap point nearest `position`, `-1` for an empty list —
 * `get_closest_child_at` (adw-carousel.c:180-205).
 *
 * The tie-break is the whole point: C replaces its current best only on a strict
 * `>`, so at an exact half-way position the EARLIER page wins. Exported rather
 * than inlined because `get_closest_child_at` is called with four different
 * include/exclude combinations of adding and removing children, and each caller
 * must get the same tie-break.
 */
export function carouselClosestSnapPoint(position: number, snapPoints: readonly number[]): number {
    if (snapPoints.length === 0) return -1;
    let closest = 0;
    for (let i = 1; i < snapPoints.length; i++) {
        if (Math.abs(snapPoints[closest]! - position) > Math.abs(snapPoints[i]! - position)) closest = i;
    }
    return closest;
}

/**
 * The page `position` settles on — `get_page_at_position` (adw-carousel.c:222-239):
 * clamp into the range first, then take the nearest snap point.
 *
 * Returns `-1` for an empty carousel, matching `find_child_index` (:155) and the
 * `page-changed` documentation, which spells that case out (:1150-1151).
 *
 * Rounds an exact `.5` DOWN, via {@link carouselClosestSnapPoint}. Do not
 * "simplify" this to `Math.round`: that is what both ports did, and it disagrees
 * with GTK on every half-way position.
 */
export function carouselPageAtPosition(position: number, snapPoints: readonly number[]): number {
    return carouselClosestSnapPoint(carouselClampPosition(position, snapPoints), snapPoints);
}

/**
 * C's `round()` — half away from zero — as `navigate_to_direction` uses it
 * (adw-carousel.c:486).
 *
 * Deliberately NOT shared with {@link carouselPageAtPosition}, which resolves a
 * tie to the LOWER index. libadwaita is internally inconsistent here and that is
 * ground truth: at position 0.5 the carousel DISPLAYS page 0 but an arrow key
 * steps from page 1. On the non-negative range a position actually reaches the
 * rule coincides with `Math.round`; it is written out so a vertical or
 * shift-compensated position can never quietly take the other branch.
 */
function cRound(value: number): number {
    return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * The page an arrow key moves to, or `null` when the step is refused —
 * `navigate_to_direction` (adw-carousel.c:475-508).
 *
 * `null` means C returned `FALSE`: an empty carousel, or already at the bound in
 * that direction. Home/End are the same operation with targets `0` and
 * `nPages − 1` (`keynav_bounds_cb`, :641-674).
 *
 * The returned index is C's raw `index ± 1` and is NOT clamped — only the WHEEL
 * path clamps (:567). With a position inside `[0, nPages − 1]` it is always in
 * range; outside it, `adw_carousel_get_nth_page`'s precondition (:1616) is what
 * rejects it, which is exactly what {@link CarouselState.scrollTo} does.
 */
export function carouselNavigateTarget(position: number, nPages: number, direction: CarouselDirection): number | null {
    if (nPages <= 0) return null;
    const index = cRound(position);
    if (direction === 'back') return index > 0 ? index - 1 : null;
    return index < nPages - 1 ? index + 1 : null;
}

/**
 * How many pages one scroll event moves — `scroll_cb`'s axis rules
 * (adw-carousel.c:537-559). `0` means "propagate the event", the only case where
 * C returns `GDK_EVENT_PROPAGATE` from this part of the handler.
 *
 * Three rules, all of which one port or the other loses:
 *   - a TOUCHPAD source is always ignored (:537-538), because its kinetic
 *     scrolling is already driving the swipe tracker;
 *   - the vertical delta counts when the carousel is vertical OR the source is a
 *     mouse — "mice often don't have easily accessible horizontal scrolling"
 *     (:540-542, :547-552);
 *   - the horizontal delta is a FALLBACK: consulted only for a horizontal
 *     carousel, and only when the vertical branch produced nothing (:554-559).
 *     The web port dropped it entirely by returning early on `|dy| <= |dx|`.
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
 * How far the position must move so the visible page does not jump when a page
 * is reordered — the `position_shift` delta of `adw_carousel_reorder`
 * (adw-carousel.c:1488-1495).
 *
 * Three branches: the moved page IS the current one (follow it, `newPoint −
 * oldPoint`); it crossed the current position from after to before (`+size`, the
 * content ahead grew by that page); or from before to after (`−size`). Anything
 * that does not cross the position leaves it alone. Every comparison is
 * epsilon-tolerant, because snap points are accumulated sums.
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
 * Which of C's three "tell someone" sites a {@link CarouselStateChange} came
 * from. libadwaita has three distinct ones and collapsing them into a single
 * opaque notification would lose information the GObject API has:
 *   - `position` — `set_position` notified `notify::position` (adw-carousel.c:281);
 *   - `n-pages`  — an insert or a remove notified `notify::n-pages` (:1406, :1531);
 *   - `geometry` — only `gtk_widget_queue_allocate` ran: a size or order change
 *     that moved no position (:296, :1498).
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
     * `true` for a user navigation (wheel, keynav, an interactive scroll),
     * `false` for a programmatic or model-driven one. libadwaita notifies
     * unconditionally (:281) — the flag exists so a bound indicator can tell the
     * two apart, not so a renderer can drop the notification.
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
 * A scroll the state machine wants performed — the renderer seam, in the shape
 * of `AdwToastQueueHandlers`' `onShow`/`onHide`.
 *
 * The core owns WHICH page is scrolled to (the wheel and keynav paths compute it
 * and no renderer should redo that); the renderer owns HOW, because that is a
 * DOM `scrollTo` on one side and a `scrollToHorizontalOffset` on the other.
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

/**
 * Construction seams and the libadwaita property DEFAULTS, which both ports got
 * wrong or omitted.
 */
export interface CarouselStateOptions {
    /** `GtkOrientable:orientation`, default `'horizontal'` (adw-carousel.c:1205). */
    orientation?: CarouselOrientation;
    /** `AdwCarousel:interactive`, default TRUE (:1051-1054). Gates wheel + keynav. */
    interactive?: boolean;
    /** `AdwCarousel:allow-scroll-wheel`, default TRUE (:1103-1106, :1201). */
    allowScrollWheel?: boolean;
    /** `AdwCarousel:allow-long-swipes`, default FALSE (:1115-1118). */
    allowLongSwipes?: boolean;
    /** `AdwCarousel:spacing` in px, default 0 (:1061-1066). Feeds `distance` (:767). */
    spacing?: number;
    /** `AdwCarousel:reveal-duration` in ms, default 0 (:1127-1132, :1206). */
    revealDuration?: number;
    /** Clock for the wheel lockout. Injected, never a global — default `Date.now`. */
    now?: () => number;
    /** Renderer seam invoked for every accepted {@link CarouselState.scrollTo}. */
    onScrollTo?: (request: CarouselScrollRequest) => void;
    /**
     * Default for `adw_carousel_scroll_to`'s `animate` argument (:1571-1598).
     *
     * The core has no animator, so `true` means the RENDERER drives the ramp:
     * `scrollTo` only issues the {@link CarouselScrollRequest} and waits for the
     * renderer to feed positions back through {@link CarouselState.setPosition}
     * and finish with {@link CarouselState.settle}. `false` (the default) is
     * `do_scroll_to`'s skip path (:1541-1542): the position jumps to the target
     * and `page-changed` fires at once.
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

/** `adw_carousel_get_nth_page`'s precondition (adw-carousel.c:1616), as a recorded string. */
function nthPageDiagnostic(index: number, nPages: number): string {
    return `adw_carousel_get_nth_page: assertion 'n < adw_carousel_get_n_pages (self)' failed (n = ${index}, n_pages = ${nPages})`;
}

/** `adw_carousel_insert`/`_reorder`'s precondition (adw-carousel.c:1381, :1431). */
function positionDiagnostic(fn: string, position: number): string {
    return `${fn}: assertion 'position >= -1' failed (position = ${position})`;
}

/** No C equivalent — C holds widget pointers, this model holds ids. */
function unknownPageDiagnostic(id: string): string {
    return `AdwCarousel: no page with id '${id}'`;
}

/** The `AdwCarousel:position` param spec's own bounds (adw-carousel.c:1036-1041). */
function nonFiniteDiagnostic(what: string, value: number): string {
    return `AdwCarousel: ${what} must be a finite double (got ${value})`;
}

/**
 * The page list of an `Adw.Carousel` plus its fractional position — the insert /
 * reorder / remove ordering rules, the `position_shift` bookkeeping, the wheel
 * lockout and the `page-changed` emission, once, for every renderer.
 *
 * The reveal ANIMATION is not here: a renderer feeds its eased values through
 * {@link setPageSize}, and a carousel with the default `reveal-duration` of 0
 * calls {@link skipReveal} instead. What is here is everything that decides what
 * those sizes MEAN — snap points, the range, which page is current, and how far
 * the position has to move so the visible page stays put.
 *
 * Two array shapes appear and they are not the same length while a removal
 * animates: {@link snapPoints} and {@link sizes} cover every tracked child
 * (`adw_carousel_get_snap_points`, :1260-1283, walks all of them), while
 * {@link nPages} and {@link indexOf} skip the ones being removed
 * (`adw_carousel_get_n_pages`, :1640-1645). That is C, and an indicator that
 * conflated them would drop a dot the moment a page started shrinking.
 */
export class CarouselState {
    private readonly _children: CarouselChild[] = [];
    private _position = 0;
    private _orientation: CarouselOrientation;
    private _interactive: boolean;
    private _allowScrollWheel: boolean;
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
        this._allowLongSwipes = options.allowLongSwipes ?? false;
        this._spacing = options.spacing ?? 0;
        this._revealDuration = options.revealDuration ?? 0;
        this._now = options.now ?? (() => Date.now());
        this._onScrollTo = options.onScrollTo;
        this._animateScroll = options.animateScroll ?? false;
    }

    // --- subscriptions ---

    /** Subscribe to state changes. Returns an unsubscribe function. */
    subscribe(listener: CarouselStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /** Subscribe to `page-changed` (adw-carousel.c:1153-1165). Returns an unsubscribe function. */
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

    // --- geometry ---

    /** Number of pages, skipping ones whose removal is still animating (:1640-1645). */
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

    /** Every tracked child's snap point — `adw_carousel_get_snap_points` (:1260-1283). */
    get snapPoints(): number[] {
        return carouselSnapPoints(this.sizes);
    }

    /** The scrollable range the position is clamped into. */
    get range(): CarouselRange {
        return carouselRange(this.snapPoints);
    }

    /**
     * Snap points of the pages that still count — the array every page LOOKUP
     * runs against, because `get_page_at_position` excludes removing children
     * (`get_closest_child_at (…, TRUE, FALSE)`, :233) and `find_child_index`
     * numbers them out too (:146-147).
     *
     * Their values still come from the full accumulation, so a shrinking page
     * keeps pushing the pages after it until it reaches size 0.
     */
    private _visibleSnapPoints(): number[] {
        const points = this.snapPoints;
        return points.filter((_point, index) => !this._children[index]!.removing);
    }

    /**
     * The page `position` settles on, `-1` when the carousel is empty.
     *
     * C clamps against the FULL range here (:229-231) while searching only the
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
     * FALSE)` skips a removing child before it ever compares (:146-147).
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
     * `info->snap_point`, which is what `scroll_to` animates towards (:1618,
     * :392-393).
     *
     * A renderer needs this to tell "the scroll has arrived" from "the scroll is
     * still moving", and it must not index {@link snapPoints} by a page index to
     * get it: those two arrays disagree while a removal is animating.
     */
    snapPointOf(index: number): number | undefined {
        const link = this._nthLink(index);
        return link < 0 ? undefined : this.snapPoints[link];
    }

    /** Full-list index of the `n`-th page that counts, `-1` when out of range — `get_nth_link` (:158-178). */
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
     * `update_shift_position_flag` (adw-carousel.c:241-258): a page that is at or
     * BEFORE the currently-shown one must drag the position along as it grows or
     * shrinks, otherwise the visible page slides sideways under the user.
     *
     * The lookup deliberately EXCLUDES adding children and INCLUDES removing
     * ones (:249), so the position still follows a page that is being removed
     * while it is the active one.
     */
    private _updateShiftPositionFlag(index: number): void {
        const closest = this._closestChildIndex(this._position, false, true);
        if (closest < 0) return;
        this._children[index]!.shiftPosition = closest >= index;
    }

    /** `set_position`'s per-child refresh of the shift flags (adw-carousel.c:274-279). */
    private _updateShiftFlags(): void {
        this._children.forEach((child, index) => {
            if (child.adding || child.removing) this._updateShiftPositionFlag(index);
        });
    }

    // --- position ---

    /**
     * `set_position` (adw-carousel.c:260-282) — clamp, store, refresh the shift
     * flags, notify. Returns whether the stored value changed; the notification
     * fires either way, because C's `g_object_notify_by_pspec` at :281 is
     * unconditional and a bound indicator that only repaints on a CHANGE misses
     * the settle back onto the page it started from.
     *
     * A non-finite position is refused outright and recorded in
     * {@link diagnostics}. `AdwCarousel:position` is a double declared over
     * `[0, G_MAXDOUBLE]` (:1036-1041), so NaN is outside the property's own
     * contract — and letting one through is what left the NativeScript port with
     * a NaN position and no active dot at all.
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
     * Scroll to a page — `adw_carousel_get_nth_page` + `scroll_to` (:1609-1621,
     * :378-397). Returns whether the scroll was accepted.
     *
     * Out-of-range, negative and non-integer indices are REFUSED, not clamped:
     * `get_nth_page` fails its precondition and hands `scroll_to` a NULL widget,
     * which returns before touching anything (:385-386). Only the wheel path
     * clamps, and it does so before it gets here (:567). The refusal is recorded
     * in {@link diagnostics}, which is where `scrollToPage(NaN)` now ends up
     * instead of in the position.
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
     * `scroll_animation_done_cb` (adw-carousel.c:363-376) — the scroll has come to
     * rest, so emit `page-changed` with the page the position landed on.
     *
     * Emitted after EVERY completed scroll, including one that settles back onto
     * the page it started from, and with index `-1` when the carousel is empty —
     * the case the signal's own documentation calls out (:1150-1151) and that the
     * web port's index-change gate made unreachable.
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
     * A DEVIATION with a reason: `scroll_animation_done_cb` (:363-376) is driven
     * by the spring animation finishing, and neither CSS scroll-snap nor a
     * NativeScript `ScrollView` has an equivalent — both only report offsets. So
     * ARRIVAL at a snap point stands in for "the animation finished", and the
     * one-shot bookkeeping lives here rather than in two renderers, where it
     * would be the third copy of the same idea to drift.
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
     * One keynav step — `keynav_cb` → `navigate_to_direction` (:579-639, :475-508).
     * Returns whether the carousel moved.
     *
     * The `interactive` gate lives here because `keynav_cb` checks it before
     * calling `navigate_to_direction` (:588); `adw_carousel_scroll_to` is NOT
     * gated, which is why {@link scrollTo} isn't either.
     */
    navigate(direction: CarouselDirection): boolean {
        if (!this._interactive) return false;
        const target = carouselNavigateTarget(this._position, this.nPages, direction);
        if (target === null) return false;
        return this.scrollTo(target, { interactive: true });
    }

    /**
     * One scroll-wheel event — `scroll_cb` (adw-carousel.c:510-577). Returns the
     * step taken; `0` means the event was NOT consumed and must propagate, which
     * is the only value for which C returns `GDK_EVENT_PROPAGATE`.
     *
     * The four gates run in C's order — the property, the 150 ms lockout,
     * `interactive`, and an empty carousel (:523-533) — then the axis rules, then
     * one clamped page step and a fresh lockout (:566-574). A step that is
     * refused by the clamp (already on the last page) still consumes the event
     * and still arms the lockout, exactly as C does.
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

    // --- page list ---

    /**
     * `adw_carousel_insert` (adw-carousel.c:1370-1407). Returns whether the page
     * was added.
     *
     * `position` is `-1` (append, the default) or an index to insert BEFORE; an
     * index past the end appends too, because `get_nth_link` returns NULL there
     * (:1388-1391 + the documented behaviour at :1366-1368). Anything below `-1`
     * fails C's precondition (:1381) and is recorded instead.
     *
     * The page starts at size 0 and `adding` (:1385-1386) — it occupies no
     * geometry yet, which is what pushes the first snap point negative. A
     * renderer either ramps it with {@link setPageSize} or, with the default
     * `reveal-duration` of 0, finishes it at once with {@link skipReveal}.
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

        // `animate_child_resize` sets the flag before it starts the reveal (:327).
        this._updateShiftPositionFlag(at);
        this._emit('n-pages', false);
        return true;
    }

    /**
     * `adw_carousel_remove` (adw-carousel.c:1508-1532). Returns whether a page was
     * removed.
     *
     * The page leaves {@link nPages} immediately (:1522 + :1640-1645) but keeps
     * its geometry until its size reaches 0, so the pages after it slide over
     * instead of jumping. A page that is still ANIMATING IN disappears at once
     * instead: `animate_child_resize` skips the in-flight reveal, and finishing
     * it runs `resize_animation_done_cb`, which frees a removing child on the
     * spot (:329-337 → :309-313). C runs that skipped reveal to its target first
     * and banks the shift; dropping the child outright lands in the same state,
     * because the banked shift and the geometry it paid for are freed together.
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
     * `adw_carousel_reorder` (adw-carousel.c:1419-1499). Returns whether the page
     * moved.
     *
     * `position` is `-1` or past the end for "move to the end". The three
     * early-outs are C's and they are not interchangeable: a `position` equal to
     * the page's CURRENT one returns before normalisation (:1439-1440), and
     * moving the last page to the end is a no-op checked after it (:1448-1449).
     * The position compensation is {@link carouselReorderShift}.
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

        // `get_closest_snap_point` (:399-409) counts adding AND removing children.
        const closestIndex = this._closestChildIndex(this._position, true, true);
        const points = this.snapPoints;
        const closestPoint = closestIndex < 0 ? 0 : points[closestIndex]!;
        const oldPoint = points[oldIndex]!;

        const nPages = this.nPages;
        const target = position < 0 || position > nPages ? nPages : position;
        if (oldIndex === nPages - 1 && target === nPages) return false;

        // `next_link` — the entry to insert before, resolved BEFORE the move so
        // `prev` still points at the pre-move neighbour (:1451-1467).
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
     * Feed one frame of a page's reveal animation —
     * `resize_animation_value_cb` + `resize_animation_done_cb` (:284-316).
     * Returns whether the size was applied.
     *
     * A size change on a page at or before the current one moves the position by
     * the same delta (:293-294), which is what keeps the visible page still while
     * a page grows in ahead of it. C banks that delta in `position_shift` and
     * applies it at the next `size_allocate` (:732-736); with no allocation cycle
     * to wait for, it is applied here — the settled state is identical.
     *
     * Reaching the animation's target ENDS it: a page that arrives at 1 stops
     * being `adding`, and one that arrives at 0 while removing is dropped from
     * the geometry (:306-313).
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
     * Finish a page's pending reveal or removal at once — `adw_animation_skip`
     * (:331), which jumps a timed animation to its target value.
     *
     * This is the whole reveal for a carousel with the default `reveal-duration`
     * of 0 (:1206), which is what both renderers run today, and it keeps the
     * "which value does this page animate TO" rule out of both of them. Returns
     * whether anything was pending.
     *
     * An unknown id is NOT a diagnostic here, unlike everywhere else: removing a
     * page that was still revealing frees it on the spot (:329-337), so a
     * renderer that finishes what it just removed legitimately finds nothing.
     */
    skipReveal(id: string): boolean {
        const child = this._children.find((entry) => entry.id === id);
        if (!child) return false;
        if (!child.adding && !child.removing) return false;
        return this.setPageSize(id, child.removing ? 0 : 1);
    }

    // --- properties ---

    /** `GtkOrientable:orientation` — which axis the carousel pages along. */
    get orientation(): CarouselOrientation {
        return this._orientation;
    }

    /** Set the orientation. Returns whether it changed (:982-992). */
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

    /** Set `interactive`. Returns whether it changed (:1694-1708). */
    setInteractive(value: boolean): boolean {
        const next = !!value;
        if (next === this._interactive) return false;
        this._interactive = next;
        return true;
    }

    /** `AdwCarousel:allow-scroll-wheel` — default TRUE, which both ports lost. */
    get allowScrollWheel(): boolean {
        return this._allowScrollWheel;
    }

    /** Set `allow-scroll-wheel`. Returns whether it changed (:1852-1866). */
    setAllowScrollWheel(value: boolean): boolean {
        const next = !!value;
        if (next === this._allowScrollWheel) return false;
        this._allowScrollWheel = next;
        return true;
    }

    /**
     * `AdwCarousel:allow-long-swipes` — whether one flick may cross more than one
     * snap point. Forwarded to the swipe tracker in C (:1900-1914); the state
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

    /** `AdwCarousel:spacing` in px — the gap between pages, part of `distance` (:767). */
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
     * The px distance between two page origins — `self->distance` (:767), the
     * unit a renderer converts a position into a scroll offset with.
     * `pageLength` is the measured size of the largest page along the
     * carousel's own axis.
     */
    pageDistance(pageLength: number): number {
        return pageLength + this._spacing;
    }

    /**
     * Every warning C would have printed, in order — the refused scroll targets,
     * the bad insert/reorder positions, the unknown page ids and the non-finite
     * values. Kept as data so a test can assert on the CLASS of mistake instead
     * of on stderr; both ports swallowed all of them.
     */
    get diagnostics(): readonly string[] {
        return this._diagnostics;
    }
}
