// `Gtk.Calendar`'s date arithmetic — the six-by-seven grid, the week numbering, the
// month/year stepping and the marked days (ADR 0089).
//
// WHY THIS IS ARITHMETIC AND NOT RENDERING. Every one of these functions is a C function
// whose whole output is NUMBERS: `calendar_compute_days` fills two int arrays and paints
// nothing, `week_of_year` is `g_date_time_get_week_of_year` in a wrapper, and the marked-day
// table is 31 booleans. An element that re-derived them would be a second copy of a
// calendar, and the copy would be wrong in the two places calendars are always wrong —
// the leading blanks of a month that starts on the first day of the week, and the day a
// month step lands on when the source day does not exist in the target.
//
// WHAT IS PORTED, function for function:
//
//   `calendarIsLeapYear`     `leap`                             (gtkcalendar.c:143-146)
//   `calendarDaysInMonth`    `month_length[leap (year)][month]` (gtkcalendar.c:137-141)
//   `calendarWeekStart`      the `_NL_TIME_FIRST_WEEKDAY` branch (gtkcalendar.c:700-718)
//   `calendarDays`           `calendar_compute_days`           (gtkcalendar.c:923-979)
//   `calendarWeekNumber`     `week_of_year`                     (gtkcalendar.c:166-178)
//   `calendarStep`           `calendar_set_month_prev/next`,
//                             `calendar_set_year_prev/next`     (gtkcalendar.c:868-919)
//   `calendarSelectDay`      `calendar_select_day_internal`    (gtkcalendar.c:1089-1192)
//   `calendarNavigationButtons`
//                             `calendar_update_navigation_buttons`
//                                                                    (gtkcalendar.c:1055-1084)
//   `calendarMarkDay`        `gtk_calendar_mark_day` /
//                             `gtk_calendar_unmark_day`         (gtkcalendar.c:1650-1704)
//
// TWO LIBRARY FACTS BAKED IN, both load-bearing and both easy to get wrong:
//
//   · `g_date_time_add_months` CLAMPS. 31 January plus one month is 28 February, not 3
//     March — GLib normalises the overflow into the target month's length, which is why
//     `calendar_set_month_next` from the 31st does not walk into March. {@link calendarStep}
//     clamps; a port that adds 30 days does not, and lands on a different day.
//   · `g_date_time_get_week_of_year` is the ISO-8601 week, i.e. week 1 is the week holding
//     the 4th of January and weeks are Monday-based. {@link calendarWeekNumber} computes
//     ISO 8601 directly rather than reading the host locale, so the number a gallery
//     preview shows does not change with the machine it was rendered on — the same
//     trade `roving-focus.ts` makes for `dir`.
//
// THE DAY GRID IS ALWAYS 6x7. Upstream allocates `day_number_labels[6][7]` unconditionally
// (gtkcalendar.c:802-815) and fills the tail with NEXT-month days, so a month that needs
// five rows still paints six. Kept: the grid is row-homogeneous (gtkcalendar.c:786), so the
// height would jump between months otherwise.
//
// Reference: refs/gtk/gtk/gtkcalendar.c:134-178, :700-718, :923-1192, :1055-1084, :1650-1704
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { glibClamp } from './glib.js';

/** `YEAR_MIN` / `YEAR_MAX` — the range a `GDateTime` covers (gtkcalendar.c:134-135). */
export const CALENDAR_YEAR_MIN = 1;
export const CALENDAR_YEAR_MAX = 9999;

/** One day, addressed the way `GDateTime` addresses it: month 1-12, day 1-31. */
export interface AdwCalendarDate {
    readonly year: number;
    /** 1-12. NOT the GIR `GtkCalendar:month`, which is 0-11 and deprecated (4.20). */
    readonly month: number;
    readonly day: number;
}

/** Which month a grid cell belongs to — `MONTH_PREV` / `MONTH_CURRENT` / `MONTH_NEXT`. */
export type AdwCalendarCellMonth = 'previous' | 'current' | 'next';

