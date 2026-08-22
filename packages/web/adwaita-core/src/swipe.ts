// AdwSwipeTracker's decision logic — headless (ADR 0004).
//
// A swipeable widget in libadwaita does almost nothing itself. `AdwCarousel`'s three
// swipe callbacks are four lines each: `begin` pauses its animation, `update` writes the
// progress it is handed, `end` scrolls to the page the tracker chose
// (adw-carousel.c:412-435). Everything that decides WHERE a gesture lands lives in
// `AdwSwipeTracker`, and this module is that half — the event history, the velocity, the
// projection and the snap-point choice. The gesture SOURCE (a pointer drag, a scroll
// event, a touch) stays with the renderer, because that is platform, not behaviour.
//
// THE UNIT MIX IS UPSTREAM'S, AND PORTING IT "CORRECTLY" WOULD DIVERGE
//
// Progress is in pages (or whatever a snap point counts). Velocity is NOT: the history
// records the RAW delta the platform reported — pixels for a drag, scroll units for a
// touchpad — so velocity is raw-units per millisecond, and `gesture_update` is the only
// place a delta is divided at all. For a DRAG the divisor is the page pitch
// (adw-swipe-tracker.c:749); for a SCROLL it is a constant,
// `TOUCHPAD_BASE_DISTANCE_H`/`_V` (:809, applied at :897), which is why those two are
// exported here as well. The projection then multiplies the velocity by
// {@link swipeSlope} and adds the result to a progress in pages.
//
// UPSTREAM MIXES THEM A SECOND TIME, which settles whether this is a bug to fix:
// `end_swipe_cb` hands the same raw velocity to
// `adw_spring_animation_set_initial_velocity` on a spring whose value range is snap
// points (adw-carousel.c:394-395).
//
// So the two are bridged by a tuned constant and nothing else, and the consequence is
// visible: a flick at the same finger speed projects the same NUMBER OF PAGES on a
// 200 px page and on a 1000 px one. Dividing by the pitch would look like a bug fix and
// would change every carousel's feel away from GTK's. The thresholds read as speeds
// because that is what they are — `VELOCITY_THRESHOLD_TOUCH` 0.3 is 300 px/s.
//
// NO OVERSHOOT HERE. `AdwSwipeTracker` can let progress travel past the first or last
// snap point, and three widgets turn that on (`adw-bottom-sheet.c`,
// `adw-navigation-view.c`, `adw-overlay-split-view.c`). `AdwCarousel` does not — it
// never calls either setter — so this module clamps hard and the rubber-band arithmetic
// (`adjust_for_overshoot`) is left for the first widget that needs it.
//
// NOT HERE, and each for a reason a reader will look for. `reversed` (RTL) — the web
// carousel does not work in RTL at all yet, so a sign flip would be dead code
// (`elements/swipe-drag.ts`, plus an entry in status/open-todos.md). `enabled` — that is
// `AdwCarousel:interactive`, which `adw_carousel_set_interactive` forwards straight to
// `adw_swipe_tracker_set_enabled` (adw-carousel.c:1705), so the renderer gates it. The
// `prepare` SIGNAL — the tracker emits it so a widget can refuse a gesture before it
// starts; `AdwCarousel` never connects to it, and the two widgets that do have their
// gating ported already (`canStartSwipe` in `./split-view.ts`). The four animation
// constants are dead in the C itself, referenced nowhere.
//
// Reference: refs/libadwaita/src/adw-swipe-tracker.c (get_end_progress, calculate_velocity,
//   get_bounds, find_point_for_projection, trim_history, gesture_prepare)
// Reference: refs/libadwaita/src/adw-carousel.c (begin_swipe_cb, update_swipe_cb, end_swipe_cb)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Ported to TypeScript for @gjsify/adwaita-core; the gesture source and
// the animation stay with the renderer.

/** `EVENT_HISTORY_THRESHOLD_MS` — how far back the velocity is measured. */
export const ADW_SWIPE_HISTORY_THRESHOLD_MS = 150;

/** `DRAG_THRESHOLD_DISTANCE` — px of travel before a drag becomes a swipe. */
export const ADW_SWIPE_DRAG_THRESHOLD = 16;

