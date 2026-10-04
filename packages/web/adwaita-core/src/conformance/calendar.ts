// Calendar vectors — the six-by-seven grid, the ISO week numbers, the clamped navigation
// steps and the marked-day table (ADR 0089).
//
// WHAT EACH TABLE PINS DOWN, and the defect it exists for:
//
//   DAYS     The grid `calendar_compute_days` fills. The rows that matter are the boundary
//             cases, because that is where a calendar goes wrong: a month whose first day IS
//             the locale's first day, where the C's `if (first_day == 0) first_day = 7` turns
//             ZERO leading blanks into SEVEN and pushes the month onto the second row; and a
//             February that starts on the locale's first day under a Monday-first locale,
//             where 42 cells reach 14 days into the FOLLOWING month. A port that "fixed" the
//             seven and drew five rows instead would be right and wrong at once.
//   WEEK     `week_of_year`, i.e. ISO 8601. The rows that matter are the ones a naive
//             "week = (dayOfYear + 6) / 7" gets wrong: 1 January can belong to week 52 or 53
//             of the PREVIOUS year, and 31 December can belong to week 1 of the next.
//   STEP     The clamped month and year arrows. 31 January plus a month is 28 (or 29)
//             February — GLib clamps, so the walk never lands on 3 March.
//   SELECT   `calendar_select_day_internal`'s early return: a date equal in all three
//             components notifies nothing and fires no signal, which is what stops every
//             attribute sync from emitting `::day-selected`.
//   MARKS    The 31-slot table's range check and its idempotence, which is why `mark_day`
//             on an already-marked day is silent and why day 32 is not an error.
//
// Reference: refs/gtk/gtk/gtkcalendar.c:923-979, :1089-1192, :1650-1704
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type { AdwCalendarDate, AdwCalendarStep } from '../calendar.js';

/** One month, and the cells its grid must hold. */
export interface CalendarDaysVector {
    readonly rule: string;
    readonly year: number;
    /** 1-12, `GDateTime`'s own numbering. */
    readonly month: number;
    /** 0 = Sunday, as `_NL_TIME_FIRST_WEEKDAY` and `g_date_time_get_day_of_week` spell it. */
    readonly weekStart: number;
    /** How many leading cells belong to the PREVIOUS month. */
    readonly leading: number;
    /** How many trailing cells belong to the NEXT month. */
    readonly trailing: number;
    /** The last cell, as `YYYY-MM-DD` — the row that proves the tail ran where the C runs it. */
    readonly last: string;
}

