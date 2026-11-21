import type { SizeClass } from './size-class.js';

/**
 * How a month cell shows what happens on its day: a titled bar per item, or one dot per item.
 *
 * A phone-wide cell is about 45 px across — a bar there holds two or three characters, which reads
 * as noise rather than as a title. Compact therefore shows dots and leaves the titles to the list
 * of the selected day beside the grid.
 */
export type MonthDensity = 'dots' | 'bars';

/** Dots a compact cell shows before it says "+n"; a fourth dot no longer fits beside the number. */
export const MAX_DOTS = 3;
/** Height of one bar row, px — the bar's `min-height` plus the grid's row spacing. */
export const BAR_HEIGHT = 20;
/** Room the day number takes at the top of a cell, px. */
export const DAY_NUMBER_HEIGHT = 26;
/** Room the "+n more" line takes under the bars, px. */
export const OVERFLOW_HEIGHT = 18;
/** More rows than this stop helping: the cell becomes a list nobody reads in a grid. */
export const MAX_BAR_ROWS = 5;

export function monthDensity(sizeClass: SizeClass): MonthDensity {
    return sizeClass === 'compact' ? 'dots' : 'bars';
}

/**
 * Bar rows a cell `cellHeight` px tall has room for — the `maxRows` the bar layout needs to count
 * its overflow. Without a measured height (before the first allocation) a sensible default per
 * size class; compact has no bars at all.
 */
export function barRows(sizeClass: SizeClass, cellHeight?: number): number {
    if (monthDensity(sizeClass) === 'dots') return 0;
    const fallback = sizeClass === 'medium' ? 2 : 3;
    if (cellHeight === undefined || !Number.isFinite(cellHeight)) return fallback;
    const room = cellHeight - DAY_NUMBER_HEIGHT - OVERFLOW_HEIGHT;
    return Math.max(1, Math.min(MAX_BAR_ROWS, Math.floor(room / BAR_HEIGHT)));
}

/** Dots to draw for a day, and how many items they leave unshown. */
export function dotsForDay(count: number, max: number = MAX_DOTS): { dots: number; more: number } {
    if (!Number.isFinite(count) || count <= 0) return { dots: 0, more: 0 };
    const total = Math.floor(count);
    return { dots: Math.min(total, max), more: Math.max(0, total - max) };
}

/** Where a key takes the focus in a month grid, counted in cells from the first one. */
export type GridMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

/**
 * Pure: the cell a key moves the focus to, or -1 when the move leaves the grid. Weeks are seven
 * cells, so up and down are ±7 and Home/End are the ends of the focused week.
 */
export function moveGridFocus(index: number, move: GridMove, count: number): number {
    if (!Number.isFinite(index) || index < 0 || index >= count) return -1;
    const row = Math.floor(index / 7) * 7;
    switch (move) {
        case 'left':
            return index > 0 ? index - 1 : -1;
        case 'right':
            return index + 1 < count ? index + 1 : -1;
        case 'up':
            return index - 7 >= 0 ? index - 7 : -1;
        case 'down':
            return index + 7 < count ? index + 7 : -1;
        case 'home':
            return row;
        case 'end':
            return Math.min(row + 6, count - 1);
    }
}
