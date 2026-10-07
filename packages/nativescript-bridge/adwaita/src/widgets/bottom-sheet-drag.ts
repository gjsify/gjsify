// The arithmetic of dragging an `AdwBottomSheet` — pure, so a Linux runner can pin it.
//
// `Adw.BottomSheet` opens to its sheet's natural height and follows a finger up and down: a drag
// on the bottom bar, on the handle or on the sheet moves it, and on release it settles open or
// closed by where it was let go and how fast it was going (an `AdwSwipeTracker`, which `Adw` also
// feeds with the drag handle, `allow_mouse_drag = show_drag_handle || bottom_bar`). The widget
// cannot be imported off-device (`extends GridLayout`), so the decisions live here and the widget
// only turns them into `translateY` and `height`.
//
// Reference: refs/libadwaita/src/adw-bottom-sheet.c (swipe tracker, `update_swipe_tracker`)

/** Which end of the travel a drag started from. */
export type SheetRest = 'open' | 'closed';

/** The open sheet's share of its container: what a GNOME window shows, the editor staying visible. */
export const SHEET_HEIGHT_FRACTION = 0.45;
/** The open sheet is never shorter than this (dip) unless the container itself is. */
export const SHEET_MIN_HEIGHT = 240;
/** What the open sheet always leaves visible above itself (dip): the dimmed content to tap out on. */
export const SHEET_TOP_GAP = 48;
/** A release at least this fast (dip per second) decides the direction by itself. */
export const FLING_VELOCITY = 600;
/** Without a fling, the sheet settles open once it has come this far (of its travel). */
export const SETTLE_PROGRESS = 0.5;

/** The height an open sheet takes in a container of `containerHeight` (dip). */
export function sheetHeight(containerHeight: number): number {
    if (!(containerHeight > 0)) return 0;
    const wanted = Math.max(containerHeight * SHEET_HEIGHT_FRACTION, SHEET_MIN_HEIGHT);
    return Math.round(Math.min(wanted, Math.max(containerHeight - SHEET_TOP_GAP, 0)));
}

/** How far the sheet moves between closed and open: from its bar's top edge to its own. */
export function sheetTravel(height: number, barHeight: number): number {
    return Math.max(height - barHeight, 0);
}

/**
 * The panel's `translateY` for a finger that has moved `dy` (positive is down) since the drag
 * began. `0` is fully open, `travel` fully closed; a drag never leaves that range, as the swipe
 * tracker clamps to its two snap points.
 */
export function dragOffset(start: SheetRest, dy: number, travel: number): number {
    const from = start === 'open' ? 0 : travel;
    return Math.min(Math.max(from + dy, 0), travel);
}

/** How far open the sheet is, `0` (closed) to `1` (open) — also the strength of the dimming. */
export function dragProgress(offset: number, travel: number): number {
    return travel > 0 ? 1 - Math.min(Math.max(offset, 0), travel) / travel : 0;
}

/** One sample of the finger: its distance from where the drag began, at a time (ms). */
export interface DragSample {
    readonly dy: number;
    readonly time: number;
}

/** The window of samples a release velocity is read from, in ms: older ones are the approach. */
const VELOCITY_WINDOW = 120;

/**
 * The finger's vertical velocity at release, in dip per second, positive downward. NativeScript's
 * pan reports distance only, so the speed is taken from the last moments of the drag.
 */
export function releaseVelocity(samples: readonly DragSample[]): number {
    const last = samples[samples.length - 1];
    if (!last) return 0;
    let first = last;
    for (let i = samples.length - 2; i >= 0 && last.time - samples[i].time <= VELOCITY_WINDOW; i--) first = samples[i];
    const span = last.time - first.time;
    return span > 0 ? ((last.dy - first.dy) / span) * 1000 : 0;
}

/**
 * Where a released drag comes to rest. A fling decides by its direction; a slow release by which
 * snap point is nearer, so a sheet dragged half way and let go goes the way it was closer to.
 */
export function settle(offset: number, travel: number, velocity: number): SheetRest {
    if (velocity <= -FLING_VELOCITY) return 'open';
    if (velocity >= FLING_VELOCITY) return 'closed';
    return dragProgress(offset, travel) >= SETTLE_PROGRESS ? 'open' : 'closed';
}

/** How far the finger must travel down from the top of the content before it is a close drag (dip). */
export const OVERSCROLL_SLOP = 8;

/** What a touch inside the sheet's scrolling content turned into. */
export type NestedDragStep =
    | { readonly kind: 'none' }
    | { readonly kind: 'begin' }
    | { readonly kind: 'move'; readonly dy: number }
    | { readonly kind: 'end'; readonly dy: number };

/**
 * The nested-scroll rule of a Material bottom sheet: content scrolls on its own until it sits at
 * its start, and a finger that keeps going down from there pulls the sheet instead. The
 * scrolling content owns the touch, so no pan reaches the sheet; this reads the touch stream
 * alongside it. `y` must be in a frame that does not move with the sheet (the view's own
 * `getY()` plus the sheet's `translateY`), or the drag would chase itself.
 */
export class NestedDragTracker {
    private _anchor = 0;
    private _dragging = false;
    private _last = 0;
    private _scrolled = false;

    /** Whether the sheet is being pulled by this tracker. */
    get dragging(): boolean {
        return this._dragging;
    }

    down(y: number): void {
        this._anchor = y;
        this._last = y;
        this._dragging = false;
        this._scrolled = false;
    }

    /** `offset` is the content's scroll offset (dip): above zero it is not at its start. */
    move(y: number, offset: number): NestedDragStep {
        this._last = y;
        if (this._dragging) return { kind: 'move', dy: Math.max(y - this._anchor, 0) };
        // Not at the start, or scrolling up: the content has the touch, and the pull restarts
        // from wherever the finger is when it gets back to the start.
        // The move that brings the content back to its start was spent scrolling it, so the
        // pull measures from where the finger is then, not from where the content was left.
        const wasScrolled = this._scrolled;
        this._scrolled = offset > 0;
        if (offset > 0 || wasScrolled || y < this._anchor) {
            this._anchor = y;
            return { kind: 'none' };
        }
        if (y - this._anchor < OVERSCROLL_SLOP) return { kind: 'none' };
        this._dragging = true;
        this._anchor = y;
        return { kind: 'begin' };
    }

    /** `cancelled` ends a drag where it began: the touch was taken away, not let go. */
    up(cancelled = false): NestedDragStep {
        if (!this._dragging) return { kind: 'none' };
        this._dragging = false;
        return { kind: 'end', dy: cancelled ? 0 : Math.max(this._last - this._anchor, 0) };
    }
}
