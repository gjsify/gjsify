/**
 * Items grouped into the days an agenda lists them under. Pure and Node-safe.
 *
 * An item that spans days appears under each day it touches, clipped to that day, so a reader
 * scrolling through the list sees it where it concerns them rather than only on the day it began.
 */

import {
    MINUTES_PER_DAY,
    compareIds,
    dateFromDayNumber,
    dayNumber,
    itemDayRange,
    toWallMinutes,
    type CalendarItem,
    type LocalDate,
} from '@gjsify/calendar-layout';

export interface AgendaEntry<T = unknown> {
    item: CalendarItem<T>;
    id: string;
    /** Minutes from midnight of this day, or `null` for an all-day item. */
    start: number | null;
    end: number | null;
    /** The item began before this day. */
    continuesBefore: boolean;
    /** The item goes on after this day. */
    continuesAfter: boolean;
}

export interface AgendaDay<T = unknown> {
    date: LocalDate;
    /** Days since 1970-01-01, the key the widget keeps its groups under. */
    day: number;
    /** All-day items first, then timed ones by start time; ties broken by id so the order is stable. */
    entries: AgendaEntry<T>[];
}

export interface AgendaOptions {
    /** Drop everything before this day. */
    first?: LocalDate;
    /** With `first`: how many days the list covers. */
    days?: number;
}

/**
 * Groups items by day. Days without an entry are left out — an agenda is a list of what happens,
 * and a run of empty days between two entries is a wall of headings.
 */
export function groupByDay<T>(items: readonly CalendarItem<T>[], options: AgendaOptions = {}): AgendaDay<T>[] {
    const lower = options.first === undefined ? -Infinity : dayNumber(options.first);
    const upper =
        options.first === undefined || options.days === undefined ? Infinity : lower + Math.max(0, options.days) - 1;

    const byDay = new Map<number, AgendaEntry<T>[]>();
    for (const item of items) {
        const range = itemDayRange(item);
        const from = Math.max(range.first, lower === -Infinity ? range.first : lower);
        const to = Math.min(range.last, upper === Infinity ? range.last : upper);
        for (let day = from; day <= to; day++) {
            const entries = byDay.get(day) ?? [];
            entries.push(entryFor(item, day));
            byDay.set(day, entries);
        }
    }

    return [...byDay.keys()]
        .sort((a, b) => a - b)
        .map((day) => ({
            date: dateFromDayNumber(day),
            day,
            entries: byDay.get(day)!.sort(compareEntries),
        }));
}

function entryFor<T>(item: CalendarItem<T>, day: number): AgendaEntry<T> {
    const range = itemDayRange(item);
    const base = { item, id: item.id, continuesBefore: range.first < day, continuesAfter: range.last > day };
    if (item.allDay) return { ...base, start: null, end: null };
    const dayStart = day * MINUTES_PER_DAY;
    const dayEnd = dayStart + MINUTES_PER_DAY;
    const from = toWallMinutes(item.start);
    const to = Math.max(from, toWallMinutes(item.end));
    return {
        ...base,
        start: Math.max(from, dayStart) - dayStart,
        end: Math.min(to, dayEnd) - dayStart,
        continuesBefore: from < dayStart,
        continuesAfter: to > dayEnd,
    };
}

function compareEntries(a: AgendaEntry, b: AgendaEntry): number {
    if (a.start === null || b.start === null) {
        if (a.start === b.start) return compareIds(a.id, b.id);
        return a.start === null ? -1 : 1;
    }
    return a.start - b.start || (a.end ?? 0) - (b.end ?? 0) || compareIds(a.id, b.id);
}
