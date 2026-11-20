import { describe, expect, it } from '@gjsify/unit';
import {
    isBarItem,
    isoWeek,
    layoutMonthBars,
    layoutTimeGrid,
    layoutWeekBars,
    monthGrid,
    weekdayOf,
    type CalendarItem,
    type Weekday,
} from './index.js';

const day = (id: string, y: number, m: number, d: number, endD = d + 1): CalendarItem<string> => ({
    id,
    start: { year: y, month: m, day: d },
    end: { year: y, month: m, day: endD },
    allDay: true,
    payload: id,
});

const timed = (
    id: string,
    d: number,
    h1: number,
    m1: number,
    d2: number,
    h2: number,
    m2: number,
    month = 1,
): CalendarItem<string> => ({
    id,
    start: { year: 2024, month, day: d, hour: h1, minute: m1 },
    end: { year: 2024, month, day: d2, hour: h2, minute: m2 },
    allDay: false,
    payload: id,
});

export default async () => {
    await describe('calendar-layout month grid', async () => {
        await it('starts rows on any weekday for months starting on each weekday', async () => {
            // 2024: Sep 1 Sun, Jan 1 Mon, Oct 1 Tue, May 1 Wed, Feb 1 Thu, Mar 1 Fri, Jun 1 Sat
            const firsts: [number, number][] = [
                [9, 0],
                [1, 1],
                [10, 2],
                [5, 3],
                [2, 4],
                [3, 5],
                [6, 6],
            ];
            for (const [month, wd] of firsts) {
                expect(weekdayOf({ year: 2024, month, day: 1 })).toBe(wd);
                for (const fw of [0, 1, 6] as Weekday[]) {
                    const grid = monthGrid({ year: 2024, month, firstWeekday: fw });
                    expect(grid.weeks[0]!.days[0]!.weekday).toBe(fw);
                    for (const w of grid.weeks) expect(w.days.length).toBe(7);
                    const lead = (wd - fw + 7) % 7;
                    const firstIn = grid.weeks[0]!.days.findIndex((d) => d.inMonth);
                    expect(firstIn).toBe(lead);
                }
            }
        });

        await it('handles February in leap and non-leap years', async () => {
            const count = (y: number) =>
                monthGrid({ year: y, month: 2, firstWeekday: 1 })
                    .weeks.flatMap((w) => w.days)
                    .filter((d) => d.inMonth).length;
            expect(count(2024)).toBe(29);
            expect(count(2023)).toBe(28);
            expect(count(1900)).toBe(28);
            expect(count(2000)).toBe(29);
            // Feb 2021 starts on Monday and has 28 days: exactly four rows.
            expect(monthGrid({ year: 2021, month: 2, firstWeekday: 1 }).weeks.length).toBe(4);
            expect(monthGrid({ year: 2021, month: 2, firstWeekday: 1, sixRows: true }).weeks.length).toBe(6);
        });

        await it('numbers ISO weeks, including week 53 and year turns', async () => {
            const grid = monthGrid({ year: 2020, month: 12, firstWeekday: 1 });
            const last = grid.weeks[grid.weeks.length - 1]!;
            expect(last.isoWeek).toBe(53);
            expect(last.isoWeekYear).toBe(2020);
            expect(last.days[6]!.date.year).toBe(2021);
            expect(last.days[6]!.inMonth).toBe(false);
            expect(isoWeek({ year: 2021, month: 1, day: 4 }).week).toBe(1);
            expect(isoWeek({ year: 2024, month: 12, day: 30 }).week).toBe(1);
            expect(isoWeek({ year: 2024, month: 12, day: 30 }).year).toBe(2025);
            // Sunday-first rows still take the week number from their Thursday.
            const sun = monthGrid({ year: 2024, month: 1, firstWeekday: 0 });
            // Row Sun Dec 31 .. Sat Jan 6 has its Thursday on Jan 4: week 1 of 2024.
            expect(sun.weeks[0]!.days[0]!.date.month).toBe(12);
            expect(sun.weeks[0]!.isoWeek).toBe(1);
            expect(sun.weeks[0]!.isoWeekYear).toBe(2024);
        });
    });

    await describe('calendar-layout bars', async () => {
        await it('orders longer first, then start, then id, and fills the lowest free row', async () => {
            const week = { year: 2024, month: 1, day: 1 };
            const r = layoutWeekBars(
                [day('c', 2024, 1, 2, 3), day('b', 2024, 1, 1, 3), day('a', 2024, 1, 1, 3), day('long', 2024, 1, 3, 8)],
                week,
            );
            const byId = (id: string) => r.segments.find((s) => s.id === id)!;
            expect(byId('long').row).toBe(0);
            expect(byId('long').column).toBe(2);
            expect(byId('long').span).toBe(5);
            expect(byId('a').row).toBe(0);
            expect(byId('b').row).toBe(1);
            // c sits on day 2, which a (row 0) and b (row 1) both cover.
            expect(byId('c').row).toBe(2);
            expect(byId('c').column).toBe(1);
            expect(r.rows).toBe(3);
        });

        await it('splits an item across three weeks with continue flags', async () => {
            const grid = monthGrid({ year: 2024, month: 1, firstWeekday: 1 });
            const weeks = layoutMonthBars(grid, [day('x', 2024, 1, 5, 18)]);
            const segs = weeks.map((w) => w.segments[0]);
            expect(segs[0]!.column).toBe(4);
            expect(segs[0]!.span).toBe(3);
            expect(segs[0]!.continuesLeft).toBe(false);
            expect(segs[0]!.continuesRight).toBe(true);
            expect(segs[1]!.column).toBe(0);
            expect(segs[1]!.span).toBe(7);
            expect(segs[1]!.continuesLeft).toBe(true);
            expect(segs[1]!.continuesRight).toBe(true);
            expect(segs[2]!.span).toBe(3);
            expect(segs[2]!.continuesLeft).toBe(true);
            expect(segs[2]!.continuesRight).toBe(false);
            expect(weeks[3]!.segments.length).toBe(0);
        });

        await it('splits across two weeks over a month boundary', async () => {
            const grid = monthGrid({ year: 2024, month: 2, firstWeekday: 1 });
            const item = { ...day('y', 2024, 1, 31), end: { year: 2024, month: 2, day: 5 } };
            const weeks = layoutMonthBars(grid, [item]);
            // Jan 31 .. Feb 4; Feb grid starts Mon Jan 29.
            expect(weeks[0]!.segments[0]!.column).toBe(2);
            expect(weeks[0]!.segments[0]!.span).toBe(5);
            expect(weeks[0]!.segments[0]!.continuesRight).toBe(false);
        });

        await it('counts overflow per day beyond maxRows', async () => {
            const week = { year: 2024, month: 1, day: 1 };
            const items = ['a', 'b', 'c', 'd'].map((id) => day(id, 2024, 1, 3));
            const r = layoutWeekBars(items, week, { maxRows: 2 });
            expect(r.segments.length).toBe(2);
            expect(r.overflow[2]).toBe(2);
            expect(r.overflow[1]).toBe(0);
            expect(r.rows).toBe(2);
            expect(r.segments.map((s) => s.id).join()).toBe('a,b');
        });

        await it('counts a hidden multi-day bar on every day it covers', async () => {
            const week = { year: 2024, month: 1, day: 1 };
            const r = layoutWeekBars([day('a', 2024, 1, 1, 8), day('b', 2024, 1, 2, 5)], week, { maxRows: 1 });
            expect(r.segments.length).toBe(1);
            expect(r.overflow.join()).toBe('0,1,1,1,0,0,0');
        });

        await it('treats an all-day item without positive length as one day and routes midnight crossers to bars', async () => {
            const week = { year: 2024, month: 1, day: 1 };
            const zero = day('z', 2024, 1, 4, 4);
            expect(layoutWeekBars([zero], week).segments[0]!.span).toBe(1);
            expect(isBarItem(timed('t', 1, 22, 0, 2, 2, 0))).toBe(true);
            expect(isBarItem(timed('t', 1, 9, 0, 1, 10, 0))).toBe(false);
            // Ends exactly at midnight: still one day.
            expect(isBarItem(timed('t', 1, 22, 0, 2, 0, 0))).toBe(false);
        });
    });

    await describe('calendar-layout time grid', async () => {
        const first = { year: 2024, month: 1, day: 1 };

        await it('chains overlaps into one cluster with stable columns', async () => {
            const items = [
                timed('c', 1, 11, 0, 1, 13, 0),
                timed('a', 1, 9, 0, 1, 11, 0),
                timed('b', 1, 10, 0, 1, 12, 0),
            ];
            const [d] = layoutTimeGrid(items, { firstDay: first, days: 1 });
            const p = (id: string) => d!.placements.find((x) => x.id === id)!;
            expect(p('a').column).toBe(0);
            expect(p('b').column).toBe(1);
            expect(p('c').column).toBe(0);
            for (const id of ['a', 'b', 'c']) expect(p(id).columns).toBe(2);
        });

        await it('starts a new cluster when items only touch', async () => {
            const items = [timed('a', 1, 9, 0, 1, 10, 0), timed('b', 1, 10, 0, 1, 11, 0)];
            const [d] = layoutTimeGrid(items, { firstDay: first, days: 1 });
            expect(d!.placements.map((p) => p.columns).join()).toBe('1,1');
            expect(d!.placements.map((p) => p.column).join()).toBe('0,0');
        });

        await it('breaks ties by longer first, then id', async () => {
            const items = [timed('b', 1, 9, 0, 1, 10, 0), timed('a', 1, 9, 0, 1, 10, 0), timed('z', 1, 9, 0, 1, 11, 0)];
            const [d] = layoutTimeGrid(items, { firstDay: first, days: 1 });
            expect(d!.placements.map((p) => p.id).join()).toBe('z,a,b');
            expect(d!.placements.map((p) => p.column).join()).toBe('0,1,2');
        });

        await it('gives a zero-length item the minimum height', async () => {
            const [d] = layoutTimeGrid([timed('z', 1, 10, 0, 1, 10, 0)], { firstDay: first, days: 1 });
            expect(d!.placements[0]!.start).toBe(600);
            expect(d!.placements[0]!.end).toBe(615);
            const [e] = layoutTimeGrid([timed('z', 1, 10, 0, 1, 10, 0)], {
                firstDay: first,
                days: 1,
                minMinutes: 30,
            });
            expect(e!.placements[0]!.end).toBe(630);
        });

        await it('splits an item that crosses midnight', async () => {
            const days = layoutTimeGrid([timed('n', 1, 22, 0, 2, 2, 0)], { firstDay: first, days: 3 });
            expect(days[0]!.placements.length).toBe(1);
            expect(days[0]!.placements[0]!.start).toBe(1320);
            expect(days[0]!.placements[0]!.end).toBe(1440);
            expect(days[0]!.placements[0]!.continuesAfter).toBe(true);
            expect(days[1]!.placements[0]!.start).toBe(0);
            expect(days[1]!.placements[0]!.end).toBe(120);
            expect(days[1]!.placements[0]!.continuesBefore).toBe(true);
            expect(days[1]!.placements[0]!.continuesAfter).toBe(false);
            expect(days[2]!.placements.length).toBe(0);
        });

        await it('does not spill an item ending exactly at midnight into the next day', async () => {
            const days = layoutTimeGrid([timed('n', 1, 22, 0, 2, 0, 0)], { firstDay: first, days: 2 });
            expect(days[0]!.placements.length).toBe(1);
            expect(days[0]!.placements[0]!.continuesAfter).toBe(false);
            expect(days[1]!.placements.length).toBe(0);
        });

        await it('clips to the visible hours and drops items outside', async () => {
            const items = [
                timed('in', 1, 7, 0, 1, 9, 0),
                timed('out', 1, 19, 0, 1, 20, 0),
                timed('over', 1, 17, 0, 1, 19, 0),
            ];
            const [d] = layoutTimeGrid(items, { firstDay: first, days: 1, startHour: 8, endHour: 18 });
            expect(d!.placements.map((p) => p.id).join()).toBe('in,over');
            expect(d!.placements[0]!.start).toBe(480);
            expect(d!.placements[0]!.end).toBe(540);
            expect(d!.placements[1]!.end).toBe(1080);
        });

        await it('ignores all-day items and rejects invalid hours', async () => {
            const [d] = layoutTimeGrid([day('a', 2024, 1, 1)], { firstDay: first, days: 1 });
            expect(d!.placements.length).toBe(0);
            let threw = false;
            try {
                layoutTimeGrid([], { firstDay: first, days: 1, startHour: 10, endHour: 10 });
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
        });

        await it('uses wall-clock minutes on a day with a clock change', async () => {
            // 2024-03-31 is a spring-forward day in much of Europe; the layout never looks at zones,
            // so a 02:30-03:30 wall-clock item is simply 150..210.
            const f = { year: 2024, month: 3, day: 31 };
            const [d] = layoutTimeGrid([timed('dst', 31, 2, 30, 31, 3, 30, 3)], { firstDay: f, days: 1 });
            expect(d!.placements[0]!.start).toBe(150);
            expect(d!.placements[0]!.end).toBe(210);
        });

        await it('walks across month and year boundaries', async () => {
            const days = layoutTimeGrid([], { firstDay: { year: 2024, month: 12, day: 30 }, days: 4 });
            expect(days.map((d) => `${d.date.year}-${d.date.month}-${d.date.day}`).join()).toBe(
                '2024-12-30,2024-12-31,2025-1-1,2025-1-2',
            );
        });
    });
};