/** One of the 42 cells `calendar_compute_days` fills. */
export interface AdwCalendarCell {
    /** The date the cell shows, already resolved across the month boundary. */
    readonly date: AdwCalendarDate;
    /** Which month it belongs to, which is what `.other-month` selects on. */
    readonly month: AdwCalendarCellMonth;
}

/** Which arrow the header's four buttons are, and whether that one is live. */
export interface AdwCalendarNavigation {
    readonly previousMonth: boolean;
    readonly nextMonth: boolean;
    readonly previousYear: boolean;
    readonly nextYear: boolean;
}

/** `leap (year)` (gtkcalendar.c:143-146), verbatim: `/4` unless `/100`, but `/400` is in. */
export function calendarIsLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * `month_length[leap (year)][month]` (gtkcalendar.c:137-141).
 *
 * MONTH IS 1-12. The C indexes a 13-slot row with the `GDateTime` month, whose slot 0 is the
 * zero pad; taking month 0 here would answer the pad (0) and quietly draw a month of
 * nothing, so the input is clamped into 1-12 the way the C's own `month` argument is by the
 * `GDateTime` that calls it.
 */
export function calendarDaysInMonth(year: number, month: number): number {
    const index = glibClamp(Math.trunc(month), 1, 12);
    if (index === 2) return calendarIsLeapYear(year) ? 29 : 28;
    return [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][index]!;
}

/**
 * The locale's first day of the week — the `_NL_TIME_FIRST_WEEKDAY` branch of `init`
 * (gtkcalendar.c:700-711), which is what `first_day` and every `week-number` label are
 * measured against.
 *
 * `firstWeekday` is `_NL_TIME_FIRST_WEEKDAY` (0 = Sunday), `weekFirstDay` is
 * `_NL_TIME_WEEK_1STDAY` mapped to 0 = Sunday or 1 = Monday (gtkcalendar.c:684-697). The
 * formula is the C's own: `(week_1stday + first_weekday - 1) % 7`. The C's `g_warning` for
 * an unrecognised `_NL_TIME_WEEK_1STDAY` leaves `week_1stday` at 0, so an unknown value is
 * 0 here too — and a negative result (the C's `-1` sentinel) is answered 0, which is the
 * same fallback the C takes one clause later (gtkcalendar.c:716-718).
 *
 * `0` is Sunday and `6` is Saturday, which is `GDateTime`'s own numbering and therefore the
 * one {@link calendarDays} can subtract with directly.
 */
export function calendarWeekStart(firstWeekday: number, weekFirstDay: number): number {
    const result = (weekFirstDay + firstWeekday - 1) % 7;
    return result < 0 || result > 6 ? 0 : result;
}

/**
 * `calendar_compute_days` (gtkcalendar.c:923-979) — the 42 cells a month paints.
 *
 * `first_day` is `day_of_week (year, month, 1)` shifted by the locale's week start, then
 * `if (first_day == 0) first_day = 7` — which looks like a mistake and is not: the C uses
 * `first_day` as a COLUMN count in the first loop and a `row = first_day / 7` SEED in the
 * second, and the two want different values at the boundary. Column 0 is a previous-month
 * day, so a month whose first falls on the locale's first day has SEVEN of them and starts
 * on the second row (:937, :946).
 *
 * The tail is NEXT-month days counting up from 1, one per remaining cell, and the C does
 * not stop at the end of the next month — a 42-cell grid showing a February that starts on
 * Saturday under a Sunday-first locale reaches into the following month twice and shows its
 * days 1..14 in the last row. That is what a real `Gtk.Calendar` shows, so it is what this
 * returns.
 */
