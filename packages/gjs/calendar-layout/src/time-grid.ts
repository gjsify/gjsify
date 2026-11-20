import { MINUTES_PER_DAY, compareIds, dateFromDayNumber, dayNumber, type LocalDate } from './dates.js';
import { toWallMinutes, type CalendarItem } from './item.js';

export interface TimeGridOptions {
    firstDay: LocalDate;
    /** Number of consecutive day columns (1, 3, 7 …). */
    days: number;
    /** First visible hour, 0-23. Default 0. */
    startHour?: number;
    /** End of the visible range, 1-24. Default 24. */
    endHour?: number;
    /** Layout height of a zero-length or shorter item, in minutes. Default 15. */
    minMinutes?: number;
}

export interface TimePlacement<T = unknown> {
    item: CalendarItem<T>;
    id: string;
    /** Minutes from midnight of this day, clipped to the visible range. */
    start: number;
    end: number;
    /** 0-based column inside the overlap cluster. */
    column: number;
    /** Columns in the cluster; width = 1 / columns. */
    columns: number;
    /** The item began on an earlier day. */
    continuesBefore: boolean;
    /** The item goes on after this day. */
    continuesAfter: boolean;
}

export interface TimeGridDay<T = unknown> {
    date: LocalDate;
    placements: TimePlacement<T>[];
}

/**
 * Places timed items into day columns. Items that cross midnight are split per day; all-day items
 * are ignored (route them to the bars). Within a day, items that overlap transitively form a
 * cluster and share its columns; each item takes the first column that is free when it starts.
 */
export function layoutTimeGrid<T>(items: readonly CalendarItem<T>[], options: TimeGridOptions): TimeGridDay<T>[] {
    const startHour = options.startHour ?? 0;
    const endHour = options.endHour ?? 24;
    if (!(startHour >= 0 && endHour <= 24 && startHour < endHour)) throw new RangeError('invalid visible hours');
    const visStart = startHour * 60;
    const visEnd = endHour * 60;
    const min = options.minMinutes ?? 15;
    const timed = items
        .filter((i) => !i.allDay)
        .map((item) => {
            const s = toWallMinutes(item.start);
            return { item, s, e: Math.max(s, toWallMinutes(item.end)) };
        });
    const first = dayNumber(options.firstDay);
    const result: TimeGridDay<T>[] = [];

    for (let d = 0; d < options.days; d++) {
        const dayStart = (first + d) * MINUTES_PER_DAY;
        const dayEnd = dayStart + MINUTES_PER_DAY;
        const segs: TimePlacement<T>[] = [];
        for (const { item, s, e } of timed) {
            const zero = s === e;
            if (zero ? s < dayStart || s >= dayEnd : s >= dayEnd || e <= dayStart) continue;
            let lo = Math.max(s, dayStart) - dayStart;
            let hi = Math.min(e, dayEnd) - dayStart;
            hi = Math.max(hi, lo + min);
            lo = Math.max(lo, visStart);
            hi = Math.min(hi, visEnd);
            if (hi <= lo) continue;
            segs.push({
                item,
                id: item.id,
                start: lo,
                end: hi,
                column: 0,
                columns: 1,
                continuesBefore: s < dayStart,
                continuesAfter: e > dayEnd,
            });
        }
        segs.sort((a, b) => a.start - b.start || b.end - a.end || compareIds(a.id, b.id));

        let cluster: TimePlacement<T>[] = [];
        let columnEnds: number[] = [];
        let clusterEnd = 0;
        const flush = () => {
            for (const p of cluster) p.columns = columnEnds.length;
            cluster = [];
            columnEnds = [];
        };
        for (const seg of segs) {
            if (cluster.length > 0 && seg.start >= clusterEnd) flush();
            let col = columnEnds.findIndex((end) => end <= seg.start);
            if (col < 0) col = columnEnds.push(0) - 1;
            seg.column = col;
            columnEnds[col] = seg.end;
            clusterEnd = cluster.length === 0 ? seg.end : Math.max(clusterEnd, seg.end);
            cluster.push(seg);
        }
        flush();
        result.push({ date: dateFromDayNumber(first + d), placements: segs });
    }
    return result;
}
