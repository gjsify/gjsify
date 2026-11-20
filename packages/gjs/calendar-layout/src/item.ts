import { MINUTES_PER_DAY, dayNumber, type LocalDateTime } from './dates.js';

/**
 * One already-expanded occurrence. All values are wall-clock values the caller resolved; nothing
 * here converts a time zone.
 *
 * - All-day: `start` and `end` are dates, `end` is EXCLUSIVE (iCalendar DTEND). An `end` on or
 *   before `start` counts as one day.
 * - Timed: `end` is the exclusive end instant. An `end` before `start` counts as zero-length.
 */
export interface CalendarItem<T = unknown> {
    id: string;
    start: LocalDateTime;
    end: LocalDateTime;
    allDay: boolean;
    payload: T;
}

/** Minutes since 1970-01-01 00:00 wall-clock. */
export function toWallMinutes(value: LocalDateTime): number {
    return dayNumber(value) * MINUTES_PER_DAY + (value.hour ?? 0) * 60 + (value.minute ?? 0);
}

/** First and last day number the item touches (inclusive). */
export function itemDayRange(item: CalendarItem): { first: number; last: number } {
    const first = dayNumber(item.start);
    if (item.allDay) return { first, last: Math.max(first, dayNumber(item.end) - 1) };
    const s = toWallMinutes(item.start);
    const e = toWallMinutes(item.end);
    if (e <= s) return { first, last: first };
    return { first, last: Math.max(first, Math.floor((e - 1) / MINUTES_PER_DAY)) };
}

/** True for items that belong in the bar rows: all-day, or timed items that touch more than one day. */
export function isBarItem(item: CalendarItem): boolean {
    if (item.allDay) return true;
    const { first, last } = itemDayRange(item);
    return last > first;
}