export function calendarDays(year: number, month: number, weekStart: number): AdwCalendarCell[] {
    const currentMonth = glibClamp(Math.trunc(month), 1, 12);
    const currentYear = glibClamp(Math.trunc(year), CALENDAR_YEAR_MIN, CALENDAR_YEAR_MAX);
    const start = glibClamp(Math.trunc(weekStart), 0, 6);

    const daysInMonth = calendarDaysInMonth(currentYear, currentMonth);
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const daysInPreviousMonth = calendarDaysInMonth(previousYear, previousMonth);

    // `day_of_week` is `g_date_time_get_day_of_week`, whose numbering has Sunday at 0. The
    // Zeller-free form is the one every calendar implementation agrees on for the proleptic
    // Gregorian calendar, and it needs no epoch constant to read.
    let firstDay = (weekdayOfWeek(currentYear, currentMonth, 1) - start + 7) % 7;
    if (firstDay === 0) firstDay = 7;

    const cells: AdwCalendarCell[] = [];
    let day = daysInPreviousMonth - firstDay + 1;
    for (let column = 0; column < firstDay; column++) {
        cells.push({ date: { year: previousYear, month: previousMonth, day }, month: 'previous' });
        day += 1;
    }

    let row = Math.trunc(firstDay / 7);
    let column = firstDay % 7;
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ date: { year: currentYear, month: currentMonth, day: d }, month: 'current' });
        column += 1;
        if (column === 7) {
            row += 1;
            column = 0;
        }
    }

    day = 1;
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    for (; row <= 5; row++) {
        for (; column <= 6; column++) {
            cells.push({ date: { year: nextYear, month: nextMonth, day }, month: 'next' });
            day += 1;
        }
        column = 0;
    }
    return cells;
}

/**
 * `g_date_time_get_day_of_week` — Sunday 0 through Saturday 6.
 *
 * The proleptic Gregorian day count, offset by the epoch's own weekday. 1970-01-01 was a
 * Thursday, so the offset is 4; the C gets the same number by asking GLib, which uses the
 * same calendar for every year back to 1.
 */
function weekdayOfWeek(year: number, month: number, day: number): number {
    const total = daysFromCivil(year, month, day);
    return (((total + 4) % 7) + 7) % 7;
}

/**
 * Days since 1970-01-01 — Howard Hinnant's `days_from_civil`, which is exact for the whole
 * proleptic Gregorian range `YEAR_MIN..YEAR_MAX` with no lookup table and no floating point.
 */
function daysFromCivil(year: number, month: number, day: number): number {
    const y = month <= 2 ? year - 1 : year;
    const era = Math.floor((y >= 0 ? y : y - 399) / 400);
    const yearOfEra = y - era * 400;
    const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
    const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return era * 146097 + dayOfEra - 719468;
}

