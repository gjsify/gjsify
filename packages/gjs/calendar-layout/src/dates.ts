/** A calendar date as the wall calendar shows it. `month` is 1-12. */
export interface LocalDate {
    year: number;
    month: number;
    day: number;
}

/** A wall-clock date and time. `hour` and `minute` default to 0 (and are ignored for all-day items). */
export interface LocalDateTime extends LocalDate {
    hour?: number;
    minute?: number;
}

/** 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MINUTES_PER_DAY = 1440;

/** Days since 1970-01-01 in the proleptic Gregorian calendar (Hinnant's civil algorithm). */
export function dayNumber(date: LocalDate): number {
    const m = date.month;
    const y = date.year - (m <= 2 ? 1 : 0);
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + date.day - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

export function dateFromDayNumber(n: number): LocalDate {
    const z = n + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export function weekdayOf(date: LocalDate): Weekday {
    return ((((dayNumber(date) + 4) % 7) + 7) % 7) as Weekday;
}

export function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** ISO 8601 week of the date; `year` is the week-numbering year, which can differ from the calendar year. */
export function isoWeek(date: LocalDate): { year: number; week: number } {
    const n = dayNumber(date);
    const isoWeekday = (weekdayOf(date) + 6) % 7; // Monday = 0
    const thursday = n - isoWeekday + 3;
    const year = dateFromDayNumber(thursday).year;
    const week = Math.floor((thursday - dayNumber({ year, month: 1, day: 1 })) / 7) + 1;
    return { year, week };
}

export function compareIds(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