/** `VELOCITY_THRESHOLD_TOUCH` — below this (raw units/ms) a touch swipe just snaps back. */
export const ADW_SWIPE_VELOCITY_THRESHOLD_TOUCH = 0.3;

/** `VELOCITY_THRESHOLD_TOUCHPAD` — the touchpad's higher bar, since its deltas are denser. */
export const ADW_SWIPE_VELOCITY_THRESHOLD_TOUCHPAD = 0.6;

/** `DECELERATION_TOUCH`. Feeds {@link swipeSlope}; never used directly. */
export const ADW_SWIPE_DECELERATION_TOUCH = 0.998;

/** `DECELERATION_TOUCHPAD`. */
export const ADW_SWIPE_DECELERATION_TOUCHPAD = 0.997;

/** `VELOCITY_CURVE_THRESHOLD` — above this the projection leaves the straight line. */
export const ADW_SWIPE_VELOCITY_CURVE_THRESHOLD = 2;

/** `DECELERATION_PARABOLA_MULTIPLIER`. */
export const ADW_SWIPE_PARABOLA_MULTIPLIER = 0.35;

/** `EPSILON` — how close to a snap point counts as being ON it. */
export const ADW_SWIPE_EPSILON = 0.005;

/**
 * `TOUCHPAD_BASE_DISTANCE_H` / `_V` — what a SCROLL delta is divided by instead of the
 * page pitch (adw-swipe-tracker.c:809).
 *
 * Exported although nothing divides by them yet: {@link AdwSwipeSource} offers
 * `'touchpad'` and the two touchpad constants above, and a caller handed those without
 * the divisor has half an API.
 */
export const ADW_SWIPE_TOUCHPAD_BASE_DISTANCE_H = 400;
export const ADW_SWIPE_TOUCHPAD_BASE_DISTANCE_V = 300;

/**
 * GLib's `CLAMP`, which tests the HIGH bound first.
 *
 * Not the same function as `Math.min(Math.max(x, low), high)` when the range is inverted
 * — `get_bounds` can produce `upper < lower` for a position past the last point — and
 * this is the order every clamp in the C uses.
 */
function clamp(value: number, low: number, high: number): number {
    if (value > high) return high;
    if (value < low) return low;
    return value;
}

/** Which input drove the gesture. It picks the threshold and the deceleration, nothing else. */
export type AdwSwipeSource = 'touch' | 'touchpad';

/**
 * `decel / (1 - decel) / 1000` — the constant that turns a velocity into a distance.
 *
 * A function rather than two more constants because the arithmetic is the interesting
 * part: at `0.998` it is `0.499`, so ~2 raw units/ms projects one page, which is what
 * makes {@link ADW_SWIPE_VELOCITY_CURVE_THRESHOLD} sit exactly where the straight line
 * would start over-shooting.
 */
export function swipeSlope(source: AdwSwipeSource): number {
    const deceleration = source === 'touchpad' ? ADW_SWIPE_DECELERATION_TOUCHPAD : ADW_SWIPE_DECELERATION_TOUCH;
    return deceleration / (1 - deceleration) / 1000;
}

/** The velocity a gesture must beat to be a flick rather than a nudge. */
export function swipeVelocityThreshold(source: AdwSwipeSource): number {
    return source === 'touchpad' ? ADW_SWIPE_VELOCITY_THRESHOLD_TOUCHPAD : ADW_SWIPE_VELOCITY_THRESHOLD_TOUCH;
}

/**
 * Index of the snap point nearest `position`. `find_closest_point`.
 *
 * A tie takes the EARLIER point, because the scan only replaces its best on a strict
 * `<`. `carouselClosestSnapPoint` in `./carousel.ts` is `get_closest_child_at`, the same
 * arithmetic with the same tie-break — upstream has it twice too, once per file — so
 * that one now delegates here rather than keeping a second copy of a rule whose halves
 * could drift by one comparison operator.
 */
export function swipeClosestPointIndex(points: readonly number[], position: number): number {
    let best = 0;
    for (let i = 1; i < points.length; i++) {
        if (Math.abs(points[i] - position) < Math.abs(points[best] - position)) best = i;
    }
    return best;
}

