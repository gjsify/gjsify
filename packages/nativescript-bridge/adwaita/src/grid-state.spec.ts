// `Gtk.Grid` — the pure half: how many tracks the children need, the gap each owes, the spacing
// range, and which child covers a cell.

import { describe, expect, it } from '@gjsify/unit';

import { gridChildAt, gridGap, gridSpacing, gridTrackCounts } from './widgets/grid-state.js';

const at = (column: number, row: number, columnSpan = 1, rowSpan = 1) => ({ column, row, columnSpan, rowSpan });

export default async () => {
    await describe('gridTrackCounts', async () => {
        await it('is one past the furthest edge any child reaches', () => {
            expect(gridTrackCounts([at(0, 0), at(2, 1)])).toStrictEqual({ columns: 3, rows: 2 });
        });

        await it('counts a span: a child at column 1 spanning 3 reaches column 4', () => {
            expect(gridTrackCounts([at(1, 0, 3, 2)])).toStrictEqual({ columns: 4, rows: 2 });
        });

        await it('is zero for an empty grid', () => {
            expect(gridTrackCounts([])).toStrictEqual({ columns: 0, rows: 0 });
        });

        await it('keeps the empty tracks between children, as an index past them demands', () => {
            expect(gridTrackCounts([at(0, 0), at(5, 0)]).columns).toBe(6);
        });
    });

    await describe('gridGap', async () => {
        await it('gives the first column and the first row no gap', () => {
            expect(gridGap({ column: 0, row: 0 }, 4, 8)).toStrictEqual({ left: 0, top: 0 });
        });

        await it('puts the column gap on the left and the row gap on the top of later cells', () => {
            expect(gridGap({ column: 2, row: 0 }, 4, 8)).toStrictEqual({ left: 4, top: 0 });
            expect(gridGap({ column: 0, row: 3 }, 4, 8)).toStrictEqual({ left: 0, top: 8 });
            expect(gridGap({ column: 1, row: 1 }, 4, 8)).toStrictEqual({ left: 4, top: 8 });
        });
    });

    await describe('gridSpacing', async () => {
        await it('takes an integer in 0 … 65535', () => {
            expect(gridSpacing(2, 2, 0, 'rowSpacing')).toBe(2);
            expect(gridSpacing(12, '12', 0, 'rowSpacing')).toBe(12);
            expect(gridSpacing(65535, 65535, 0, 'rowSpacing')).toBe(65535);
        });

        await it('keeps the current value for a blank attribute', () => {
            expect(gridSpacing(Number.NaN, '', 7, 'columnSpacing')).toBe(7);
        });

        await it('refuses what the guint16 pspec would, naming the property', () => {
            expect(() => gridSpacing(-1, -1, 0, 'rowSpacing')).toThrow("is not a spacing: 'rowSpacing'");
            expect(() => gridSpacing(65536, 65536, 0, 'rowSpacing')).toThrow('is not a spacing');
            expect(() => gridSpacing(1.5, 1.5, 0, 'columnSpacing')).toThrow('is not a spacing');
            expect(() => gridSpacing(Number.NaN, 'wide', 0, 'columnSpacing')).toThrow("'wide' is not a spacing");
        });
    });

    await describe('gridChildAt', async () => {
        const children = [
            { child: 'a', placement: at(0, 0) },
            { child: 'b', placement: at(1, 0, 2, 1) },
        ];

        await it('finds the child whose cell it is, including a spanned one', () => {
            expect(gridChildAt(children, 0, 0)).toBe('a');
            expect(gridChildAt(children, 1, 0)).toBe('b');
            expect(gridChildAt(children, 2, 0)).toBe('b');
        });

        await it('is null for an empty cell', () => {
            expect(gridChildAt(children, 0, 1)).toBe(null);
            expect(gridChildAt(children, 3, 0)).toBe(null);
        });
    });
};
