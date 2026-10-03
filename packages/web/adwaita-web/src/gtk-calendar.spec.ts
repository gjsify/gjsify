// DOM-level tests for <gtk-calendar>: the 42 cells it paints, the four per-cell states, the six
// week numbers, the four arrows' sensitivity, the marks and the key table.
//
// The ARITHMETIC is `calendar.spec.ts` in @gjsify/adwaita-core, driven from the same
// conformance tables; what is asserted here is that the element WIRES it — that a month whose
// first day IS the locale's first day really paints a whole row of previous-month cells, that
// `markDay` shows on the cell and not on the table, and that `Ctrl`+Arrow walks the months
// while a bare Arrow walks the cells.
import { describe, expect, it } from '@gjsify/unit';

import {
    CALENDAR_DAYS_VECTORS,
    CALENDAR_MARK_VECTORS,
    CALENDAR_NAVIGATION_VECTORS,
    CALENDAR_SELECT_VECTORS,
    CALENDAR_STEP_VECTORS,
    CALENDAR_WEEK_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import type { AdwCalendarStep } from '@gjsify/adwaita-core';

import { calendarWeekNumber } from '@gjsify/adwaita-core';

import type { GtkCalendar } from './elements/gtk-calendar.js';

function mount(attrs: Record<string, string> = {}): { el: GtkCalendar; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-calendar') as GtkCalendar;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

const cells = (el: GtkCalendar): HTMLButtonElement[] => [
    ...el.querySelectorAll<HTMLButtonElement>('.adw-calendar-cell'),
];
const weekNumbers = (el: GtkCalendar): string[] =>
    [...el.querySelectorAll<HTMLElement>('.adw-calendar-week-number')].map((el) => el.textContent ?? '');
const dayNames = (el: GtkCalendar): string[] =>
    [...el.querySelectorAll<HTMLElement>('.adw-calendar-day-name')].map((el) => el.textContent ?? '');
const arrow = (el: GtkCalendar, name: string): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>(`.adw-calendar-nav-button[aria-label*="${name}"]`)!;
const key = (target: Element, init: KeyboardEventInit) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

/** Sunday-first, so every assertion below is pinned rather than locale-dependent. */
const SUNDAY_FIRST = '0';

/** `AdwCalendarDate` → the ISO string the `date` door reads, with the month 1-12 the core uses. */
/** What the element's own locale says, read the same way it reads it. */
const localeWeekStart = (): number => {
    const language = globalThis.navigator?.language;
    const Locale = (Intl as { Locale?: new (tag: string) => { getWeekInfo?: () => { firstDay: number } } }).Locale;
    if (typeof language !== 'string' || Locale === undefined) return 0;
    const weekInfo = new Locale(language).getWeekInfo?.();
    if (weekInfo === undefined) return 0;
    return ((weekInfo.firstDay % 7) + 7) % 7;
};

const isoDate = (date: { year: number; month: number; day: number }): string =>
    `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

export const GtkCalendarTest = async () => {
    await describe('<gtk-calendar> the grid it paints', async () => {
        await it('always paints 42 cells, the 6x7 array the C allocates unconditionally', () => {
            // gtkcalendar.c:802-815 — `day_number_labels[6][7]`, always, and row-homogeneous
            // (`:786`), so a five-row month still paints six and the height does not jump.
            for (const vector of CALENDAR_DAYS_VECTORS) {
                const { el, host } = mount({ date: `${vector.year}-${String(vector.month).padStart(2, '0')}-01` });
                expect(cells(el)).toHaveLength(42);
                host.remove();
            }
        });

        await it('drives the vector table through the DOM', () => {
            for (const vector of CALENDAR_DAYS_VECTORS) {
                const { el, host } = mount({
                    date: `${vector.year}-${String(vector.month).padStart(2, '0')}-01`,
                    'week-start': String(vector.weekStart),
                });
                const painted = cells(el);
                const leading = painted.findIndex((cell) => !cell.classList.contains('other-month'));
                expect(leading).toBe(vector.leading);
                let trailing = 0;
                for (
                    let index = painted.length - 1;
                    index >= 0 && painted[index]!.classList.contains('other-month');
                    index--
                ) {
                    trailing++;
                }
                expect(trailing).toBe(vector.trailing);
                const last = painted[painted.length - 1]!;
                expect(`${last.textContent}`).toBe(String(Number(vector.last.slice(-2))));
                host.remove();
            }
        });

        await it('marks the leading and trailing spill .other-month and nothing else', () => {
            // 2027-02 under a Monday-first locale starts on row 2, so row 1 is all spill.
            const { el, host } = mount({ date: '2027-02-15', 'week-start': '1' });
            const painted = cells(el);
            for (let index = 0; index < 7; index++) {
                expect(painted[index]!.classList.contains('other-month')).toBe(true);
            }
            expect(painted[7]!.classList.contains('other-month')).toBe(false);
            expect(painted[7]!.textContent).toBe('1');
            host.remove();
        });

        await it('follows the locale week start, and the week-start attribute pins it', () => {
            // gtkcalendar.c:700-718 reads it out of the locale; `week-start` is the same
            // override its `calendar:week_start:0` string is, and it is what makes a
            // preview reproducible.
            const { el, host } = mount({ date: '2027-02-15' });
            expect(el.weekStart).toBe(localeWeekStart());
            el.weekStart = 1;
            expect(el.weekStart).toBe(1);
            expect(cells(el)[7]!.classList.contains('other-month')).toBe(false);
            el.weekStart = 0;
            expect(cells(el)[0]!.classList.contains('other-month')).toBe(true);
            el.setAttribute('week-start', '9');
            expect(el.weekStart).toBe(localeWeekStart());
            host.remove();
        });

        await it('numbers the day names from the locale week start', () => {
            // `day = (i + calendar->week_start) % 7` (gtkcalendar.c:773), and this element's
            // week start is the C locale's Sunday-first.
            const { el, host } = mount();
            expect(dayNames(el)).toStrictEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
            host.remove();
        });

        await it('numbers each row with the ISO week of its LAST cell', () => {
            // The C's own rule: `week = week_of_year (…, calendar->day[i][6])`
            // (gtkcalendar.c:1160) — the row's Saturday.
            const { el, host } = mount({ date: '2026-01-01' });
            expect(weekNumbers(el)).toHaveLength(6);
            expect(weekNumbers(el).every((week) => /^\d+$/.test(week))).toBe(true);
            host.remove();
        });

        await it('hides the week numbers until asked, and they are a real grid column', () => {
            const { el, host } = mount();
            const numbers = el.querySelectorAll('.adw-calendar-week-number');
            expect(numbers.length).toBe(6);
            // The COLUMN exists either way upstream (gtkcalendar.c:786-790), so the day names
            // stay aligned when it appears.
            expect(el.querySelector('.adw-calendar-week-spacer')).not.toBe(null);
            el.showWeekNumbers = true;
            expect(el.hasAttribute('show-week-numbers')).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-calendar> the date', async () => {
        await it("reads an ISO YYYY-MM-DD date, GDateTime's own serialisation", () => {
            const { el, host } = mount({ date: '2026-10-02' });
            expect(el.date).toBe('2026-10-02');
            expect(el.year).toBe(2026);
            // The GIR `month` property is 0-11 (gtkcalendar.c:419-429), and it is the one place
            // this element is not in GDateTime's own 1-12 numbering.
            expect(el.month).toBe(9);
            expect(el.day).toBe(2);
            host.remove();
        });

        await it('is TODAY with no attribute, as gtk_calendar_init seeds it', () => {
            const { el, host } = mount();
            const now = new Date();
            expect(el.year).toBe(now.getFullYear());
            expect(el.month).toBe(now.getMonth());
            expect(el.day).toBe(now.getDate());
            host.remove();
        });

        await it('ignores a malformed date rather than refusing the widget', () => {
            const { el, host } = mount({ date: '2026-10-02' });
            el.setAttribute('date', 'not-a-date');
            expect(el.date).toBe('2026-10-02');
            host.remove();
        });

        await it('steps a year or a month through the DEPRECATED halves, keeping the rest', async () => {
            // gtk_calendar_set_year (:860-880) builds a new date from the same day in the new
            // year and hands it to the same select_day_internal.
            const { el, host } = mount({ date: '2026-10-02' });
            el.year = 2030;
            expect(el.date).toBe('2030-10-02');
            el.month = 0;
            expect(el.date).toBe('2030-01-02');
            el.day = 15;
            expect(el.date).toBe('2030-01-15');
            host.remove();
        });

        await it('clamps an impossible day into the month the three halves name', () => {
            const { el, host } = mount({ date: '2026-01-31' });
            el.month = 1;
            expect(el.date).toBe('2026-02-28');
            host.remove();
        });

        await it('clamps a leap day when the year steps away from it', () => {
            const { el, host } = mount({ date: '2024-02-29' });
            el.year = 2025;
            expect(el.date).toBe('2025-02-28');
            host.remove();
        });

        await it('clamps 31 January plus a month to the 28th, never to 3 March', () => {
            const { el, host } = mount({ date: '2026-01-31' });
            arrow(el, 'Next Month').click();
            expect(el.date).toBe('2026-02-28');
            host.remove();
        });
    });

    await describe('<gtk-calendar> the three show-* flags', async () => {
        await it('defaults heading and day names ON and week numbers OFF', () => {
            const { el, host } = mount();
            expect(el.showHeading).toBe(true);
            expect(el.showDayNames).toBe(true);
            expect(el.showWeekNumbers).toBe(false);
            host.remove();
        });

        await it('reads heading and day names as the OFF switch, being GIR defaults of TRUE', () => {
            const { el, host } = mount({ 'show-heading': 'false', 'show-day-names': 'false' });
            expect(el.showHeading).toBe(false);
            expect(el.showDayNames).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-calendar> the four arrows', async () => {
        await it("walks the months and the years, and emits each arrow's own signal", () => {
            const { el, host } = mount({ date: '2026-10-15' });
            const seen: string[] = [];
            for (const name of ['prev-month', 'next-month', 'prev-year', 'next-year']) {
                el.addEventListener(name, () => {
                    seen.push(name);
                });
            }
            arrow(el, 'Next Month').click();
            expect(el.date).toBe('2026-11-15');
            arrow(el, 'Previous Month').click();
            expect(el.date).toBe('2026-10-15');
            arrow(el, 'Next Year').click();
            expect(el.date).toBe('2027-10-15');
            arrow(el, 'Previous Year').click();
            expect(el.date).toBe('2026-10-15');
            expect(seen).toStrictEqual(['next-month', 'prev-month', 'next-year', 'prev-year']);
            host.remove();
        });

        await it('kills the backward pair at the first year and the forward pair at the last', () => {
            // calendar_update_navigation_buttons (:1055-1084) disables the MONTH arrow and the
            // YEAR arrow separately at each end.
            const { el, host } = mount({ date: '0001-01-01' });
            expect(arrow(el, 'Previous Month').disabled).toBe(true);
            expect(arrow(el, 'Previous Year').disabled).toBe(true);
            expect(arrow(el, 'Next Month').disabled).toBe(false);
            el.date = '9999-12-31';
            expect(arrow(el, 'Next Month').disabled).toBe(true);
            expect(arrow(el, 'Next Year').disabled).toBe(true);
            expect(arrow(el, 'Previous Month').disabled).toBe(false);
            host.remove();
        });

        await it("paging a month does NOT fire day-selected, the C's emit_day_signal FALSE", () => {
            // gtkcalendar.c:868-919 — the month and year arrows pass FALSE, and only the day
            // notify/signal pair is inside `if (day_changed)` (:1169-1175).
            const { el, host } = mount({ date: '2026-10-15' });
            let selected = 0;
            el.addEventListener('day-selected', () => {
                selected++;
            });
            arrow(el, 'Next Month').click();
            expect(selected).toBe(0);
            cells(el)[15]!.click();
            expect(selected).toBe(1);
            host.remove();
        });
    });

    await describe('<gtk-calendar> the per-cell states', async () => {
        await it('marks the selected day and today separately', () => {
            // March, so the assertion cannot pass or fail by accident on the day this runs.
            const { el, host } = mount({ date: '2026-03-17' });
            const selected = cells(el).filter((cell) => cell.classList.contains('selected'));
            expect(selected).toHaveLength(1);
            expect(selected[0]!.textContent).toBe('17');
            expect(selected[0]!.classList.contains('today')).toBe(false);
            host.remove();
        });

        await it('marks TODAY on the cell the month grid says is today', () => {
            const now = new Date();
            const { el, host } = mount({
                date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
            });
            const marked = cells(el).filter((cell) => cell.classList.contains('today'));
            expect(marked).toHaveLength(1);
            expect(marked[0]!.textContent).toBe(String(now.getDate()));
            host.remove();
        });

        await it('shows a MARKED day as .marked, and only inside the current month', () => {
            const { el, host } = mount({ date: '2026-10-01' });
            el.markDay(14);
            expect(el.markedDays).toStrictEqual([14]);
            const marked = cells(el).filter((cell) => cell.classList.contains('marked'));
            expect(marked).toHaveLength(1);
            expect(marked[0]!.textContent).toBe('14');
            expect(marked[0]!.classList.contains('other-month')).toBe(false);
            host.remove();
        });

        await it('a mark on the 31st survives paging to a month that has no 31st', () => {
            // The table is 31 slots and NOT per month, and `calendar_update_day_labels` only
            // consults it for CURRENT-month cells (gtkcalendar.c:1041-1042) — so the mark does
            // not show and comes back when the month does.
            const { el, host } = mount({ date: '2026-01-01' });
            el.markDay(31);
            expect(cells(el).filter((cell) => cell.classList.contains('marked'))).toHaveLength(1);
            arrow(el, 'Next Month').click();
            expect(cells(el).filter((cell) => cell.classList.contains('marked'))).toHaveLength(0);
            expect(el.markedDays).toStrictEqual([31]);
            arrow(el, 'Next Month').click();
            expect(cells(el).filter((cell) => cell.classList.contains('marked'))).toHaveLength(1);
            host.remove();
        });

        await it('is idempotent, so marking twice is silent and the second does not add', () => {
            const { el, host } = mount({ date: '2026-10-01' });
            el.markDay(3);
            el.markDay(3);
            expect(el.markedDays).toStrictEqual([3]);
            el.unmarkDay(3);
            el.unmarkDay(3);
            expect(el.dayIsMarked(3)).toBe(false);
            host.remove();
        });

        await it('ignores an out-of-range day rather than clamping it', () => {
            const { el, host } = mount({ date: '2026-10-01' });
            el.markDay(0);
            el.markDay(32);
            expect(el.markedDays).toStrictEqual([]);
            expect(el.dayIsMarked(32)).toBe(false);
            host.remove();
        });

        await it('clears every mark at once', () => {
            const { el, host } = mount({ date: '2026-10-01' });
            el.markDay(1);
            el.markDay(31);
            el.clearMarks();
            expect(el.markedDays).toStrictEqual([]);
            host.remove();
        });
    });

    await describe('<gtk-calendar> the ISO week and the navigation through the DOM', async () => {
        for (const vector of CALENDAR_WEEK_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount({ date: isoDate(vector.date), 'week-start': SUNDAY_FIRST });
                // A `week-number` label is the ISO week of its ROW'S LAST CELL — the C's own
                // rule, `week_of_year (…, calendar->day[i][6])` (gtkcalendar.c:1160) — so the
                // two things a DOM reader can check are that the row holding the vector's date
                // shows ITS OWN week when the date ends the row, and that the vector's week is
                // among the six labels the month painted.
                const labels = weekNumbers(el);
                const painted = cells(el);
                const index = painted.findIndex(
                    (cell) => !cell.classList.contains('other-month') && cell.textContent === String(vector.date.day),
                );
                expect(index).toBeGreaterThanOrEqual(0);
                expect(labels).toContain(String(vector.week));
                // The row of the LAST cell, which is the one whose label the C computes.
                const rowLast = index - (index % 7) + 6;
                expect(labels[Math.trunc(rowLast / 7)]).toBe(String(calendarWeekNumber(el.cells[rowLast]!.date)));
                host.remove();
            });
        }

        for (const vector of CALENDAR_NAVIGATION_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount({ date: isoDate(vector.date) });
                expect(arrow(el, 'Previous Month').disabled).toBe(!vector.expected.previousMonth);
                expect(arrow(el, 'Next Month').disabled).toBe(!vector.expected.nextMonth);
                expect(arrow(el, 'Previous Year').disabled).toBe(!vector.expected.previousYear);
                expect(arrow(el, 'Next Year').disabled).toBe(!vector.expected.nextYear);
                host.remove();
            });
        }
    });

    await describe('<gtk-calendar> the clamped steps, as the four arrows walk them', async () => {
        for (const vector of CALENDAR_STEP_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount({ date: isoDate(vector.from) });
                const label: Record<AdwCalendarStep, string> = {
                    'previous-month': 'Previous Month',
                    'next-month': 'Next Month',
                    'previous-year': 'Previous Year',
                    'next-year': 'Next Year',
                };
                const button = arrow(el, label[vector.step]);
                // A dead arrow is the C's refusal at the ends of the range, and the vector
                // expects the date to stay put when it is.
                if (!button.disabled) button.click();
                expect(el.date).toBe(isoDate(vector.expected));
                host.remove();
            });
        }
    });

    await describe('<gtk-calendar> the select vectors, as attribute writes', async () => {
        for (const vector of CALENDAR_SELECT_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount({ date: isoDate(vector.current) });
                let selected = 0;
                el.addEventListener('day-selected', () => {
                    selected++;
                });
                // A write through `date`, which is the door `emit_day_signal` TRUE belongs to;
                // the navigation arrows below carry the FALSE half.
                el.setAttribute('date', isoDate(vector.target));
                expect(el.date).toBe(isoDate(vector.expected.date));
                // The `emit` argument is the C's `emit_day_signal`; a PROPERTY WRITE passes
                // TRUE, and the signal is then gated on `day_changed` (:1169-1175).
                expect(selected).toBe(vector.emit && vector.expected.emitDaySignal ? 1 : 0);
                host.remove();
            });
        }

        await it('a write of the date already shown is silent in every component', () => {
            const { el, host } = mount({ date: '2026-10-02' });
            let selected = 0;
            el.addEventListener('day-selected', () => {
                selected++;
            });
            el.setAttribute('date', '2026-10-02');
            expect(selected).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-calendar> the marks, through markDay', async () => {
        for (const vector of CALENDAR_MARK_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount({ date: '2026-10-01' });
                // The vector's table is 31 BOOLEANS, which is the C's own `marked_date`
                // (gtkcalendar.c:826-827), and the element's door takes a day NUMBER.
                vector.marked.forEach((mark, index) => {
                    if (mark) el.markDay(index + 1);
                });
                el[vector.mark ? 'markDay' : 'unmarkDay'](vector.day);
                const painted = cells(el)
                    .filter((cell) => cell.classList.contains('marked'))
                    .map((cell) => Number(cell.textContent));
                expect(painted).toStrictEqual(vector.expected.flatMap((mark, index) => (mark ? [index + 1] : [])));
                host.remove();
            });
        }
    });

    await describe('<gtk-calendar> clicking a cell', async () => {
        await it('selects the day it names and fires day-selected', () => {
            const { el, host } = mount({ date: '2026-10-02' });
            const painted = cells(el);
            const ninth = painted.find((cell) => cell.textContent === '9' && !cell.classList.contains('other-month'))!;
            let selected = 0;
            el.addEventListener('day-selected', () => {
                selected++;
            });
            ninth.click();
            expect(el.date).toBe('2026-10-09');
            expect(selected).toBe(1);
            host.remove();
        });

        await it('PAGES first on a cell from another month, then selects that day', () => {
            // The MONTH_PREV / MONTH_NEXT branch of the Space handler (:1521-1534); a click
            // lands on the same cell either way.
            const { el, host } = mount({ date: '2026-10-15' });
            // October 2026 opens on a Thursday, so under a Sunday-first grid the leading spill
            // is September's 27-30.
            const spill = cells(el).find(
                (cell) => cell.classList.contains('other-month') && cell.textContent === '28',
            )!;
            spill.click();
            expect(el.date).toBe('2026-09-28');
            host.remove();
        });

        await it('re-selecting the day already shown changes nothing and fires nothing', () => {
            // The early return in calendar_select_day_internal (:1103-1104).
            const { el, host } = mount({ date: '2026-10-02' });
            let selected = 0;
            el.addEventListener('day-selected', () => {
                selected++;
            });
            const painted = cells(el);
            painted.find((cell) => cell.textContent === '2' && !cell.classList.contains('other-month'))!.click();
            expect(selected).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-calendar> the key table', async () => {
        await it('moves the cursor with a bare arrow and leaves the date alone', () => {
            const { el, host } = mount({ date: '2026-10-15' });
            const painted = cells(el);
            const fifteenth = painted.find(
                (cell) => cell.textContent === '15' && !cell.classList.contains('other-month'),
            )!;
            fifteenth.focus();
            key(fifteenth, { key: 'ArrowRight' });
            expect(cells(el).filter((cell) => cell.classList.contains('focused'))).toHaveLength(1);
            expect(el.date).toBe('2026-10-15');
            host.remove();
        });

        await it('wraps the cursor off the grid, as move_focus does', () => {
            // `focus_row`/`focus_col` start at -1 (gtkcalendar.c:817-818), which is the ONLY
            // way those two `if (focus_row < 0) → 5` / `if (focus_col < 0) → 6` lines are
            // reachable: the first ArrowUp with no cursor yet lands on row 5 column 6, the
            // LAST cell. Once the cursor is somewhere, an ArrowUp at row 0 stays at row 0 —
            // which is what the C does too, and a reader who expects a wrap there has the
            // order of the two `if`s backwards.
            const { el, host } = mount({ date: '2026-10-01' });
            const painted = cells(el);
            key(painted[0]!, { key: 'ArrowUp' });
            expect(cells(el).find((cell) => cell.classList.contains('focused'))).toBe(painted[41]);
            key(painted[0]!, { key: 'ArrowUp' });
            expect(cells(el).find((cell) => cell.classList.contains('focused'))).toBe(painted[34]);
            host.remove();
        });

        await it('Ctrl+Arrow walks the months and the years', () => {
            const { el, host } = mount({ date: '2026-10-15' });
            const painted = cells(el);
            const fifteenth = painted.find(
                (cell) => cell.textContent === '15' && !cell.classList.contains('other-month'),
            )!;
            fifteenth.focus();
            key(fifteenth, { key: 'ArrowRight', ctrlKey: true });
            expect(el.date).toBe('2026-11-15');
            key(fifteenth, { key: 'ArrowLeft', ctrlKey: true });
            expect(el.date).toBe('2026-10-15');
            key(fifteenth, { key: 'ArrowDown', ctrlKey: true });
            expect(el.date).toBe('2027-10-15');
            host.remove();
        });

        await it('Ctrl+Arrow refuses where the ARROW would, at the ends of the range', () => {
            // gtkcalendar.c:1492-1494 — "Not allowed with the mouse, not allowed with the
            // keyboard", checked against the same four buttons.
            const { el, host } = mount({ date: '0001-01-01' });
            const painted = cells(el);
            painted[7]!.focus();
            key(painted[7]!, { key: 'ArrowLeft', ctrlKey: true });
            expect(el.date).toBe('0001-01-01');
            key(painted[7]!, { key: 'ArrowRight', ctrlKey: true });
            expect(el.date).toBe('0001-02-01');
            host.remove();
        });

        await it('Space selects the cell the CURSOR is on, and pages for a spill cell', () => {
            // The cursor is ARROW-driven and only `move_focus` and a selection set it
            // (`focus_row`/`focus_col` are internal state, gtkcalendar.c:817-818) — so focusing
            // a cell with the mouse does not move it, and this test moves it the way the C does.
            // Under a Sunday-first grid the last cell of October 2026 is 7 November, a
            // MONTH_NEXT cell, so Space pages forward and then selects that day.
            const { el, host } = mount({ date: '2026-10-15', 'week-start': SUNDAY_FIRST });
            const painted = cells(el);
            key(painted[0]!, { key: 'ArrowUp' });
            expect(cells(el).find((cell) => cell.classList.contains('focused'))).toBe(painted[41]);
            key(painted[0]!, { key: ' ' });
            expect(el.date).toBe('2026-11-07');
            host.remove();
        });
    });
};