export const CALENDAR_DAYS_VECTORS: readonly CalendarDaysVector[] = [
    {
        // October 2026 starts on a Thursday, so under a Monday-first locale three cells are
        // previous-month days — the everyday case.
        rule: 'a month that starts mid-week pads the front and fills the grid',
        year: 2026,
        month: 10,
        weekStart: 1,
        leading: 3,
        trailing: 8,
        last: '2026-11-08',
    },
    {
        rule: 'a 30-day month that starts on Tuesday leaves eleven trailing days',
        year: 2027,
        month: 6,
        weekStart: 1,
        leading: 1,
        trailing: 11,
        last: '2027-07-11',
    },
    {
        // THE row. February 2027 starts on a MONDAY, so under a Monday-first locale
        // `first_day = (1 + 7 - 1) % 7 = 0` — and the C turns that into SEVEN
        // (gtkcalendar.c:937-938), so all 28 days sit on rows 2-5 and seven previous-month
        // cells precede them. A port that dropped the `== 0` branch puts December's 31st in the
        // wrong cell and every day after it one row too high.
        rule: 'a month starting on the first day of the week takes a WHOLE row of blanks',
        year: 2027,
        month: 2,
        weekStart: 1,
        leading: 7,
        trailing: 7,
        last: '2027-03-07',
    },
    {
        // The same February under a Sunday-first locale, where the first day is `first_day = 1`
        // and 28 days fit into the remaining 27 cells: the grid's last row is the next month's
        // 1st to 13th. Upstream draws exactly that, because the tail loop runs to row 5
        // regardless of how much of the next month that is (gtkcalendar.c:970-979).
        rule: 'a 28-day month under a Sunday-first locale trails 13 days into the next month',
        year: 2027,
        month: 2,
        weekStart: 0,
        leading: 1,
        trailing: 13,
        last: '2027-03-13',
    },
    {
        rule: 'a leap February that starts mid-week gains exactly the extra cell',
        year: 2024,
        month: 2,
        weekStart: 1,
        leading: 3,
        trailing: 10,
        last: '2024-03-10',
    },
    {
        // 1900 is divisible by 4 and by 100 but not by 400, so `leap` says no and February has
        // 28 days — the case a `/4` implementation gets wrong, and the one 2000 gets wrong the
        // other way.
        rule: '1900 is not a leap year, so its February is 28 days',
        year: 1900,
        month: 2,
        weekStart: 1,
        leading: 3,
        trailing: 11,
        last: '1900-03-11',
    },
    {
        rule: 'a December that ends the grid leaves the tail in January',
        year: 2026,
        month: 12,
        weekStart: 1,
        leading: 1,
        trailing: 10,
        last: '2027-01-10',
    },
    {
        // The last two are a PAIR over the same month and different `week_start`s, which is what
        // shows the leading blanks follow the locale rather than a hard-coded Monday.
        rule: 'January 2026 under a Monday-first locale starts three cells in',
        year: 2026,
        month: 1,
        weekStart: 1,
        leading: 3,
        trailing: 8,
        last: '2026-02-08',
    },
    {
        rule: 'the same January under a Sunday-first locale starts four cells in',
        year: 2026,
        month: 1,
        weekStart: 0,
        leading: 4,
        trailing: 7,
        last: '2026-02-07',
    },
];

/** One date, and the ISO week its `week-number` label must show. */
export interface CalendarWeekVector {
    readonly rule: string;
    readonly date: AdwCalendarDate;
    readonly week: number;
}

export const CALENDAR_WEEK_VECTORS: readonly CalendarWeekVector[] = [
    { rule: "4 January always opens a year's ISO week 1", date: { year: 2026, month: 1, day: 4 }, week: 1 },
    { rule: 'a plain mid-year date is its own week', date: { year: 2026, month: 7, day: 15 }, week: 29 },
    {
        // The row every naive "week = (dayOfYear + 6) / 7" fails: 1 January 2021 is a Friday,
        // which ISO puts in the LAST week of the PREVIOUS year.
        rule: '1 January 2021 belongs to week 53 of 2020',
        date: { year: 2021, month: 1, day: 1 },
        week: 53,
    },
    {
        // And the mirror: 31 December 2019 is a Tuesday, so it opens 2020's week 1.
        rule: '31 December 2019 belongs to week 1 of 2020',
        date: { year: 2019, month: 12, day: 31 },
        week: 1,
    },
    { rule: 'a year whose 1 January is a Thursday has 53 weeks', date: { year: 2026, month: 12, day: 28 }, week: 53 },
    {
        // `YEAR_MIN` is 1, and the proleptic Gregorian 1 January was a Monday — so the first
        // date the widget can be given is the FIRST day of its own week 1, not a week 52 tail
        // of year 0. A `daysFromCivil` with the wrong epoch constant is off by exactly this.
        rule: 'the first day of the supported range opens its own week 1',
        date: { year: 1, month: 1, day: 1 },
        week: 1,
    },
];

/** One navigation press, and the date it must land on. */
export interface CalendarStepVector {
    readonly rule: string;
    readonly from: AdwCalendarDate;
    readonly step: AdwCalendarStep;
    readonly expected: AdwCalendarDate;
}

