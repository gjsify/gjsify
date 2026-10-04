import { describe, expect, it } from '@gjsify/unit';

import { GRID_NAVIGATION_GEOMETRY, GRID_NAVIGATION_VECTORS } from './conformance/grid-navigation.js';
import { gridColumns, gridNavigate } from './grid-navigation.js';

export default async () => {
    await describe('gridColumns', async () => {
        await it('counts the items sharing the first row', async () => {
            expect(gridColumns([0, 0, 0, 120, 120])).toBe(3);
        });
        await it('absorbs sub-pixel rounding', async () => {
            expect(gridColumns([0, 0.4, 0.8, 100])).toBe(3);
        });
        await it('is 1 for a single column and 0 for an empty grid', async () => {
            expect(gridColumns([0, 100, 200])).toBe(1);
            expect(gridColumns([])).toBe(0);
        });
        await it('is the item count when everything fits on one row', async () => {
            expect(gridColumns([5, 5, 5])).toBe(3);
        });
    });

    await describe('gridNavigate', async () => {
        await it('matches every shared conformance row', async () => {
            const { count, columns } = GRID_NAVIGATION_GEOMETRY;
            for (const { key, from, to } of GRID_NAVIGATION_VECTORS) {
                expect(`${key}@${from}=${gridNavigate(key, from, count, columns)}`).toBe(`${key}@${from}=${to}`);
            }
        });
        // 3 columns, 7 items:  0 1 2 / 3 4 5 / 6
        await it('steps one item left and right', async () => {
            expect(gridNavigate('ArrowRight', 1, 7, 3)).toBe(2);
            expect(gridNavigate('ArrowLeft', 1, 7, 3)).toBe(0);
        });
        await it('steps one row up and down', async () => {
            expect(gridNavigate('ArrowDown', 1, 7, 3)).toBe(4);
            expect(gridNavigate('ArrowUp', 4, 7, 3)).toBe(1);
        });
        await it('does not wrap at the row ends', async () => {
            // Left/Right are linear in index (reading order), as in GtkGridView, so
            // Right at the end of a row lands on the next row's first item.
            expect(gridNavigate('ArrowRight', 2, 7, 3)).toBe(3);
            expect(gridNavigate('ArrowLeft', 0, 7, 3)).toBe(null);
            expect(gridNavigate('ArrowRight', 6, 7, 3)).toBe(null);
        });
        await it('stays put where no item lies above or below', async () => {
            expect(gridNavigate('ArrowUp', 2, 7, 3)).toBe(null);
            expect(gridNavigate('ArrowDown', 4, 7, 3)).toBe(null);
            expect(gridNavigate('ArrowDown', 6, 7, 3)).toBe(null);
        });
        await it('jumps to the ends', async () => {
            expect(gridNavigate('Home', 5, 7, 3)).toBe(0);
            expect(gridNavigate('End', 1, 7, 3)).toBe(6);
            expect(gridNavigate('Home', 0, 7, 3)).toBe(null);
        });
        await it('treats a zero column count as one column', async () => {
            expect(gridNavigate('ArrowDown', 0, 3, 0)).toBe(1);
        });
        await it('ignores other keys and bad indices', async () => {
            expect(gridNavigate('a', 0, 3, 3)).toBe(null);
            expect(gridNavigate('ArrowRight', -1, 3, 3)).toBe(null);
            expect(gridNavigate('ArrowRight', 0, 0, 3)).toBe(null);
        });
    });
};