/** Index of the first snap point at or after `position`, or `-1`. `find_next_point`. */
export function swipeNextPointIndex(points: readonly number[], position: number): number {
    for (let i = 0; i < points.length; i++) {
        // `G_APPROX_VALUE (points[i], pos, DBL_EPSILON) || points[i] > pos`, not `>=`.
        // They differ when a point sits BELOW the position by less than one ULP, which is
        // reachable for magnitudes under 1 — exactly the regime `carouselSnapPoints`
        // produces mid-reveal, where a fractional accumulation meets a progress computed
        // by a different route.
        if (Math.abs(points[i] - position) < Number.EPSILON || points[i] > position) return i;
    }
    return -1;
}

/** Index of the last snap point at or before `position`, or `-1`. `find_previous_point`. */
export function swipePreviousPointIndex(points: readonly number[], position: number): number {
    for (let i = points.length - 1; i >= 0; i--) {
        if (Math.abs(points[i] - position) < Number.EPSILON || points[i] < position) return i;
    }
    return -1;
}

/** The range a gesture may reach. */
export interface AdwSwipeRange {
    lower: number;
    upper: number;
}

/**
 * How far a gesture starting at `position` may travel. `get_bounds` / `get_range`.
 *
 * With `allowLongSwipes` the whole strip is fair game. Without it the reach is ONE snap
 * point either side of where the gesture began — which is the entire meaning of
 * `AdwCarousel:allow-long-swipes`, and the reason the bound is computed from
 * `initialProgress` and not from the live one: a long drag would otherwise keep
 * extending its own limit.
 */
export function swipeBounds(points: readonly number[], position: number, allowLongSwipes: boolean): AdwSwipeRange {
    if (points.length === 0) return { lower: 0, upper: 0 };
    if (allowLongSwipes) return { lower: points[0], upper: points[points.length - 1] };

    const closest = swipeClosestPointIndex(points, position);
    let previous: number;
    let next: number;
    if (Math.abs(points[closest] - position) < ADW_SWIPE_EPSILON) {
        previous = closest;
        next = closest;
    } else {
        previous = swipePreviousPointIndex(points, position);
        next = swipeNextPointIndex(points, position);
    }
    return {
        lower: points[Math.max(previous - 1, 0)],
        upper: points[Math.min(next + 1, points.length - 1)],
    };
}

/** Everything {@link swipeEndProgress} needs, and nothing about the platform. */
export interface AdwSwipeEndInput {
    /** Snap points in ascending order, as `adw_swipeable_get_snap_points` returns them. */
    points: readonly number[];
    /** Progress when the gesture was claimed — the bound is measured from here. */
    initialProgress: number;
    /** Progress now, already clamped by {@link swipeBounds}. */
    progress: number;
    /** Raw platform units per millisecond. See the header on why this is not pages/ms. */
    velocity: number;
    allowLongSwipes: boolean;
    source: AdwSwipeSource;
    /** A cancelled gesture ignores everything above and returns {@link cancelProgress}. */
    cancelled?: boolean;
    /** `adw_swipeable_get_cancel_progress` — where a cancelled gesture goes. */
    cancelProgress?: number;
}

/**
 * Where the gesture lands. `get_end_progress`.
 *
 * Below the velocity threshold it is the nearest snap point, clamped — a slow drag
 * settles where it was let go. Above it, the velocity is projected (linearly, then along
 * a parabola past {@link ADW_SWIPE_VELOCITY_CURVE_THRESHOLD}) and the projection picks a
 * point through {@link swipeProjectedPointIndex}.
 */
