import {
    dateFromDayNumber,
    dayNumber,
    daysInMonth,
    isoWeek,
    weekdayOf,
    type LocalDate,
    type Weekday,
} from './dates.js';

export interface MonthGridOptions {
    year: number;
    /** 1-12 */
    month: number;
    /** The weekday the rows start on. The caller looks it up from the locale. */
    firstWeekday: Weekday;
    /** Always emit six rows, so the grid keeps its height between months. */
    sixRows?: boolean;
}

export interface MonthDay {
    date: LocalDate;
    weekday: Weekday;
    /** False for the leading/trailing days of neighbouring months. */
    inMonth: boolean;
}

export interface MonthWeek {
    /** ISO week number of the Thursday in this row, which exists for every first weekday. */
    isoWeek: number;
    isoWeekYear: number;
    days: MonthDay[];
}

export interface MonthGrid {
    year: number;
    month: number;
    weeks: MonthWeek[];
}

export function monthGrid(options: MonthGridOptions): MonthGrid {
    const { year, month, firstWeekday } = options;
    const first = { year, month, day: 1 };
    const length = daysInMonth(year, month);
    const lead = (weekdayOf(first) - firstWeekday + 7) % 7;
    const rows = options.sixRows ? 6 : Math.ceil((lead + length) / 7);
    const start = dayNumber(first) - lead;
    const weeks: MonthWeek[] = [];
    for (let r = 0; r < rows; r++) {
        const days: MonthDay[] = [];
        for (let c = 0; c < 7; c++) {
            const date = dateFromDayNumber(start + r * 7 + c);
            days.push({ date, weekday: weekdayOf(date), inMonth: date.year === year && date.month === month });
        }
        const thursday = days.find((d) => d.weekday === 4)!.date;
        const iso = isoWeek(thursday);
        weeks.push({ isoWeek: iso.week, isoWeekYear: iso.year, days });
    }
    return { year, month, weeks };
}
