// Dragging a swipeable widget with the pointer — the DOM half of `AdwSwipeTracker`.
//
// THE INCIDENT
//
// Measured in Firefox on a bare `<adw-carousel>` with three 440 px pages: a 300 px mouse
// drag across it moved `position` 0 → 0 and `scrollLeft` 0 → 0. Nothing. A touchpad
// two-finger swipe moved 0 → 2 and writing `scrollLeft = 440` moved `position` to 1, so
// the strip was scrollable and the position feedback worked — the gesture was simply not
// implemented. Upstream it is not optional: `AdwCarousel` turns it on in `init`
// (`adw_swipe_tracker_set_allow_mouse_drag (self->tracker, TRUE)`, adw-carousel.c:1209)
// and exposes it as a public property whose default is TRUE (`allow-mouse-drag`, :1091),
// documented "If the value is FALSE, dragging is only available on touch."
//
// WHAT THIS DOES *NOT* TOUCH, and why that is the compatible answer
//
// Touch and touchpad swiping already work, because the widget is a real scroll container
// with `scroll-snap-type` and the browser owns those gestures — momentum, rubber-band and
// snapping included. GTK is likewise the platform there. Taking them over to run the
// tracker on every touchmove would replace a native gesture with an imitation of one, so
// this module handles the ONE input the browser gives no gesture for: a held mouse button.
//
// The consequence to know about is a real divergence and it is ledgered, not hidden: GTK
// runs its touchpad scroll through the same tracker, so `allow-long-swipes: false` bounds
// a touchpad flick to the adjacent page there and does not here — measured, a two-finger
// flick crossed two pages.
//
// WHY POINTER EVENTS AND NOT touch/mouse PAIRS
//
// `pointerType` is a fact about the event; `'ontouchstart' in window` is a fact about the
// device. A laptop with a touchscreen is both, so a listener set chosen from the device —
// the shape `@ribajs/extras`' touch-events service uses, ported from jQuery Mobile — picks
// one path for a machine that needs both. One set of pointer listeners and a check on
// `pointerType` cannot get that wrong.
//
// THE CLAIM IS A STATE MACHINE, NOT A BOOLEAN, and compressing it into one cost three
// behaviours. `drag_update_cb` (adw-swipe-tracker.c:640-750) runs in this order, and the
// order is the point:
//
//   1. `append_to_history` — UNCONDITIONAL (:670), ahead of everything below. A move made
//      before the gesture is claimed still counts toward the velocity.
//   2. at STATE_NONE, the axis is checked and the gesture is DENIED on the wrong one
//      (:673) — on the FIRST move, at any distance, not only once 16 px are travelled.
//   3. at STATE_PENDING, past the threshold, four more refusals before claiming: outside
//      the swipe area, the wrong axis again (:715), a strip whose first and last snap
//      point are the same (:720), and overshooting either end with overshoot disabled
//      (:725-739) — which `AdwCarousel` always has.
//   4. only at STATE_SCROLLING does `gesture_update` apply the delta (:749).
//
// Skipping 3 is what made a backwards drag on page 0 swallow the click of the button
// under the cursor: the gesture claimed, clamped to the bound so nothing moved, and then
// suppressed the click anyway. Skipping 1 cost a whole event — with the first record
// discarded as the clock-starter, a two-move flick measured zero velocity and settled
// back instead of paging.
//
// HOW A DRAG BEATS A CLICK
//
// GTK does not blocklist widgets under the pointer: `should_suppress_drag`
// (adw-swipe-tracker.c:551) only refuses window handles, and a button inside a carousel
// loses its click because the drag gesture CLAIMS the event sequence once it passes
// `DRAG_THRESHOLD_DISTANCE`. This mirrors that: every `pointerdown` is tracked, nothing is
// pre-excluded, and the claim at 16 px is what suppresses the `click` that would otherwise
// follow. {@link NATIVELY_DRAGGABLE} is the one place a blocklist is unavoidable — a
// `<select>` or a range slider runs its own drag inside the browser, where there is no
// sequence to lose the race for.

import { ADW_SWIPE_DRAG_THRESHOLD, SwipeTracker } from '@gjsify/adwaita-core';