export function swipeEndProgress(input: AdwSwipeEndInput): number {
    const { points, progress, velocity, source } = input;
    // Cancelled first, as `get_end_progress` does (:449-450). The C never sees an empty
    // array — `adw_carousel_get_snap_points` returns `MAX (n, 1)` points
    // (adw-carousel.c:1269) — so the order only shows on a shape it cannot produce.
    if (input.cancelled === true) return input.cancelProgress ?? progress;
    if (points.length === 0) return progress;

    const { lower, upper } = swipeBounds(points, input.initialProgress, input.allowLongSwipes);

    if (Math.abs(velocity) < swipeVelocityThreshold(source)) {
        return clamp(points[swipeClosestPointIndex(points, progress)], lower, upper);
    }

    const slope = swipeSlope(source);
    let projected: number;
    if (Math.abs(velocity) > ADW_SWIPE_VELOCITY_CURVE_THRESHOLD) {
        const c = slope / 2 / ADW_SWIPE_PARABOLA_MULTIPLIER;
        const x = Math.abs(velocity) - ADW_SWIPE_VELOCITY_CURVE_THRESHOLD + c;
        projected =
            ADW_SWIPE_PARABOLA_MULTIPLIER * x * x -
            ADW_SWIPE_PARABOLA_MULTIPLIER * c * c +
            slope * ADW_SWIPE_VELOCITY_CURVE_THRESHOLD;
    } else {
        projected = Math.abs(velocity) * slope;
    }

    const target = clamp(projected * Math.sign(velocity) + progress, lower, upper);
    return points[swipeProjectedPointIndex(points, target, input.initialProgress, velocity)];
}

/**
 * Which snap point a projection commits to. `find_point_for_projection`.
 *
 * The special case is what makes a flick always MOVE: if the point behind the projection
 * (ahead of it, going backwards) is the one the gesture started on, the projection did
 * not clear a page, and rounding to the nearest would put the user back where they were
 * after a deliberate gesture. So it takes the next one instead.
 */
export function swipeProjectedPointIndex(
    points: readonly number[],
    target: number,
    initialProgress: number,
    velocity: number,
): number {
    const initial = swipeClosestPointIndex(points, initialProgress);
    const previous = swipePreviousPointIndex(points, target);
    const next = swipeNextPointIndex(points, target);

    if ((velocity > 0 ? previous : next) === initial) {
        const stepped = velocity > 0 ? next : previous;
        // `-1` where the projection left the strip: there is no further point, so the
        // nearest is the only answer left. The C indexes `points[-1]` here and reads
        // out of bounds; clamping is the same result for every in-range projection,
        // which is all `swipeEndProgress` produces after its own clamp.
        if (stepped >= 0) return stepped;
    }
    return swipeClosestPointIndex(points, target);
}

/** One recorded move: how far, and when. */
interface SwipeHistoryRecord {
    delta: number;
    time: number;
}

/** What {@link SwipeTracker.end} decided. */
export interface AdwSwipeEnd {
    /** Raw units per millisecond, as the renderer may want it for an animation duration. */
    velocity: number;
    /** The progress to settle on. */
    to: number;
}

/**
 * The gesture state machine: progress, an event history, and the two answers a renderer
 * needs — what to draw during the drag, and where to land after it.
 *
 * It knows nothing about pointers, touches or scroll events. A renderer feeds it deltas
 * in the platform's own units and the pitch to divide them by; everything else is the C.
 */
export class SwipeTracker {
    private readonly _history: SwipeHistoryRecord[] = [];
    private _initialProgress = 0;
    private _progress = 0;
    private _cancelled = false;

    constructor(
        private readonly _options: {
            /** Snap points, read fresh on every call: pages can be inserted mid-gesture. */
            points: () => readonly number[];
            /** `AdwCarousel:allow-long-swipes`, likewise read fresh. */
            allowLongSwipes: () => boolean;
            /** `adw_swipeable_get_cancel_progress`; defaults to where the gesture began. */
            cancelProgress?: () => number;
        },
    ) {}

    /** The progress a renderer should be showing. */
    get progress(): number {
        return this._progress;
    }

    /** Where the gesture started, which is what bounds it. */
    get initialProgress(): number {
        return this._initialProgress;
    }

    /**
     * `gesture_prepare` — a gesture is now possible, at `progress`.
     *
     * Called on the FIRST move, not when the gesture is claimed, because that is where
     * the C sets `initial_progress` (:202-204) and `initial_progress` is what bounds the
     * whole gesture. Deliberately does NOT clear the history: {@link reset} does, at the
     * end, which is what lets pre-claim moves count toward the velocity.
     */
    prepare(progress: number): void {
        this._initialProgress = progress;
        this._progress = progress;
        this._cancelled = false;
    }

