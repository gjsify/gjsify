// ADR 0092's `layout { row: 0; column: 1; }` through the NativeScript tree builder.
//
// On the TREES entry for the reason `containers.spec.ts` gives: it builds the port's real classes
// against the platform double. What it measures is that the cell an authored `layout` names is
// written on the child before the grid reads it, and that the placements this port cannot spell
// are refused by name.

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';

type Cell = { row: number; column: number; rowSpan: number; columnSpan: number; id?: string };

const cellOf = (root: unknown, id: string): Cell => (root as { getViewById(id: string): Cell }).getViewById(id);

const grid = (...children: SharedTreeNode[]): SharedTreeNode => ({ tag: 'GtkGrid', children });

export const AdwGridLayoutNsTest = async () => {
    await describe('layout { } on a Gtk.Grid child', async () => {
        await it('writes row, column and both spans on the child', () => {
            const root = build(
                grid(
                    { tag: 'GtkLabel', id: 'a', layout: { row: 0, column: 1 } },
                    { tag: 'GtkLabel', id: 'b', layout: { row: 2, column: 3, 'row-span': 2, 'column-span': 4 } },
                ),
            );

            expect(cellOf(root, 'a').row).toBe(0);
            expect(cellOf(root, 'a').column).toBe(1);
            expect(cellOf(root, 'b').row).toBe(2);
            expect(cellOf(root, 'b').column).toBe(3);
            expect(cellOf(root, 'b').rowSpan).toBe(2);
            expect(cellOf(root, 'b').columnSpan).toBe(4);
        });

        await it('a child with no layout keeps the platform default cell', () => {
            const root = build(grid({ tag: 'GtkLabel', id: 'plain' }));
            expect(cellOf(root, 'plain').column).toBe(0);
        });

        await it('refuses a key a grid child does not have, by name', () => {
            expect(() => build(grid({ tag: 'GtkLabel', layout: { halign: 'center' } }))).toThrow('halign');
        });

        await it('refuses an identifier where a cell number belongs', () => {
            expect(() => build(grid({ tag: 'GtkLabel', layout: { column: 'null' } }))).toThrow('whole number');
        });

        await it('refuses a layout under a parent with no layout manager', () => {
            expect(() => build({ tag: 'GtkBox', children: [{ tag: 'GtkLabel', layout: { row: 0 } }] })).toThrow(
                'no `attach`',
            );
        });
    });
};