/**
 * Controls that drag themselves, inside the browser, with no sequence for a claim to win.
 *
 * GTK needs no such list (see the header); this is the DOM's missing half of gesture
 * claiming and nothing more. A `<button>` is deliberately ABSENT: losing its click to a
 * deliberate drag is the upstream behaviour.
 */
const NATIVELY_DRAGGABLE = 'select, textarea, input[type="range"], [contenteditable=""], [contenteditable="true"]';

/** Which way the widget pages, and therefore which axis claims a drag. */
export type AdwSwipeOrientation = 'horizontal' | 'vertical';

export interface AdwSwipeDragInit {
    /** The element the listeners sit on. Items rebuilt under it stay covered. */
    host: HTMLElement;
    orientation: AdwSwipeOrientation;
    /** Re-read on every press: may a mouse drag start right now? */
    enabled: () => boolean;
    /** Page pitch in px. The raw pixel delta is divided by it to reach progress. */
    pitch: () => number;
    /** Snap points, ascending, as `adw_swipeable_get_snap_points` returns them. */
    points: () => readonly number[];
    /** Progress now — the gesture is seeded from it and bounded by it. */
    progress: () => number;
    /** `AdwCarousel:allow-long-swipes`. */
    allowLongSwipes: () => boolean;
    /**
     * `adw_swipeable_get_cancel_progress` — where a CANCELLED gesture goes.
     *
     * Not optional by accident: the tracker's own fallback is where the gesture began,
     * and `AdwCarousel`'s answer is `get_closest_snap_point` — the point nearest where
     * the finger is NOW (adw-carousel.c:1294-1299). The two differ for exactly the
     * gesture that matters, one cancelled past the halfway mark: upstream commits to the
     * page under the cursor, the fallback yanks it back.
     */
    cancelProgress: () => number;
    /** Show this progress. Called on every move that the gesture owns. */
    onUpdate: (progress: number) => void;
    /**
     * Whether a gesture may be claimed at all right now, on top of the refusals this
     * module makes itself. `AdwCarousel` needs none — its `interactive` and
     * `allow-mouse-drag` are {@link enabled} — but `is_in_swipe_area` lives here for the
     * widgets that implement `get_swipe_area`, which the carousel does not.
     */
    claimable?: (start: { x: number; y: number }) => boolean;
    /** Settle on this progress. `velocity` is raw px/ms, for an animation duration. */
    onEnd: (progress: number, velocity: number) => void;
}

/** What a claimed gesture had to override on the host, so releasing it can put it back. */
interface FrozenStyles {
    scrollSnapType: string;
    scrollBehavior: string;
    userSelect: string;
}

/**
 * Make `host` draggable with a mouse, deciding where it lands the way `AdwSwipeTracker`
 * does.
 *
 * The listener is the element's own and is bound once, without teardown: it survives a
 * re-parent and is collected with the element.
 */
/** What a caller gets back, so it can tell whether a gesture owns the widget. */
export interface AdwSwipeDrag {
    /**
     * Whether a gesture is currently claimed.
     *
     * A widget needs this to keep its OTHER inputs out of the offset while a drag owns
     * it. Measured on `<adw-carousel>`: one wheel notch during a claimed drag ran the
     * whole wheel path and jumped `scrollLeft` 80 → 440 in a frame, which the next move
     * then yanked back. Upstream's `scroll_cb` is ungated too, but there the external
     * request is a spring the next frame quietly overrides — here `claim()` sets
     * `scroll-behavior: auto`, which turns it into an instant jump.
     */
    readonly dragging: boolean;
}

