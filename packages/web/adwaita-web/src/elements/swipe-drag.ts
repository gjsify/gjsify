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
    /** Show this progress. Called on every move that the gesture owns. */
    onUpdate: (progress: number) => void;
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
export function attachSwipeDrag(init: AdwSwipeDragInit): void {
    const tracker = new SwipeTracker({
        points: init.points,
        allowLongSwipes: init.allowLongSwipes,
        // A cancelled drag goes back where it started, which is this tracker's own
        // default — `AdwCarousel` has no `get_cancel_progress` of its own either.
    });

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let previousOffset = 0;
    let claimed = false;
    let frozen: FrozenStyles | null = null;
    /**
     * Set when a claimed drag ends, cleared by the click it eats — or by the next press,
     * because a drag that ended OUTSIDE the host produces no click at all and a one-shot
     * listener would then sit armed and swallow the next real one.
     */
    let suppressNextClick = false;

    const axisOffset = (dx: number, dy: number) => (init.orientation === 'vertical' ? dy : dx);

    /** Dragging LEFT must advance, so the offset is negated — `drag_update_cb`'s `offset = -offset`. */
    const progressOffset = (dx: number, dy: number) => -axisOffset(dx, dy);

    const release = () => {
        // Listeners off and state cleared BEFORE the capture is released, because
        // `releasePointerCapture` fires `lostpointercapture` synchronously and that is
        // one of the endings this listens for — doing it in the other order re-enters
        // `finish` in the middle of itself.
        const captured = pointerId;
        pointerId = null;
        claimed = false;
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

    const claim = () => {
        claimed = true;
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
        tracker.begin(init.progress());
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
        // The ending of last resort. `lostpointercapture` fires whenever the capture
        // ends for ANY reason — the button released somewhere this never saw, the window
        // losing focus mid-drag, the host being removed from the document — and without
        // it a gesture that never gets its `pointerup` leaves the strip stopped mid-page
        // with snapping still switched off. That state was measured, and it is worse
        // than the feature being absent.
        window.addEventListener('lostpointercapture', onLostCapture, true);
    };

    init.host.addEventListener('pointerdown', (event: PointerEvent) => {
        // A gesture still open here means its end was never seen. Close it rather than
        // ignoring the new press, or one lost `pointerup` disables dragging for good.
        if (pointerId !== null) release();
        // Mouse only. Touch and touchpad are the browser's own gestures, and a pen
        // behaves like touch on every platform that has one.
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        if (!init.enabled()) return;
        if ((event.target as Element | null)?.closest(NATIVELY_DRAGGABLE) !== null) return;

        suppressNextClick = false;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        previousOffset = 0;
        claimed = false;
        // No capture yet — see `claim`. The moves that DECIDE the claim come from the
        // window listeners instead, which is why they are armed here and not there: a
        // 16 px threshold near an edge is otherwise unreachable.
        arm();
    });

    function onMove(event: PointerEvent): void {
        if (pointerId !== event.pointerId) return;

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        const offset = progressOffset(dx, dy);

        if (!claimed) {
            // The axis test is the C's: whichever axis moved MORE decides whose gesture
            // this is, so a vertical drag through a horizontal carousel scrolls the page
            // instead of paging it (`is_offset_vertical`, adw-swipe-tracker.c:661).
            const wantsVertical = Math.abs(dy) > Math.abs(dx);
            if (wantsVertical !== (init.orientation === 'vertical')) {
                if (Math.hypot(dx, dy) >= ADW_SWIPE_DRAG_THRESHOLD) release();
                return;
            }
            if (Math.hypot(dx, dy) < ADW_SWIPE_DRAG_THRESHOLD) return;
            claim();
            // From the claim, not from the press: the threshold travel is what BOUGHT
            // the gesture and must not also be applied as progress, or the content
            // jumps 16 px the instant it starts following the cursor.
            previousOffset = offset;
            return;
        }

        const delta = offset - previousOffset;
        previousOffset = offset;
        // Claimed, so the browser's own drag behaviours (text selection, image drag)
        // are ours to refuse.
        event.preventDefault();
        init.onUpdate(tracker.update(delta, init.pitch(), event.timeStamp));
    }

    function finish(event: PointerEvent, cancelled: boolean): void {
        if (pointerId !== event.pointerId) return;
        if (!claimed) {
            release();
            return;
        }
        if (cancelled) tracker.cancel();
        const { to, velocity } = tracker.end(event.timeStamp);
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
}