export const CALENDAR_STEP_VECTORS: readonly CalendarStepVector[] = [
    {
        // The clamp `g_date_time_add_months` applies and a "+30 days" port does not: 31
        // January plus a month lands on the 28th, never on 3 March.
        rule: '31 January plus a month clamps to the end of February',
        from: { year: 2026, month: 1, day: 31 },
        step: 'next-month',
        expected: { year: 2026, month: 2, day: 28 },
    },
    {
        rule: 'the same walk in a leap year lands on the 29th',
        from: { year: 2024, month: 1, day: 31 },
        step: 'next-month',
        expected: { year: 2024, month: 2, day: 29 },
    },
    {
        rule: '31 March minus a month clamps backwards to the 28th',
        from: { year: 2026, month: 3, day: 31 },
        step: 'previous-month',
        expected: { year: 2026, month: 2, day: 28 },
    },
    {
        rule: 'December plus a month rolls the year over',
        from: { year: 2026, month: 12, day: 15 },
        step: 'next-month',
        expected: { year: 2027, month: 1, day: 15 },
    },
    {
        rule: 'January minus a month rolls back into the previous December',
        from: { year: 2027, month: 1, day: 15 },
        step: 'previous-month',
        expected: { year: 2026, month: 12, day: 15 },
    },
    {
        // `g_date_time_add_years` clamps the day the same way, and this is the ONLY day in
        // the supported range where it can fire.
        rule: '29 February plus a year lands on 28 February',
        from: { year: 2024, month: 2, day: 29 },
        step: 'next-year',
        expected: { year: 2025, month: 2, day: 28 },
    },
    {
        rule: 'a year step keeps the month and the day',
        from: { year: 2026, month: 7, day: 15 },
        step: 'next-year',
        expected: { year: 2027, month: 7, day: 15 },
    },
    {
        // Upstream never reaches this: `calendar_update_navigation_buttons` makes the arrow
        // insensitive at the ends, so the walk is clamped rather than rolled.
        rule: 'stepping off the start of the range stays put',
        from: { year: 1, month: 1, day: 1 },
        step: 'previous-month',
        expected: { year: 1, month: 1, day: 1 },
    },
    {
        rule: 'stepping off the end of the range stays put',
        from: { year: 9999, month: 12, day: 31 },
        step: 'next-month',
        expected: { year: 9999, month: 12, day: 31 },
    },
];

/** One selection write, and what it changes. */
export interface CalendarSelectVector {
    readonly rule: string;
    readonly current: AdwCalendarDate;
    readonly target: AdwCalendarDate;
    /** The `emit_day_signal` argument the caller passes. */
    readonly emit: boolean;
    readonly expected: {
        readonly date: AdwCalendarDate;
        readonly dayChanged: boolean;
        readonly monthChanged: boolean;
        readonly yearChanged: boolean;
        readonly emitDaySignal: boolean;
    };
}

export const CALENDAR_SELECT_VECTORS: readonly CalendarSelectVector[] = [
    {
        // gtkcalendar.c:1103-1104 — the early return. A port that assigns unconditionally
        // emits `::day-selected` on every attribute sync.
        rule: 'selecting the date already shown changes nothing at all',
        current: { year: 2026, month: 10, day: 2 },
        target: { year: 2026, month: 10, day: 2 },
        emit: true,
        expected: {
            date: { year: 2026, month: 10, day: 2 },
            dayChanged: false,
            monthChanged: false,
            yearChanged: false,
            emitDaySignal: false,
        },
    },
    {
        rule: 'a different day in the same month notifies the day and fires the signal',
        current: { year: 2026, month: 10, day: 2 },
        target: { year: 2026, month: 10, day: 9 },
        emit: true,
        expected: {
            date: { year: 2026, month: 10, day: 9 },
            dayChanged: true,
            monthChanged: false,
            yearChanged: false,
            emitDaySignal: true,
        },
    },
    {
        // A navigation arrow passes `emit_day_signal = FALSE` (gtkcalendar.c:868-919), so
        // paging the month repaints without telling an application the user picked a day.
        rule: 'a month step notifies the month without firing day-selected',
        current: { year: 2026, month: 10, day: 2 },
        target: { year: 2026, month: 11, day: 2 },
        emit: false,
        expected: {
            date: { year: 2026, month: 11, day: 2 },
            dayChanged: false,
            monthChanged: true,
            yearChanged: false,
            emitDaySignal: false,
        },
    },
    {
        // 31 February is normalised down to the 28th rather than refused, so a typed date can
        // never leave the calendar holding a day its own grid does not draw.
        rule: 'an out-of-range day is clamped into the target month',
        current: { year: 2026, month: 1, day: 31 },
        target: { year: 2026, month: 2, day: 31 },
        emit: true,
        expected: {
            date: { year: 2026, month: 2, day: 28 },
            dayChanged: true,
            monthChanged: true,
            yearChanged: false,
            emitDaySignal: true,
        },
    },
    {
        rule: 'a month step that keeps the day notifies only the month',
        current: { year: 2026, month: 10, day: 2 },
        target: { year: 2027, month: 10, day: 2 },
        emit: false,
        expected: {
            date: { year: 2027, month: 10, day: 2 },
            dayChanged: false,
            monthChanged: false,
            yearChanged: true,
            emitDaySignal: false,
        },
    },
];