export function attachSwipeDrag(init: AdwSwipeDragInit): AdwSwipeDrag {
    const tracker = new SwipeTracker({
        points: init.points,
        allowLongSwipes: init.allowLongSwipes,
        cancelProgress: init.cancelProgress,
    });

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let previousOffset = 0;
    /** Where the pointer is now, for the second half of the swipe-area test. */
    let lastX = 0;
    let lastY = 0;
    /** `ADW_SWIPE_TRACKER_STATE_*`: nothing pressed, a press that may become one, ours. */
    let state: 'none' | 'pending' | 'scrolling' = 'none';
    let frozen: FrozenStyles | null = null;
    /**
     * Set when a claimed drag ends, cleared by the click it eats — or by the next press,
     * because a drag that ended OUTSIDE the host produces no click at all and a one-shot
     * listener would then sit armed and swallow the next real one.
     */
    let suppressNextClick = false;

    const axisOffset = (dx: number, dy: number) => (init.orientation === 'vertical' ? dy : dx);

    /**
     * Dragging LEFT must advance, so the offset is negated — `drag_update_cb`'s
     * `offset = -offset`.
     *
     * LTR ONLY, deliberately. Upstream flips this sign for RTL through
     * `adw_swipe_tracker_set_reversed` (`adw-carousel.c:455-465`), and taking a `reversed`
     * flag here would be an afternoon's work — but the web carousel does not work in RTL
     * at ALL yet: its offset model is `scrollLeft = position * distance`, and an RTL
     * scroll container counts `scrollLeft` DOWN from 0, so even `scrollToPage(1)` moves
     * nothing (measured). A reversed branch would compute a correct progress and write it
     * to a container that ignores it. `status/open-todos.md` carries the whole gap; the
     * flag belongs in the change that can test it.
     */
    const progressOffset = (dx: number, dy: number) => -axisOffset(dx, dy);

    const release = () => {
        // Listeners off and state cleared BEFORE the capture is released, because
        // `releasePointerCapture` fires `lostpointercapture` synchronously and that is
        // one of the endings this listens for — doing it in the other order re-enters
        // `finish` in the middle of itself.
        const captured = pointerId;
        pointerId = null;
        state = 'none';
        tracker.reset();
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onFinish, true);
        window.removeEventListener('pointercancel', onCancel, true);
        window.removeEventListener('lostpointercapture', onLostCapture, true);

        if (captured !== null && init.host.hasPointerCapture(captured)) {
            init.host.releasePointerCapture(captured);
        }
        if (frozen !== null) {
            init.host.style.scrollSnapType = frozen.scrollSnapType;
            init.host.style.scrollBehavior = frozen.scrollBehavior;
            init.host.style.userSelect = frozen.userSelect;
            frozen = null;
        }
    };

    /**
     * `:720-739` — the refusals that happen at the threshold, after the axis and before
     * the claim. Returns whether the gesture may be claimed at all.
     */
    const claimAllowed = (offset: number): boolean => {
        const points = init.points();
        if (points.length === 0) return false;
        const first = points[0];
        const last = points[points.length - 1];
        // A strip with one snap point has nowhere to go (:720). The C cannot reach an
        // EMPTY one — `adw_carousel_get_snap_points` returns `MAX (n, 1)` points
        // (adw-carousel.c:1269) — so the length test above stands in for it.
        if (Math.abs(first - last) < Number.EPSILON) return false;

        const progress = init.progress();
        // Overshooting an end with overshoot disabled, which AdwCarousel always is
        // (:725-739). Without this a backwards drag on the first page claims, moves
        // nothing, and still eats the click of whatever it started on.
        const overshootingLower = offset < 0 && (Math.abs(progress - first) < Number.EPSILON || progress < first);
        const overshootingUpper = offset > 0 && (Math.abs(progress - last) < Number.EPSILON || progress > last);
        if (overshootingLower || overshootingUpper) return false;

        // BOTH ends, as `is_in_swipe_area (start) || is_in_swipe_area (start + offset)`
        // does (:709-712): a gesture that began outside the grabbable strip and has
        // arrived inside it is still allowed.
        if (init.claimable === undefined) return true;
        return init.claimable({ x: startX, y: startY }) || init.claimable({ x: lastX, y: lastY });
    };

    const claim = () => {
        state = 'scrolling';
        // Captured HERE and not on the press. With capture set at `pointerdown`, the
        // `click` that follows is dispatched at the CAPTURING element — so it never
        // reaches the button the user actually pressed, and measured, every button inside
        // a carousel stopped working. From the claim on it is harmless, because a claimed
        // gesture suppresses that click on purpose.
        if (pointerId !== null) init.host.setPointerCapture(pointerId);
        // Snap and smooth scrolling both fight a drag: with them on, every write to
        // `scrollLeft` is a request the browser re-animates and re-snaps, so the strip
        // lags the cursor and lands somewhere the tracker did not choose. They go back
        // on before the settle, which is what makes the release animate.
        frozen = {
            scrollSnapType: init.host.style.scrollSnapType,
            scrollBehavior: init.host.style.scrollBehavior,
            userSelect: init.host.style.userSelect,
        };
        init.host.style.scrollSnapType = 'none';
        init.host.style.scrollBehavior = 'auto';
        init.host.style.userSelect = 'none';
    };

    /**
     * MOVE AND UP ARE LISTENED FOR ON THE WINDOW, and this is not belt-and-braces.
     *
     * Measured: with the listeners on the host and `setPointerCapture` alone, a drag that
     * travelled past the left edge of the viewport never delivered `pointerup` to the
     * track at all — `scroll-snap-type` stayed `none` and the strip sat at `scrollLeft`
     * 387 of a 440 px page, forever, with the gesture still believing it was in flight.
     * That is worse than the missing feature was. Capture is kept as well, because it is
     * what keeps the moves targeted while the pointer is still inside.
     */
    const arm = () => {
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onFinish, true);
        window.addEventListener('pointercancel', onCancel, true);
        // The ending of last resort, for a CLAIMED gesture whose `pointerup` this never
        // sees — the window losing focus mid-drag, an OS-level cancel. Without it such a
        // gesture leaves the strip stopped mid-page with snapping switched off, which was
        // measured and is worse than the feature being absent.
        //
        // It does NOT cover the host being removed from the document, which an earlier
        // draft of this comment claimed: the implicit release dispatches
        // `lostpointercapture` at the now-detached element, and an event dispatched in a
        // detached tree never reaches `window`. Measured — the styles stayed frozen until
        // a later `pointerup` cleaned up. The button check in `onMove` is the net that
        // actually spans both, since a removed host stops delivering moves anyway.
        window.addEventListener('lostpointercapture', onLostCapture, true);
    };

    init.host.addEventListener('pointerdown', (event: PointerEvent) => {
        // FIRST, before any guard below can return. A cancelled gesture produces no click
        // to consume the flag, so leaving it set until the next SUCCESSFUL press meant the
        // next click was eaten instead — measured: cancel a drag, then click a `<textarea>`
        // inside the carousel (which `NATIVELY_DRAGGABLE` refuses to drag) and the click
        // never arrived.
        suppressNextClick = false;

        // A gesture still open under the SAME pointer means its end was never seen: close
        // it, or one lost `pointerup` disables dragging for good. A DIFFERENT pointer is
        // the opposite case and upstream is explicit about it — `drag_begin_cb` denies the
        // NEW sequence and keeps the one in flight (adw-swipe-tracker.c:617-620). Tearing
        // the live gesture down instead left the strip rubber-banding back with no
        // `onEnd` and no tracker decision at all.
        if (pointerId !== null) {
            if (event.pointerId !== pointerId) return;
            release();
        }
        // Mouse only. Touch and touchpad are the browser's own gestures, and a pen
        // behaves like touch on every platform that has one.
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        if (!init.enabled()) return;
        if ((event.target as Element | null)?.closest(NATIVELY_DRAGGABLE) !== null) return;

        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        lastX = event.clientX;
        lastY = event.clientY;
        previousOffset = 0;
        state = 'pending';
        // No capture yet — see `claim`. The moves that DECIDE the claim come from the
        // window listeners instead, which is why they are armed here and not there: a
        // 16 px threshold near an edge is otherwise unreachable.
        arm();
    });

    function onMove(event: PointerEvent): void {
        if (pointerId !== event.pointerId) return;

        lastX = event.clientX;
        lastY = event.clientY;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        const offset = progressOffset(dx, dy);
        const delta = offset - previousOffset;
        previousOffset = offset;
        // TRUNCATED to whole milliseconds, because the C's clock is a `guint32` and its
        // `first_time == last_time` guard is a real low-pass filter: two events inside
        // one millisecond yield NO velocity there. Left as a float, that guard is dead
        // and two coalesced moves 0.1 ms apart read as tens of pages per second.
        const time = Math.trunc(event.timeStamp);
        // UNCONDITIONAL, and ahead of every refusal below — `append_to_history` at :670.
        tracker.record(delta, time);

        // NO BUTTON HELD means the press this is tracking ended somewhere unseen. Before
        // the claim there is no pointer capture and therefore no `lostpointercapture`, so
        // this is the only net that window: measured, one lost `pointerup` left the strip
        // FOLLOWING a cursor with nothing pressed, snapping off, until the next click
        // anywhere. Checked for every state, since a claimed gesture can lose its up too.
        if ((event.buttons & 1) === 0) {
            release();
            return;
        }

        if (state === 'pending') {
            // Whichever axis moved MORE decides whose gesture this is
            // (`is_offset_vertical`, :661). Tested here and ONLY here: the C tests it at
            // STATE_NONE, on the first move at any distance (:673), and again inside the
            // threshold block (:715) — never at STATE_SCROLLING. One test in the pending
            // branch covers both, because `dx`/`dy` are cumulative from the press.
            //
            // Hoisting it above this branch, as a first draft did, re-tested it on every
            // claimed move — and `dx`/`dy` being cumulative means a drag that comes BACK
            // toward its start ("changed my mind, with a little vertical wander") flips
            // the dominant axis and cancelled itself mid-gesture.
            const wantsVertical = Math.abs(dy) > Math.abs(dx);
            if (wantsVertical !== (init.orientation === 'vertical')) {
                release();
                return;
            }
            if (Math.hypot(dx, dy) < ADW_SWIPE_DRAG_THRESHOLD) return;
            if (!claimAllowed(offset)) {
                release();
                return;
            }
            // `gesture_prepare` is the C's first-move step and sets `initial_progress`
            // (:202-204). It runs here rather than at `pointerdown` because until a move
            // arrives there is no direction, and until the axis passes there is no
            // gesture to prepare.
            tracker.prepare(init.progress());
            claim();
            // From the claim, not from the press: the threshold travel is what BOUGHT
            // the gesture and must not also be applied as progress (`prev_offset = offset`
            // at :744), or the content jumps 16 px the instant it follows the cursor.
            previousOffset = offset;
            return;
        }

        if (state !== 'scrolling') return;
        // The standard signal that this move is consumed. Deliberately NOT credited with
        // the two things it usually is: text selection is prevented by the `user-select`
        // in `claim`, and a native image or link drag begins from `dragstart` BEFORE the
        // claim, so this line has never run by then — measured, an image dragged inside a
        // page is never refused here. Kept because consuming the move is what it is for,
        // not because a specific default was observed to need it.
        event.preventDefault();
        init.onUpdate(tracker.advance(delta, init.pitch()));
    }

    function finish(event: PointerEvent, cancelled: boolean): void {
        if (pointerId !== event.pointerId) return;
        if (state !== 'scrolling') {
            release();
            return;
        }
        if (cancelled) tracker.cancel();
        const { to, velocity } = tracker.end(Math.trunc(event.timeStamp));
        release();
        // A deliberate drag must not also activate whatever it ended on — the DOM's
        // stand-in for GTK's claimed event sequence.
        suppressNextClick = true;
        init.onEnd(to, velocity);
    }

    function onFinish(event: PointerEvent): void {
        finish(event, false);
    }

    function onCancel(event: PointerEvent): void {
        finish(event, true);
    }

    function onLostCapture(event: PointerEvent): void {
        // Settled, not cancelled: the pointer is gone, so whatever the user did they are
        // done doing it, and dropping them back where they started would undo a drag
        // they can see on screen.
        finish(event, false);
    }

    // CAPTURE phase and permanent, rather than a one-shot armed at the end of a drag: a
    // listener that is only ever removed by the click it is waiting for outlives a drag
    // that produced none.
    init.host.addEventListener(
        'click',
        (event: Event) => {
            if (!suppressNextClick) return;
            suppressNextClick = false;
            event.stopPropagation();
            event.preventDefault();
        },
        { capture: true },
    );

    return {
        get dragging(): boolean {
            return state === 'scrolling';
        },
    };
}
