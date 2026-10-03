// `Gtk.Calendar`'s date arithmetic, held to gtkcalendar.c (ADR 0089).
//
// The suite is the conformance tables plus the properties a table cannot state: that the grid
// is ALWAYS 42 cells (upstream allocates `day_number_labels[6][7]` unconditionally, so a
// five-row month still paints six), that the cells are chronologically CONSECUTIVE across the
// month boundary, and that the ISO week agrees with an independent derivation over a century.
import { describe, expect, it } from '@gjsify/unit';

import {
    CALENDAR_DAYS_VECTORS,
    CALENDAR_MARK_VECTORS,
    CALENDAR_NAVIGATION_VECTORS,
    CALENDAR_SELECT_VECTORS,
    CALENDAR_STEP_VECTORS,
    CALENDAR_WEEK_VECTORS,
} from './conformance/calendar.js';
import {
    CALENDAR_MARK_MAX,
    CALENDAR_YEAR_MAX,
    CALENDAR_YEAR_MIN,
    calendarClearMarks,
    calendarDayIsMarked,
    calendarDays,
    calendarDaysInMonth,
    calendarIsLeapYear,
    calendarMarkDay,
    calendarNavigationButtons,
    calendarSelectDay,
    calendarStep,
    calendarWeekNumber,
    calendarWeekStart,
} from './calendar.js';

/** Days since 1970-01-01, via the host's own calendar — an INDEPENDENT derivation. */
const hostDayCount = (year: number, month: number, day: number): number =>
    Math.round(Date.UTC(year, month - 1, day) / 86_400_000);

const isoDate = (year: number, month: number, day: number): string =>
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const isoWeekFromHost = (year: number, month: number, day: number): number => {
    const date = new Date(Date.UTC(year, month - 1, day));
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const thursday = new Date(date.getTime() - mondayOffset * 86_400_000 + 3 * 86_400_000);
    const anchor = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
    const anchorMonday = (anchor.getUTCDay() + 6) % 7;
    const anchorThursday = new Date(anchor.getTime() - anchorMonday * 86_400_000 + 3 * 86_400_000);
    return 1 + Math.round((thursday.getTime() - anchorThursday.getTime()) / (7 * 86_400_000));
};

