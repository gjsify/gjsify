// `Gtk.Grid`, built as the REAL class against the platform double: the track list that follows
// the children, child placement through the platform's own `row` / `column` names, the gap that
// rides on the margin without erasing it, and the shared-tree spelling.
//
// A layout PASS is not measurable here, so tracks are asserted as the `ItemSpec` list the grid
// hands the platform and placement as the four numbers each child carries.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Gtk from './namespace/gtk.js';
import { GridLayout, type ItemSpec, type View } from './testing/ns-core.mjs';

const label = (): View => new Gtk.Label() as unknown as View;

/** The track kinds the grid declared, e.g. `['auto', 'auto']`. */
function tracks(grid: object, axis: 'columns' | 'rows'): string[] {
    const specs = (grid as unknown as Record<string, ItemSpec[]>)[axis === 'columns' ? '_columns' : '_rows']!;
    return specs.map((spec) => spec.gridUnitType);
}

export const GtkGridNsTest = async () => {
    await describe('Gtk.Grid: placement and tracks', async () => {
        await it('attach() places a child and the grid grows the tracks to fit it', () => {
            const grid = new Gtk.Grid();
            const child = label();
            grid.attach(child as unknown as never, 2, 1, 1, 1);
            expect(GridLayout.placementOf(child)).toStrictEqual({ row: 1, column: 2, rowSpan: 1, columnSpan: 1 });
            expect(tracks(grid, 'columns')).toStrictEqual(['auto', 'auto', 'auto']);
            expect(tracks(grid, 'rows')).toStrictEqual(['auto', 'auto']);
        });

        await it('a span reaches further: width 2 at column 1 needs three columns', () => {
            const grid = new Gtk.Grid();
            grid.attach(label() as unknown as never, 1, 0, 2, 1);
            expect(tracks(grid, 'columns').length).toBe(3);
        });

        await it('the platform names place a child too — what a `.blp` layout block and an XML attribute write', () => {
            const grid = new Gtk.Grid();
            const child = label();
            child.row = 3;
            child.column = 1;
            child.columnSpan = 2;
            grid.addChild(child as unknown as never);
            expect(tracks(grid, 'columns').length).toBe(3);
            expect(tracks(grid, 'rows').length).toBe(4);
        });

        await it('moving a child after it was added re-derives the tracks', () => {
            const grid = new Gtk.Grid();
            const child = label();
            grid.attach(child as unknown as never, 0, 0);
            expect(tracks(grid, 'columns').length).toBe(1);
            child.column = 4;
            expect(tracks(grid, 'columns').length).toBe(5);
            child.column = 0;
            expect(tracks(grid, 'columns').length).toBe(1);
        });

        await it('removing a child shrinks the tracks, and an emptied grid has none', () => {
            const grid = new Gtk.Grid();
            const near = label();
            const far = label();
            grid.attach(near as unknown as never, 0, 0);
            grid.attach(far as unknown as never, 3, 0);
            grid.remove(far as unknown as never);
            expect(tracks(grid, 'columns').length).toBe(1);
            grid.remove(near as unknown as never);
            expect(tracks(grid, 'columns').length).toBe(0);
        });

        await it('get_child_at finds the child covering a cell', () => {
            const grid = new Gtk.Grid();
            const wide = label();
            grid.attach(wide as unknown as never, 0, 0, 2, 1);
            expect(grid.get_child_at(1, 0) === (wide as unknown)).toBe(true);
            expect(grid.get_child_at(0, 1)).toBe(null);
        });

        await it('column-homogeneous / row-homogeneous make the matching tracks `*`', () => {
            const grid = new Gtk.Grid({ columnHomogeneous: true });
            grid.attach(label() as unknown as never, 1, 1);
            expect(tracks(grid, 'columns')).toStrictEqual(['star', 'star']);
            expect(tracks(grid, 'rows')).toStrictEqual(['auto', 'auto']);
            grid.rowHomogeneous = true;
            expect(tracks(grid, 'rows')).toStrictEqual(['star', 'star']);
            grid.columnHomogeneous = false;
            expect(tracks(grid, 'columns')).toStrictEqual(['auto', 'auto']);
        });
    });

    await describe('Gtk.Grid: spacing', async () => {
        await it('puts the column gap on the left and the row gap on the top of later cells only', () => {
            const grid = new Gtk.Grid({ columnSpacing: 4, rowSpacing: 8 });
            const first = label();
            const right = label();
            const below = label();
            grid.attach(first as unknown as never, 0, 0);
            grid.attach(right as unknown as never, 1, 0);
            grid.attach(below as unknown as never, 0, 1);
            expect([first.marginLeft, first.marginTop]).toStrictEqual([0, 0]);
            expect([right.marginLeft, right.marginTop]).toStrictEqual([4, 0]);
            expect([below.marginLeft, below.marginTop]).toStrictEqual([0, 8]);
        });

        await it('ADDS to the margin a child already carries instead of replacing it', () => {
            const grid = new Gtk.Grid({ columnSpacing: 4, rowSpacing: 8 });
            const child = label();
            child.marginLeft = 12;
            child.marginTop = 10;
            grid.attach(child as unknown as never, 1, 1);
            expect([child.marginLeft, child.marginTop]).toStrictEqual([16, 18]);
            grid.columnSpacing = 6;
            expect(child.marginLeft).toBe(18);
            grid.remove(child as unknown as never);
            expect([child.marginLeft, child.marginTop]).toStrictEqual([12, 10]);
        });

        await it('follows a child that moves into the first column', () => {
            const grid = new Gtk.Grid({ columnSpacing: 5 });
            const child = label();
            grid.attach(child as unknown as never, 2, 0);
            expect(child.marginLeft).toBe(5);
            child.column = 0;
            expect(child.marginLeft).toBe(0);
        });

        await it('refuses a spacing the guint16 pspec would, and takes the XML string', () => {
            const grid = new Gtk.Grid();
            expect(() => (grid.rowSpacing = -1)).toThrow('is not a spacing');
            (grid as unknown as Record<string, unknown>).columnSpacing = '3';
            expect(grid.columnSpacing).toBe(3);
        });
    });

    await describe('Gtk.Grid: the shared-tree door', async () => {
        await it('builds a status grid the way the debugger template spells it', () => {
            const grid = build({
                tag: 'GtkGrid',
                props: { halign: 'end', 'row-spacing': 2, 'column-spacing': 2, 'column-homogeneous': true },
                children: [
                    { tag: 'GtkLabel', props: { label: 'N', row: 0, column: 0 }, styleClasses: ['flag'] },
                    { tag: 'GtkLabel', props: { label: 'V', row: 0, column: 1 }, styleClasses: ['flag'] },
                    { tag: 'GtkLabel', props: { label: '1', row: 1, column: 1 } },
                ],
            }) as unknown as Gtk.Grid;
            expect(grid.halign).toBe('end');
            expect(grid.columnHomogeneous).toBe(true);
            expect(tracks(grid, 'columns')).toStrictEqual(['star', 'star']);
            expect(tracks(grid, 'rows')).toStrictEqual(['auto', 'auto']);
            expect(grid.get_child_at(1, 1) !== null).toBe(true);
        });

        await it('a Grid takes no style classes it has not got a door for — it has one', () => {
            const grid = build({ tag: 'GtkGrid', styleClasses: ['card'] }) as unknown as Gtk.Grid;
            expect(grid.styleClasses).toStrictEqual(['card']);
            expect(grid.className).toBe('card');
        });
    });
};
