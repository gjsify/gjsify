// `Gtk.ListBox`, built as the REAL class against the platform double: rows in order, selection by
// mode, `row-activated` from a port row and from a plain widget, and the shared-tree spelling of
// the boxed list Learn6502's navigation page declares.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import { GridLayout, type LayoutBase, type View } from './testing/ns-core.mjs';

const row = (): View => new Gtk.Label() as unknown as View;
const tap = (view: View) => view.notify({ eventName: 'tap', object: view });

/** The children of a layout, in paint order. */
function childrenOf(layout: object): object[] {
    const base = layout as LayoutBase;
    return Array.from({ length: base.getChildrenCount() }, (_unused, index) => base.getChildAt(index));
}

export const GtkListBoxNsTest = async () => {
    await describe('Gtk.ListBox: rows', async () => {
        await it('stacks rows top to bottom, one auto track each', () => {
            const list = new Gtk.ListBox();
            const [a, b, c] = [row(), row(), row()];
            list.append(a as unknown as never);
            list.append(b as unknown as never);
            list.prepend(c as unknown as never);
            expect(childrenOf(list)).toStrictEqual([c, a, b]);
            expect([c, a, b].map((view) => GridLayout.getRow(view))).toStrictEqual([0, 1, 2]);
            expect((list as unknown as { _rows: unknown[] })._rows.length).toBe(3);
            expect(list.get_row_at_index(1) === (a as unknown)).toBe(true);
            expect(list.get_row_at_index(5)).toBe(null);
        });

        await it('insert() at a position, and negative or too large appends', () => {
            const list = new Gtk.ListBox();
            const [a, b, c, d] = [row(), row(), row(), row()];
            list.append(a as unknown as never);
            list.append(b as unknown as never);
            list.insert(c as unknown as never, 1);
            list.insert(d as unknown as never, -1);
            expect(childrenOf(list)).toStrictEqual([a, c, b, d]);
        });

        await it('remove() and remove_all() renumber what is left', () => {
            const list = new Gtk.ListBox();
            const [a, b, c] = [row(), row(), row()];
            for (const view of [a, b, c]) list.append(view as unknown as never);
            list.remove(a as unknown as never);
            expect([b, c].map((view) => GridLayout.getRow(view))).toStrictEqual([0, 1]);
            list.remove_all();
            expect(childrenOf(list).length).toBe(0);
        });

        await it('flags only the first row so the card keeps its rounded top', () => {
            const list = new Gtk.ListBox();
            const [a, b] = [row(), row()];
            list.append(a as unknown as never);
            list.append(b as unknown as never);
            expect(a.className).toBe('adw-row-flush-top');
            expect(b.className).toBe(undefined);
            const first = row();
            list.prepend(first as unknown as never);
            expect(first.className).toBe('adw-row-flush-top');
            expect(a.className ?? '').toBe('');
        });

        await it('every XML child is a row', () => {
            const list = build({
                tag: 'GtkListBox',
                children: [{ tag: 'AdwActionRow' }, { tag: 'GtkLabel' }],
            }) as unknown as Gtk.ListBox;
            expect(childrenOf(list).length).toBe(2);
        });
    });

    await describe('Gtk.ListBox: selection', async () => {
        await it('defaults to `single`: a tap selects, and selects another instead of adding', () => {
            const list = new Gtk.ListBox();
            const [a, b] = [row(), row()];
            list.append(a as unknown as never);
            list.append(b as unknown as never);
            expect(list.selectionMode).toBe('single');
            tap(a);
            expect(list.get_selected_row() === (a as unknown)).toBe(true);
            expect(a.className ?? '').toContain('adw-list-row-selected');
            tap(b);
            expect(list.get_selected_row() === (b as unknown)).toBe(true);
            expect(a.className ?? '').not.toContain('adw-list-row-selected');
        });

        await it('`none` selects nothing, as the learn page declares its navigation list', () => {
            const list = new Gtk.ListBox({ selectionMode: 'none' });
            const a = row();
            list.append(a as unknown as never);
            tap(a);
            expect(list.get_selected_row()).toBe(null);
            expect(a.className ?? '').not.toContain('adw-list-row-selected');
        });

        await it('`multiple` toggles, and get_selected_rows answers in list order', () => {
            const list = new Gtk.ListBox({ selectionMode: 'multiple' });
            const [a, b] = [row(), row()];
            list.append(a as unknown as never);
            list.append(b as unknown as never);
            tap(b);
            tap(a);
            expect(list.get_selected_rows()).toStrictEqual([a, b]);
            tap(a);
            expect(list.get_selected_rows()).toStrictEqual([b]);
        });

        await it('emits `row-selected` with the first selected row, and null when cleared', () => {
            const list = new Gtk.ListBox();
            const a = row();
            list.append(a as unknown as never);
            const seen: (View | null)[] = [];
            list.connect('row-selected', (_self, data) => seen.push((data as unknown as { row: View | null }).row));
            tap(a);
            list.unselect_all();
            expect(seen).toStrictEqual([a, null]);
        });

        await it('select_row / unselect_row work from code, and select_row(null) clears', () => {
            const list = new Gtk.ListBox();
            const [a, b] = [row(), row()];
            list.append(a as unknown as never);
            list.append(b as unknown as never);
            list.select_row(b as unknown as never);
            expect(list.get_selected_row() === (b as unknown)).toBe(true);
            list.unselect_row(b as unknown as never);
            expect(list.get_selected_row()).toBe(null);
            list.select_row(a as unknown as never);
            list.select_row(null);
            expect(list.get_selected_row()).toBe(null);
        });

        await it('changing the mode drops what the new mode cannot hold', () => {
            const list = new Gtk.ListBox({ selectionMode: 'multiple' });
            const [a, b] = [row(), row()];
            list.append(a as unknown as never);
            list.append(b as unknown as never);
            list.select_all();
            list.selectionMode = 'single';
            expect(list.get_selected_rows().length).toBe(0);
            expect(a.className ?? '').not.toContain('adw-list-row-selected');
            expect(() => ((list as unknown as Record<string, unknown>).selectionMode = 'many')).toThrow(
                'is not a Gtk.SelectionMode',
            );
        });

        await it('a removed row leaves the selection', () => {
            const list = new Gtk.ListBox();
            const a = row();
            list.append(a as unknown as never);
            tap(a);
            list.remove(a as unknown as never);
            expect(list.get_selected_row()).toBe(null);
        });
    });

    await describe('Gtk.ListBox: activation', async () => {
        await it('a tap on a plain widget activates it', () => {
            const list = new Gtk.ListBox({ selectionMode: 'none' });
            const a = row();
            list.append(a as unknown as never);
            const seen: unknown[] = [];
            list.connect('row-activated', (_self, data) => seen.push((data as unknown as { row: View }).row));
            tap(a);
            expect(seen).toStrictEqual([a]);
        });

        await it('a port row activates itself, and a tap on it is not counted twice', () => {
            const list = new Gtk.ListBox({ selectionMode: 'none' });
            const action = new Adw.ActionRow();
            list.append(action as unknown as never);
            const seen: unknown[] = [];
            list.connect('row-activated', (_self, data) => seen.push((data as unknown as { row: View }).row));
            tap(action as unknown as View);
            expect(seen.length).toBe(0);
            (action as unknown as View).notify({ eventName: 'activated', object: action as unknown as View });
            expect(seen).toStrictEqual([action]);
        });

        await it('a row that left the list no longer activates it', () => {
            const list = new Gtk.ListBox();
            const a = row();
            list.append(a as unknown as never);
            list.remove(a as unknown as never);
            let count = 0;
            list.connect('row-activated', () => count++);
            tap(a);
            expect(count).toBe(0);
        });
    });

    await describe('Gtk.ListBox: the shared-tree door', async () => {
        await it('builds the boxed list of the learn page: selection-mode none, a style class, action rows', () => {
            const list = build({
                tag: 'GtkListBox',
                id: 'navigationList',
                props: { 'selection-mode': 'none' },
                styleClasses: ['boxed-list'],
                children: [
                    { tag: 'AdwActionRow', props: { title: 'Tutorial', activatable: true } },
                    { tag: 'AdwActionRow', props: { title: 'Examples', activatable: true } },
                ],
            }) as unknown as Gtk.ListBox;
            expect(list.selectionMode).toBe('none');
            expect(list.className).toBe('boxed-list');
            expect(childrenOf(list).length).toBe(2);
            expect(list.getViewById('navigationList') === (list as unknown)).toBe(true);
        });
    });
};