/** One mark write, and what the 31-slot table must answer. */
export interface CalendarMarkVector {
    readonly rule: string;
    readonly marked: readonly boolean[];
    readonly day: number;
    readonly mark: boolean;
    /** The table afterwards; the IDENTITY is the point for the two no-op rows. */
    readonly expected: readonly boolean[];
    readonly changed: boolean;
}

const withDay = (days: number[]): boolean[] => {
    const table = Array.from({ length: 31 }, () => false);
    for (const day of days) table[day - 1] = true;
    return table;
};

export const CALENDAR_MARK_VECTORS: readonly CalendarMarkVector[] = [
    {
        rule: 'marking a day sets its slot',
        marked: withDay([]),
        day: 14,
        mark: true,
        expected: withDay([14]),
        changed: true,
    },
    {
        // `day >= 1 && day <= 31 && !marked_date[day - 1]` (:1657) — the idempotence is the
        // guard, so a second mark is silent and the table keeps its identity.
        rule: 'marking an already-marked day changes nothing',
        marked: withDay([14]),
        day: 14,
        mark: true,
        expected: withDay([14]),
        changed: false,
    },
    {
        rule: 'unmarking an unmarked day changes nothing',
        marked: withDay([]),
        day: 3,
        mark: false,
        expected: withDay([]),
        changed: false,
    },
    {
        rule: 'day 0 is out of range and ignored, not clamped to day 1',
        marked: withDay([1]),
        day: 0,
        mark: true,
        expected: withDay([1]),
        changed: false,
    },
    {
        rule: 'day 32 is out of range and ignored, not clamped to day 31',
        marked: withDay([31]),
        day: 32,
        mark: true,
        expected: withDay([31]),
        changed: false,
    },
    {
        rule: 'the two ends of the range are both inside it',
        marked: withDay([]),
        day: 31,
        mark: true,
        expected: withDay([31]),
        changed: true,
    },
];

/** Which header arrows are live at a date — `calendar_update_navigation_buttons`. */
export interface CalendarNavigationVector {
    readonly rule: string;
    readonly date: AdwCalendarDate;
    readonly expected: {
        readonly previousMonth: boolean;
        readonly nextMonth: boolean;
        readonly previousYear: boolean;
        readonly nextYear: boolean;
    };
}

export const CALENDAR_NAVIGATION_VECTORS: readonly CalendarNavigationVector[] = [
    {
        rule: 'mid-range leaves every arrow live',
        date: { year: 2026, month: 10, day: 2 },
        expected: { previousMonth: true, nextMonth: true, previousYear: true, nextYear: true },
    },
    {
        // The C disables the MONTH arrow and the YEAR arrow separately at each end
        // (gtkcalendar.c:1070-1083), so the earliest date in the range has two dead arrows
        // and the latest has the other two.
        rule: 'the first month of the first year kills both backward arrows',
        date: { year: 1, month: 1, day: 1 },
        expected: { previousMonth: false, nextMonth: true, previousYear: false, nextYear: true },
    },
    {
        rule: 'the last month of the last year kills both forward arrows',
        date: { year: 9999, month: 12, day: 31 },
        expected: { previousMonth: true, nextMonth: false, previousYear: true, nextYear: false },
    },
    {
        rule: 'the first month of a mid-range year keeps the year arrow live',
        date: { year: 2026, month: 1, day: 1 },
        expected: { previousMonth: true, nextMonth: true, previousYear: true, nextYear: true },
    },
];