    /**
     * `append_to_history` — record one raw platform delta.
     *
     * Called on EVERY move including the ones before the claim, which is where the C
     * calls it: `append_to_history` sits ahead of the PENDING block in `drag_update_cb`
     * (:670), and nothing clears the array until the gesture ends. Recording only from
     * the claim cost a whole event: with the first record's delta discarded as the
     * clock-starter (see {@link _velocity}), a flick that crossed the threshold on its
     * first move and released on its second measured ZERO velocity and settled back
     * instead of paging.
     */
    record(delta: number, time: number): void {
        this._trimHistory(time);
        this._history.push({ delta, time });
    }

    /**
     * `gesture_update` — apply one move to the progress. Returns the progress to draw.
     *
     * Takes the RAW delta and the pitch to divide it by, and does NOT touch the history:
     * the C's `gesture_update` only ever writes progress, because the append already
     * happened. Call it only while the gesture is claimed.
     */
    advance(delta: number, pitch: number): number {
        // A pitch of 0 is a carousel with nothing measurable in it. `0/0` is NaN, and a
        // NaN progress poisons every later comparison silently — so it is refused where
        // the division is, rather than guarded at each caller.
        if (!(pitch > 0)) return this._progress;

        const points = this._options.points();
        const { lower, upper } = swipeBounds(points, this._initialProgress, this._options.allowLongSwipes());
        // Written back CLAMPED, unlike the overshoot path in the C, which keeps the
        // unclamped value to rubber-band from. AdwCarousel enables no overshoot, so the
        // two are the same thing here and one variable is one fewer way to drift.
        this._progress = clamp(this._progress + delta / pitch, lower, upper);
        return this._progress;
    }

    /** `reset` — end of gesture. Clears the history so the next one starts from nothing. */
    reset(): void {
        this._history.length = 0;
        this._initialProgress = 0;
        this._progress = 0;
        this._cancelled = false;
    }

    /** Mark the gesture cancelled: {@link end} will return the cancel progress. */
    cancel(): void {
        this._cancelled = true;
    }

    /**
     * Finish, and say where to go. `gesture_end`.
     *
     * `source` defaults to `'touch'` because that is what the C passes for a DRAG —
     * `is_touchpad` is FALSE on both the touch and the mouse gesture (`drag_end_cb`),
     * and only the scroll path passes TRUE. It is a parameter so the scroll path can
     * reuse this tracker without a second copy of the projection.
     */
    end(time: number, source: AdwSwipeSource = 'touch'): AdwSwipeEnd {
        this._trimHistory(time);
        const velocity = this._velocity();
        const to = swipeEndProgress({
            points: this._options.points(),
            initialProgress: this._initialProgress,
            progress: this._progress,
            velocity,
            allowLongSwipes: this._options.allowLongSwipes(),
            source,
            cancelled: this._cancelled,
            cancelProgress: this._options.cancelProgress?.() ?? this._initialProgress,
        });
        this.reset();
        return { velocity, to };
    }

    /** `trim_history` — anything older than the window cannot describe the current flick. */
    private _trimHistory(time: number): void {
        const threshold = time - ADW_SWIPE_HISTORY_THRESHOLD_MS;
        let keepFrom = 0;
        while (keepFrom < this._history.length && this._history[keepFrom].time < threshold) keepFrom++;
        if (keepFrom > 0) this._history.splice(0, keepFrom);
    }

    /**
     * `calculate_velocity`, minus the overshoot damping AdwCarousel never enables.
     *
     * The FIRST record's delta is deliberately dropped — the C starts its sum at `i == 1`
     * — because the first record only establishes the clock. Summing it would divide a
     * delta by a time window that does not contain it.
     */
    private _velocity(): number {
        if (this._history.length < 2) return 0;
        const first = this._history[0].time;
        const last = this._history[this._history.length - 1].time;
        if (first === last) return 0;

        let total = 0;
        for (let i = 1; i < this._history.length; i++) total += this._history[i].delta;
        const velocity = total / (last - first);

        const points = this._options.points();
        const { lower, upper } = swipeBounds(points, this._initialProgress, this._options.allowLongSwipes());
        // At a bound, a velocity pushing further out is nothing: without overshoot there
        // is nowhere for it to go, and letting it project would pick a point the clamp
        // has already excluded.
        if (this._progress <= lower && velocity < 0) return 0;
        if (this._progress >= upper && velocity > 0) return 0;
        return velocity;
    }
}
