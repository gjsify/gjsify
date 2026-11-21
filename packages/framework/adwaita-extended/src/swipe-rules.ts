import type { SizeClass } from './size-class.js';

export type SwipeOutcome = 'primary' | 'secondary' | 'none';

/** A swipe commits at this fraction of the row width … */
export const SWIPE_COMMIT_FRACTION = 0.35;
/** … but never under this many px, so a narrow row does not fire on a twitch. */
export const SWIPE_COMMIT_MIN_PX = 72;
/** Horizontal travel before a drag counts as a swipe rather than a tap or a vertical scroll. */
export const SWIPE_START_PX = 12;
/** Minimum touch target (px at scale 1) — Material and HIG agree on 48. */
export const TOUCH_TARGET = 48;
/** Row heights when a pointer is in use. */
export const POINTER_ROW_HEIGHT_COMPACT = 40;
export const POINTER_ROW_HEIGHT = 36;

/** Pure: the distance a swipe must travel to commit. */
export function commitDistance(width: number): number {
    return Math.max(SWIPE_COMMIT_MIN_PX, width * SWIPE_COMMIT_FRACTION);
}

/** Pure: right (positive dx) is the primary action, left the secondary; short of the threshold nothing. */
export function swipeOutcome(dx: number, width: number): SwipeOutcome {
    if (!Number.isFinite(dx) || !Number.isFinite(width) || width <= 0) return 'none';
    const need = commitDistance(width);
    if (dx >= need) return 'primary';
    if (dx <= -need) return 'secondary';
    return 'none';
}

/** Pure: touch always gets the full target; a pointer gets less, least on a roomy window. */
export function rowMinHeight(sizeClass: SizeClass, pointer: boolean): number {
    if (!pointer) return TOUCH_TARGET;
    return sizeClass === 'compact' ? POINTER_ROW_HEIGHT_COMPACT : POINTER_ROW_HEIGHT;
}
