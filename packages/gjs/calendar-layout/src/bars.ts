import { compareIds, dayNumber, type LocalDate } from './dates.js';
import { itemDayRange, type CalendarItem } from './item.js';
import type { MonthGrid } from './month.js';

export interface BarSegment<T = unknown> {
    item: CalendarItem<T>;
    id: string;
    /** Row slot, 0 = topmost. */
    row: number;
    /** Column of the first day, 0-6 within the week. */
    column: number;
    /** Number of days covered within this week, 1-7. */
    span: number;
    /** The item started in an earlier week. */
    continuesLeft: boolean;
    /** The item goes on in a later week. */
    continuesRight: boolean;
}

export interface WeekBars<T = unknown> {
    weekStart: LocalDate;
    /** Visible segments only (row < maxRows), ordered by row then column. */
    segments: BarSegment<T>[];
    /** Rows the visible segments occupy. */
    rows: number;
    /** Per column: how many items touch the day but sit below `maxRows` ("+3 more"). */
    overflow: number[];
}

export interface BarOptions {
    /** Rows available for bars. Unset = unlimited. */
    maxRows?: number;
}

/**
 * Lays the items that touch one 7-day row into row slots. Order is stable: longer items first
 * (by their whole length, so an item keeps its rank across weeks), then earlier start, then id.
 * Each item takes the lowest row that is free on all its days.
 */
export function layoutWeekBars<T>(
    items: readonly CalendarItem<T>[],
    weekStart: LocalDate,
    options: BarOptions = {},
): WeekBars<T> {
    const ws = dayNumber(weekStart);
    const we = ws + 6;
    const maxRows = options.maxRows;
    const ranked = items
        .map((item) => ({ item, ...itemDayRange(item) }))
        .filter((r) => r.last >= ws && r.first <= we)
        .sort((a, b) => b.last - b.first - (a.last - a.first) || a.first - b.first || compareIds(a.item.id, b.item.id));

    const occupied: boolean[][] = [];
    const segments: BarSegment<T>[] = [];
    const overflow = Array.from({ length: 7 }, () => 0);
    let rows = 0;
    for (const r of ranked) {
        const lo = Math.max(r.first, ws) - ws;
        const hi = Math.min(r.last, we) - ws;
        let row = 0;
        for (; ; row++) {
            const slots = (occupied[row] ??= Array.from({ length: 7 }, () => false));
            let free = true;
            for (let d = lo; d <= hi; d++) if (slots[d]) free = false;
            if (free) {
                for (let d = lo; d <= hi; d++) slots[d] = true;
                break;
            }
        }
        if (maxRows !== undefined && row >= maxRows) {
            for (let d = lo; d <= hi; d++) overflow[d]++;
            continue;
        }
        rows = Math.max(rows, row + 1);
        segments.push({
            item: r.item,
            id: r.item.id,
            row,
            column: lo,
            span: hi - lo + 1,
            continuesLeft: r.first < ws,
            continuesRight: r.last > we,
        });
    }
    segments.sort((a, b) => a.row - b.row || a.column - b.column);
    return { weekStart, segments, rows, overflow };
}

/** One `WeekBars` per row of the month grid. */
export function layoutMonthBars<T>(
    grid: MonthGrid,
    items: readonly CalendarItem<T>[],
    options: BarOptions = {},
): WeekBars<T>[] {
    return grid.weeks.map((w) => layoutWeekBars(items, w.days[0]!.date, options));
}