/** The civil date a day count names — the inverse of {@link daysFromCivil}, for the ISO walk. */
function civilFromDays(days: number): { year: number; month: number; day: number } {
    const z = days + 719468;
    const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
    const dayOfEra = z - era * 146097;
    const yearOfEra = Math.floor(
        (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
    );
    const year = yearOfEra + era * 400;
    const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
    const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
    const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
    const month = monthPrime + (monthPrime < 10 ? 3 : -9);
    return { year: year + (month <= 2 ? 1 : 0), month, day };
}

/**
 * `week_of_year` (gtkcalendar.c:166-178) — the ISO-8601 week, which is what
 * `g_date_time_get_week_of_year` returns.
 *
 * ISO 8601: weeks are Monday-based, and week 1 is the one holding the year's FIRST Thursday
 * (equivalently, the 4th of January). So 1 January 2021 is a Friday and belongs to week 53
 * of 2020 — the case a naive "week = (dayOfYear + weekdayOffset) / 7" gets wrong, and the
 * one `week-number` label that would visibly disagree with every other tool.
 *
 * The year is a `YEAR_MIN`-clamped date; a January date can belong to week 52 or 53 of the
 * year BEFORE it, which is the C's own arithmetic (gtkcalendar.c:1148-1158) rather than
 * something this adds.
 */
export function calendarWeekNumber(date: AdwCalendarDate): number {
    const year = glibClamp(Math.trunc(date.year), CALENDAR_YEAR_MIN, CALENDAR_YEAR_MAX);
    const month = glibClamp(Math.trunc(date.month), 1, 12);
    const day = glibClamp(Math.trunc(date.day), 1, calendarDaysInMonth(year, month));

    const thursday = thursdayOfWeek(daysFromCivil(year, month, day), weekdayOfWeek(year, month, day));
    const thursdayYear = civilFromDays(thursday).year;
    return 1 + Math.round((thursday - thursdayOfJanuaryFirst(thursdayYear)) / 7);
}

/**
 * The Thursday of the ISO week holding the given day — week 1 is defined by its Thursday, so
 * this is the quantity two dates are compared by. `weekday` is Sunday 0, as everywhere here.
 */
function thursdayOfWeek(dayCount: number, weekday: number): number {
    return dayCount - ((weekday + 6) % 7) + 3;
}

/** The Thursday of the week that holds 4 January of `year` — the anchor of its week 1. */
function thursdayOfJanuaryFirst(year: number): number {
    return thursdayOfWeek(daysFromCivil(year, 1, 4), weekdayOfWeek(year, 1, 4));
}

/** Which of the four header arrows are live — `calendar_update_navigation_buttons` (:1055-1084). */
export function calendarNavigationButtons(date: AdwCalendarDate): AdwCalendarNavigation {
    const year = glibClamp(Math.trunc(date.year), CALENDAR_YEAR_MIN, CALENDAR_YEAR_MAX);
    const month = glibClamp(Math.trunc(date.month), 1, 12);
    const atMin = year === CALENDAR_YEAR_MIN;
    const atMax = year === CALENDAR_YEAR_MAX;
    return {
        previousMonth: !atMin || month !== 1,
        nextMonth: !atMax || month !== 12,
        previousYear: !atMin,
        nextYear: !atMax,
    };
}

/** `calendar_set_month_prev/next` and `calendar_set_year_prev/next` (:868-919). */
export type AdwCalendarStep = 'previous-month' | 'next-month' | 'previous-year' | 'next-year';

/**
 * The date a navigation arrow lands on — `g_date_time_add_months` / `_years`, CLAMPED.
 *
 * The clamp is GLib's and it is the whole reason the arithmetic is here: 31 January plus a
 * month is 28 (or 29) February, and 29 February plus a YEAR is 28 February the next year.
 * Both are what `g_date_time_add_months` does — it adds whole months and then clamps the
 * day to the target month's length — and both are visible the moment a user pages a month
 * from a 31st.
 */
export function calendarStep(date: AdwCalendarDate, step: AdwCalendarStep): AdwCalendarDate {
    const year = glibClamp(Math.trunc(date.year), CALENDAR_YEAR_MIN, CALENDAR_YEAR_MAX);
    const month = glibClamp(Math.trunc(date.month), 1, 12);
    const day = glibClamp(Math.trunc(date.day), 1, calendarDaysInMonth(year, month));

    if (step === 'previous-year' || step === 'next-year') {
        const target = year + (step === 'next-year' ? 1 : -1);
        return {
            year: glibClamp(target, CALENDAR_YEAR_MIN, CALENDAR_YEAR_MAX),
            month,
            day: Math.min(day, calendarDaysInMonth(target, month)),
        };
    }

    const delta = step === 'next-month' ? 1 : -1;
    // The month count is clamped as a WHOLE, so stepping off the end of 0001-01 stays in
    // January rather than decomposing to year 0 December and clamping the year alone. Upstream
    // never reaches either: `calendar_update_navigation_buttons` makes that arrow insensitive
    // (gtkcalendar.c:1071-1076), which is the same boundary {@link calendarNavigationButtons}
    // reports and the element turns into a disabled button.
    const absolute = glibClamp(year * 12 + (month - 1) + delta, CALENDAR_YEAR_MIN * 12, CALENDAR_YEAR_MAX * 12 + 11);
    const targetYear = Math.floor(absolute / 12);
    const targetMonth = (absolute % 12) + 1;
    return {
        year: targetYear,
        month: targetMonth,
        day: Math.min(day, calendarDaysInMonth(targetYear, targetMonth)),
    };
}

/** What `calendar_select_day_internal` (:1089-1192) answers for a proposed date. */
export interface AdwCalendarSelectResult {
    /** The date the calendar now holds. */
    readonly date: AdwCalendarDate;
    readonly dayChanged: boolean;
    readonly monthChanged: boolean;
    readonly yearChanged: boolean;
    /**
     * Whether `::day-selected` fires. FALSE for every property write and for a navigation
     * arrow, which is the C's `emit_day_signal` argument (gtkcalendar.c:868-919 pass FALSE);
     * only `select_day`/`set_date` and a click pass TRUE (:1585, :1720).
     */
    readonly emitDaySignal: boolean;
}

/**
 * `calendar_select_day_internal` (gtkcalendar.c:1089-1192) — including its early return.
 *
 * The early return is the part worth having: a date equal in all three components changes
 * NOTHING and notifies nothing, so writing the current date back is silent (:1103-1104).
 * A port that assigned unconditionally would fire `::day-selected` on every attribute sync.
 */
export function calendarSelectDay(
    current: AdwCalendarDate,
    target: AdwCalendarDate,
    emitDaySignal = true,
): AdwCalendarSelectResult {
    const year = glibClamp(Math.trunc(target.year), CALENDAR_YEAR_MIN, CALENDAR_YEAR_MAX);
    const month = glibClamp(Math.trunc(target.month), 1, 12);
    const date: AdwCalendarDate = {
        year,
        month,
        day: glibClamp(Math.trunc(target.day), 1, calendarDaysInMonth(year, month)),
    };
    const dayChanged = current.day !== date.day;
    const monthChanged = current.month !== date.month;
    const yearChanged = current.year !== date.year;
    return { date, dayChanged, monthChanged, yearChanged, emitDaySignal: emitDaySignal && dayChanged };
}

/** `gtk_calendar_mark_day`'s accepted range — `day >= 1 && day <= 31` (:1657, :1697). */
export const CALENDAR_MARK_MIN = 1;
export const CALENDAR_MARK_MAX = 31;

/**
 * `gtk_calendar_mark_day` / `gtk_calendar_unmark_day` (:1650-1704) — the 31-boolean table,
 * as a NEW array.
 *
 * A copy because the C's `marked_date` is reached from four places and the guard is
 * idempotence, not mutation: a day already marked is not counted twice (:1657) and a day not
 * marked is not cleared (:1697). Returning the same array when nothing changed is what lets
 * the caller skip the DOM write, so the reference identity of the result IS the signal.
 *
 * The table is 31 slots and NOT a per-month set, which is why a mark on the 31st is still
 * there after paging to a 30-day month: `calendar_update_day_labels` only consults
 * `marked_date[day - 1]` for CURRENT-month cells (gtkcalendar.c:1041-1042), so the mark
 * simply does not show and comes back when the month does.
 */
export function calendarMarkDay(marked: readonly boolean[], day: number, mark: boolean): boolean[] {
    const index = Math.trunc(day);
    if (index < CALENDAR_MARK_MIN || index > CALENDAR_MARK_MAX) return marked as boolean[];
    if ((marked[index - 1] === true) === mark) return marked as boolean[];
    const next = marked.slice();
    next[index - 1] = mark;
    return next;
}

/** `gtk_calendar_get_day_is_marked` (:1668-1682) — an out-of-range day is never marked. */
export function calendarDayIsMarked(marked: readonly boolean[], day: number): boolean {
    const index = Math.trunc(day);
    if (index < CALENDAR_MARK_MIN || index > CALENDAR_MARK_MAX) return false;
    return marked[index - 1] === true;
}

/** `gtk_calendar_clear_marks` (:1589-1613) — every slot off, in one assignment. */
export function calendarClearMarks(): boolean[] {
    return Array.from({ length: CALENDAR_MARK_MAX }, () => false);
}
