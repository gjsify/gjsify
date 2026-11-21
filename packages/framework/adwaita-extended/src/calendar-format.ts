/**
 * Dates and times as the reader's locale writes them.
 *
 * Weekday and month names come from `Intl`, not from the package catalogue: CLDR already has them
 * in every locale, and a po file would be a worse second copy that only covers the languages this
 * package happens to ship. The catalogue holds the UI words ("All day", "+2 more") instead.
 *
 * Pure and Node-safe: no GTK, no clock of its own, every function takes the values it formats.
 */

import { MINUTES_PER_DAY, type LocalDate } from '@gjsify/calendar-layout';

/** `Intl.DateTimeFormat` costs more to build than to use, and a month grid formats 42 cells. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale ?? ''}|${JSON.stringify(options)}`;
    let found = formatters.get(key);
    if (found === undefined) {
        // Everything here is wall-clock already, so UTC keeps the machine's zone out of the result.
        found = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
        formatters.set(key, found);
    }
    return found;
}

/** `setUTCFullYear` rather than the `Date.UTC` year argument, which maps 0-99 into the 1900s. */
function at(date: LocalDate, hour = 12, minute = 0): Date {
    const value = new Date(Date.UTC(2000, 0, 1, hour, minute));
    value.setUTCFullYear(date.year, date.month - 1, date.day);
    return value;
}

/** 1970-01-04 was a Sunday, so day number 3 + weekday is a date with that weekday. */
function dayWithWeekday(weekday: number): LocalDate {
    return { year: 1970, month: 1, day: 4 + weekday };
}

/** `YYYY-MM-DD`, the form the widgets pass in their `day-activated` signals. */
export function isoDate(date: LocalDate): string {
    const month = String(date.month).padStart(2, '0');
    const day = String(date.day).padStart(2, '0');
    return `${date.year}-${month}-${day}`;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The inverse of {@link isoDate}; `null` for anything that is not a plain calendar date. */
export function parseIsoDate(value: string): LocalDate | null {
    const match = ISO.exec(value.trim());
    if (!match) return null;
    const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) return null;
    return date;
}

/** The seven weekday names in display order, starting at `firstWeekday` (0 = Sunday). */
export function weekdayNames(
    firstWeekday: number,
    locale?: string,
    width: 'narrow' | 'short' | 'long' = 'short',
): string[] {
    const format = formatter(locale, { weekday: width });
    return Array.from({ length: 7 }, (_unused, index) => format.format(at(dayWithWeekday((firstWeekday + index) % 7))));
}

/** "January 2024" / "Januar 2024" — the heading over a month grid. */
export function monthTitle(year: number, month: number, locale?: string): string {
    return formatter(locale, { year: 'numeric', month: 'long' }).format(at({ year, month, day: 1 }));
}

/** "Monday, 8 January" — a day heading, and the accessible name of a day cell. */
export function dayHeading(date: LocalDate, locale?: string): string {
    return formatter(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(at(date));
}

/** "Mon, 8 Jan" — the same heading where a column header has to fit it. */
export function shortDayHeading(date: LocalDate, locale?: string): string {
    return formatter(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(at(date));
}

/** Whether the locale writes times on a 12-hour clock, which decides the hour gutter's form. */
export function usesHour12(locale?: string): boolean {
    return formatter(locale, { hour: 'numeric' }).resolvedOptions().hour12 === true;
}

/**
 * An hour of the day for the time grid's gutter: "9 AM" on a 12-hour clock, "09" on a 24-hour one,
 * where `{ hour: 'numeric' }` would add the locale's hour word ("09 Uhr") and fill the gutter.
 */
export function hourLabel(hour: number, locale?: string): string {
    const value = ((Math.trunc(hour) % 24) + 24) % 24;
    if (!usesHour12(locale)) return String(value).padStart(2, '0');
    return formatter(locale, { hour: 'numeric' }).format(at({ year: 1970, month: 1, day: 5 }, value));
}

/**
 * A time of day from minutes since midnight: "09:05", "9:05 AM".
 *
 * The 24-hour form asks for `2-digit` rather than `numeric`: GJS pads a numeric hour there and Node
 * does not, so the same locale would read "09:05" in the app and "9:05" in a Node test.
 */
export function timeLabel(minutes: number, locale?: string): string {
    const total = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const date = at({ year: 1970, month: 1, day: 5 }, Math.floor(total / 60), total % 60);
    const options: Intl.DateTimeFormatOptions = usesHour12(locale)
        ? { hour: 'numeric', minute: '2-digit' }
        : { hour: '2-digit', minute: '2-digit', hour12: false };
    return formatter(locale, options).format(date);
}

/** "09:00 – 10:30". The dash is punctuation, not language, so it needs no catalogue entry. */
export function timeRangeLabel(start: number, end: number, locale?: string): string {
    return `${timeLabel(start, locale)} – ${timeLabel(end, locale)}`;
}
