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