export default async () => {
    await describe('the grid vectors, through calendarDays', async () => {
        for (const vector of CALENDAR_DAYS_VECTORS) {
            await it(vector.rule, () => {
                const cells = calendarDays(vector.year, vector.month, vector.weekStart);
                expect(cells).toHaveLength(42);
                const leading = cells.findIndex((cell) => cell.month === 'current');
                let trailing = 0;
                for (let i = cells.length - 1; i >= 0 && cells[i]!.month !== 'current'; i--) trailing++;
                expect(leading).toBe(vector.leading);
                expect(trailing).toBe(vector.trailing);
                const last = cells[cells.length - 1]!.date;
                expect(isoDate(last.year, last.month, last.day)).toBe(vector.last);
            });
        }
    });

    await describe('the grid is always six rows of seven, and always consecutive', async () => {
        await it('holds over a decade of months, both week starts', () => {
            for (let year = 2000; year <= 2010; year++) {
                for (let month = 1; month <= 12; month++) {
                    for (const weekStart of [0, 1, 6]) {
                        const cells = calendarDays(year, month, weekStart);
                        expect(cells).toHaveLength(42);
                        let previous: number | null = null;
                        for (const cell of cells) {
                            const count = hostDayCount(cell.date.year, cell.date.month, cell.date.day);
                            // The month a cell claims must be the month its own date is in,
                            // resolved across the year boundary in the same direction.
                            const wanted =
                                cell.month === 'previous'
                                    ? month === 1
                                        ? 12
                                        : month - 1
                                    : month === 12
                                      ? 1
                                      : month + 1;
                            const isEdge = cell.month !== 'current';
                            if (isEdge) expect(cell.date.month).toBe(wanted);
                            if (previous !== null) expect(count - previous).toBe(1);
                            previous = count;
                        }
                    }
                }
            }
        });

        await it('puts every day of the month in a CURRENT cell exactly once', () => {
            for (let month = 1; month <= 12; month++) {
                const cells = calendarDays(2026, month, 1);
                const current = cells.filter((cell) => cell.month === 'current');
                expect(current).toHaveLength(calendarDaysInMonth(2026, month));
                expect(current.map((cell) => cell.date.day)).toStrictEqual(
                    Array.from({ length: calendarDaysInMonth(2026, month) }, (_, i) => i + 1),
                );
            }
        });
    });

    await describe('leap years and month lengths', async () => {
        await it('agrees with the host calendar for a century and a half', () => {
            for (let year = 1900; year <= 2050; year++) {
                expect(calendarIsLeapYear(year)).toBe((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0);
                for (let month = 1; month <= 12; month++) {
                    expect(calendarDaysInMonth(year, month)).toBe(new Date(Date.UTC(year, month, 0)).getUTCDate());
                }
            }
        });

        await it('clamps an out-of-range month into 1-12 rather than reading the zero pad', () => {
            expect(calendarDaysInMonth(2024, 0)).toBe(31);
            expect(calendarDaysInMonth(2024, 13)).toBe(31);
            expect(calendarDaysInMonth(2024, 2)).toBe(29);
        });
    });

    await describe('the week vectors, through calendarWeekNumber', async () => {
        for (const vector of CALENDAR_WEEK_VECTORS) {
            await it(vector.rule, () => {
                expect(calendarWeekNumber(vector.date)).toBe(vector.week);
            });
        }

        await it('agrees with an independent ISO derivation over half a century', () => {
            for (let year = 1990; year <= 2040; year++) {
                for (let month = 1; month <= 12; month++) {
                    for (let day = 1; day <= calendarDaysInMonth(year, month); day++) {
                        expect(calendarWeekNumber({ year, month, day })).toBe(isoWeekFromHost(year, month, day));
                    }
                }
            }
        });
    });

    await describe('the step vectors, through calendarStep', async () => {
        for (const vector of CALENDAR_STEP_VECTORS) {
            await it(vector.rule, () => {
                expect(calendarStep(vector.from, vector.step)).toStrictEqual(vector.expected);
            });
        }

        await it('never lands on a day the target month does not have, over a year of 31sts', () => {
            for (let month = 1; month <= 12; month++) {
                for (const step of ['next-month', 'previous-month'] as const) {
                    for (const year of [2023, 2024, 2025, 2026]) {
                        const landed = calendarStep({ year, month, day: 31 }, step);
                        expect(landed.day).toBeLessThanOrEqual(calendarDaysInMonth(landed.year, landed.month));
                        expect(landed.day).toBeGreaterThanOrEqual(1);
                        expect(landed.month).toBeGreaterThanOrEqual(1);
                        expect(landed.month).toBeLessThanOrEqual(12);
                    }
                }
            }
        });

        await it('keeps every landed date inside the supported year range', () => {
            for (const year of [CALENDAR_YEAR_MIN, CALENDAR_YEAR_MAX]) {
                for (const month of [1, 12]) {
                    for (const step of ['next-month', 'previous-month', 'next-year', 'previous-year'] as const) {
                        const landed = calendarStep({ year, month, day: 1 }, step);
                        expect(landed.year).toBeGreaterThanOrEqual(CALENDAR_YEAR_MIN);
                        expect(landed.year).toBeLessThanOrEqual(CALENDAR_YEAR_MAX);
                    }
                }
            }
        });
    });

    await describe('the select vectors, through calendarSelectDay', async () => {
        for (const vector of CALENDAR_SELECT_VECTORS) {
            await it(vector.rule, () => {
                expect(calendarSelectDay(vector.current, vector.target, vector.emit)).toStrictEqual(vector.expected);
            });
        }

        await it('day-selected fires on a WRITE even when only the month moved', () => {
            // The C separates the notify from the signal: `emit_day_signal` is the CALLER's
            // argument, and only `day_changed` additionally gates it (:1169-1175).
            expect(
                calendarSelectDay({ year: 2026, month: 10, day: 2 }, { year: 2026, month: 11, day: 2 }, true),
            ).toStrictEqual({
                date: { year: 2026, month: 11, day: 2 },
                dayChanged: false,
                monthChanged: true,
                yearChanged: false,
                emitDaySignal: false,
            });
        });
    });

    await describe('the mark vectors', async () => {
        for (const vector of CALENDAR_MARK_VECTORS) {
            await it(vector.rule, () => {
                const marked = calendarMarkDay(vector.marked, vector.day, vector.mark);
                expect([...marked]).toStrictEqual([...vector.expected]);
                // Identity IS the "nothing changed" signal, which is what lets the element
                // skip the DOM write.
                expect(marked === vector.marked).toBe(!vector.changed);
            });
        }

        await it('answers get_day_is_marked, and never for an out-of-range day', () => {
            const marked = calendarMarkDay(calendarClearMarks(), 14, true);
            expect(calendarDayIsMarked(marked, 14)).toBe(true);
            expect(calendarDayIsMarked(marked, 13)).toBe(false);
            expect(calendarDayIsMarked(marked, 0)).toBe(false);
            expect(calendarDayIsMarked(marked, CALENDAR_MARK_MAX + 1)).toBe(false);
        });

        await it('clears every slot, and the table is 31 long', () => {
            const marked = calendarMarkDay(calendarMarkDay(calendarClearMarks(), 1, true), CALENDAR_MARK_MAX, true);
            expect(calendarClearMarks()).toHaveLength(31);
            expect([...calendarClearMarks()].every((day) => day === false)).toBe(true);
            expect(calendarDayIsMarked(marked, 1)).toBe(true);
        });
    });

    await describe('the navigation vectors, through calendarNavigationButtons', async () => {
        for (const vector of CALENDAR_NAVIGATION_VECTORS) {
            await it(vector.rule, () => {
                expect(calendarNavigationButtons(vector.date)).toStrictEqual(vector.expected);
            });
        }
    });

    await describe('calendarWeekStart', async () => {
        await it("is the C's own (week_1stday + first_weekday - 1) % 7", () => {
            // glibc reports `_NL_TIME_FIRST_WEEKDAY` 0 (Sunday) and `_NL_TIME_WEEK_1STDAY` 1
            // (Monday) for a C locale, which is 0 — and the C's own arithmetic on a machine
            // configured for Monday-first yields 0 too.
            expect(calendarWeekStart(0, 0)).toBe(0);
            expect(calendarWeekStart(0, 1)).toBe(0);
            expect(calendarWeekStart(1, 1)).toBe(1);
            expect(calendarWeekStart(6, 1)).toBe(6);
        });

        await it("answers 0 for a value outside the C's own 0-6 range", () => {
            expect(calendarWeekStart(-1, 0)).toBe(0);
            expect(calendarWeekStart(3, 3)).toBe(5);
            expect(calendarWeekStart(0, -5)).toBe(0);
        });
    });
};
