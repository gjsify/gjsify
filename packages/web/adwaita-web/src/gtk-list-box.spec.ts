// DOM-level tests for <gtk-list-box>: the rows it collects, the `.activatable` class and
// `aria-selected` it derives for each of them, and the three selection doors (click,
// `select_row`, `select_all`) driven with real clicks and real modifiers.
//
// The RULES are `box-selection.spec.ts` in @gjsify/adwaita-core, driven from the same
// conformance tables; what is asserted here is that the element WIRES them — that a click on
// row 3 reaches `listBoxSelect` with the right position and modifiers, and that the answer
// comes back onto the row as a class, an ARIA state and a tab stop.
import { describe, expect, it } from '@gjsify/unit';

import { BOX_ALL_VECTORS, BOX_ROW_VECTORS, BOX_SELECT_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { GtkListBox } from './elements/gtk-list-box.js';
import type { GtkListBoxRow } from './elements/gtk-list-box-row.js';

const LABELS = ['Documents', 'Downloads', 'Music', 'Pictures', 'Videos'];

function mount(
    attrs: Record<string, string> = {},
    rowAttrs: Record<string, string>[] = [],
): { el: GtkListBox; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-list-box') as GtkListBox;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    LABELS.forEach((label, index) => {
        const row = document.createElement('gtk-list-box-row') as GtkListBoxRow;
        for (const [name, value] of Object.entries(rowAttrs[index] ?? {})) row.setAttribute(name, value);
        const text = document.createElement('span');
        text.textContent = label;
        row.appendChild(text);
        el.appendChild(row);
    });
    host.appendChild(el);
    return { el, host };
}

const rowsOf = (el: GtkListBox): GtkListBoxRow[] => [...el.querySelectorAll('gtk-list-box-row')] as GtkListBoxRow[];
const click = (target: Element, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...init }));
const key = (target: Element, init: KeyboardEventInit) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

export const GtkListBoxTest = async () => {
    await describe('<gtk-list-box> collects its rows and derives their state', async () => {
        await it('is a listbox of listitems while it can select, and a plain list in none', () => {
            const { el, host } = mount();
            expect(el.getAttribute('role')).toBe('listbox');
            expect(rowsOf(el)[0]!.getAttribute('role')).toBe('listitem');
            expect(el.getAttribute('aria-multiselectable')).toBe(null);
            el.selectionMode = 'none';
            expect(el.getAttribute('role')).toBe('list');
            el.selectionMode = 'multiple';
            expect(el.getAttribute('aria-multiselectable')).toBe('true');
            host.remove();
        });

        await it('gives every row the .activatable class while the box can select', () => {
            // gtk_list_box_update_row (:3611-3615): activatable OR (selectable AND can_select).
            const { el, host } = mount();
            expect(rowsOf(el).every((row) => row.classList.contains('activatable'))).toBe(true);
            host.remove();
        });

        await it('drops the class off an unactivatable, unselectable row in a none box', () => {
            const { el, host } = mount({ 'selection-mode': 'none' }, [
                {},
                { activatable: 'false', selectable: 'false' },
            ]);
            // Row 0 KEEPS the class: `activatable || (selectable && can_select)` with
            // `can_select` false still answers true through its own `activatable`
            // (gtklistbox.c:3611-3615). Only the row with both flags off loses it.
            expect(rowsOf(el)[0]!.classList.contains('activatable')).toBe(true);
            expect(rowsOf(el)[1]!.classList.contains('activatable')).toBe(false);
            host.remove();
        });

        await it('keeps the class on an unactivatable row that is still selectable', () => {
            const { el, host } = mount({}, [{}, { activatable: 'false' }]);
            expect(rowsOf(el)[1]!.classList.contains('activatable')).toBe(true);
            host.remove();
        });

        await it('publishes aria-selected only while the row is selectable and the box can select', () => {
            const { el, host } = mount({ 'selection-mode': 'multiple' }, [{}, { selectable: 'false' }]);
            el.selectAll();
            expect(rowsOf(el)[0]!.getAttribute('aria-selected')).toBe('true');
            // `gtk_accessible_reset_state` (:3622-3623) — not `false`, ABSENT.
            expect(rowsOf(el)[1]!.hasAttribute('aria-selected')).toBe(false);
            el.selectionMode = 'none';
            expect(rowsOf(el).every((row) => row.hasAttribute('aria-selected'))).toBe(false);
            host.remove();
        });

        await it('takes a row appended after connect into the selection', async () => {
            const { el, host } = mount();
            const row = document.createElement('gtk-list-box-row');
            el.appendChild(row);
            await Promise.resolve();
            expect(el.rows).toHaveLength(LABELS.length + 1);
            host.remove();
        });
    });

    await describe('<gtk-list-box> drives the select vectors with real clicks', async () => {
        for (const vector of BOX_SELECT_VECTORS) {
            await it(vector.rule, async () => {
                const attrs: Record<string, string> = { 'selection-mode': vector.mode };
                if (vector.step.modify === true) attrs['activate-on-single-click'] = 'false';
                const rowAttrs = LABELS.map(() => ({}));
                if (vector.step.selectable === false && vector.position >= 0 && vector.position < LABELS.length) {
                    rowAttrs[vector.position] = { selectable: 'false' };
                }
                const { el, host } = mount(attrs, rowAttrs);
                // The step opens on the selection and anchor the vector names, so the click
                // runs against a real state rather than a rebuilt one.
                for (const position of vector.selection) el.selectRow(el.rows[position]!);
                if (vector.anchor >= 0 && vector.selection.length > 0) el.selectRow(el.rows[vector.anchor]!);
                if (vector.anchor === -1) el.unselectAll();
                if (vector.mode === 'browse') {
                    // `browse` refuses `unselect_all` (:986-987), so its starting selection is
                    // reached by selecting the one row and then another.
                    el.selectRow(el.rows[vector.selection[0] ?? 0]!);
                }
                await Promise.resolve();
                if (vector.step.extend === true || vector.step.modify === true) {
                    click(rowsOf(el)[vector.position]!, {
                        ctrlKey: vector.step.modify === true,
                        shiftKey: vector.step.extend === true,
                    });
                } else {
                    click(rowsOf(el)[vector.position < 0 ? 0 : Math.min(vector.position, LABELS.length - 1)]!);
                }
                expect(el.selectedRows).toStrictEqual(vector.expected.selection);
                host.remove();
            });
        }
    });

    await describe('<gtk-list-box> select_all / unselect_all refusals', async () => {
        for (const vector of BOX_ALL_VECTORS) {
            await it(vector.rule, async () => {
                const { el, host } = mount({ 'selection-mode': vector.mode });
                if (vector.op === 'select-all') {
                    el.selectAll();
                    expect(el.selectedRows).toStrictEqual(vector.expected ?? []);
                } else {
                    el.selectRow(el.rows[0]!);
                    el.selectAll();
                    el.unselectAll();
                    // A refusal leaves the rows selected; a change clears them. The modes that
                    // refuse are the ones `select_all` never filled in the first place, so both
                    // halves are read off the SAME fact the C reads it from.
                    expect(el.selectedRows.length > 0).toBe(vector.mode !== 'multiple');
                }
                host.remove();
            });
        }
    });

    await describe('<gtk-list-box> drives the programmatic row vectors', async () => {
        for (const vector of BOX_ROW_VECTORS) {
            await it(vector.rule, async () => {
                const rowAttrs = LABELS.map(() => ({}));
                if (vector.step.selectable === false && vector.position !== null) {
                    rowAttrs[vector.position] = { selectable: 'false' };
                }
                // `multiple` to BUILD the selection and the vector's own mode afterwards:
                // `gtk_list_box_set_selection_mode` notifies and updates the rows but does
                // NOT prune what is selected (gtklistbox.c:1219-1225), so a single-mode box
                // holding two rows is a state GTK itself can be in, and one the element can.
                const { el, host } = mount({ 'selection-mode': 'multiple' }, rowAttrs);
                for (const position of vector.selection) el.selectRow(el.rows[position]!);
                await Promise.resolve();
                el.setAttribute('selection-mode', vector.mode);
                await Promise.resolve();

                const target = vector.position === null ? null : el.rows[vector.position];
                if (vector.op === 'select') el.selectRow(target);
                else if (target !== null) el.unselectRow(target);
                expect(el.selectedRows).toStrictEqual(vector.expected.selection);
                host.remove();
            });
        }
    });

    await describe('<gtk-list-box> tab-behavior', async () => {
        await it('gives every activatable row its own tab stop by default', () => {
            const { el, host } = mount();
            expect(rowsOf(el).map((row) => row.tabIndex)).toStrictEqual([0, 0, 0, 0, 0]);
            host.remove();
        });

        await it('hands out one tab stop for the whole box under item and cell', () => {
            const { el, host } = mount({ 'tab-behavior': 'item' });
            expect(rowsOf(el).map((row) => row.tabIndex)).toStrictEqual([0, -1, -1, -1, -1]);
            el.tabBehavior = 'cell';
            expect(rowsOf(el).map((row) => row.tabIndex)).toStrictEqual([0, -1, -1, -1, -1]);
            host.remove();
        });

        await it('puts the roving tab stop on the first selected row, and moves it on selection', () => {
            const { el, host } = mount({ 'tab-behavior': 'item' });
            el.selectRow(el.rows[3]!);
            expect(rowsOf(el).map((row) => row.tabIndex)).toStrictEqual([-1, -1, -1, 0, -1]);
            host.remove();
        });
    });

    await describe('<gtk-list-box> activation', async () => {
        await it('activates on one click by default and emits row-activated and activate', async () => {
            const { el, host } = mount();
            let activated = 0;
            let rowActivated = 0;
            el.addEventListener('row-activated', () => {
                rowActivated++;
            });
            rowsOf(el)[2]!.addEventListener('activate', () => {
                activated++;
            });
            click(rowsOf(el)[2]!);
            expect(activated).toBe(1);
            expect(rowActivated).toBe(1);
            host.remove();
        });

        await it('waits for a double click when activate-on-single-click is off', () => {
            const { el, host } = mount({ 'activate-on-single-click': 'false' });
            let activated = 0;
            rowsOf(el)[2]!.addEventListener('activate', () => {
                activated++;
            });
            click(rowsOf(el)[2]!, { detail: 1 });
            expect(activated).toBe(0);
            click(rowsOf(el)[2]!, { detail: 2 });
            expect(activated).toBe(1);
            host.remove();
        });

        await it('emits nothing for a row that is not activatable', () => {
            const { el, host } = mount({}, [{}, { activatable: 'false' }]);
            let activated = 0;
            rowsOf(el)[1]!.addEventListener('activate', () => {
                activated++;
            });
            click(rowsOf(el)[1]!);
            expect(activated).toBe(0);
            // The CLICK still selects — activatable is about activation, not selection.
            expect(el.selectedRows).toStrictEqual([1]);
            host.remove();
        });

        await it('toggles the row on Ctrl+Space, the toggle-cursor-row binding', () => {
            const { el, host } = mount({ 'selection-mode': 'multiple' });
            const row = rowsOf(el)[1]!;
            row.focus();
            key(row, { key: ' ', ctrlKey: true });
            expect(el.selectedRows).toStrictEqual([1]);
            key(row, { key: ' ', ctrlKey: true });
            expect(el.selectedRows).toStrictEqual([]);
            host.remove();
        });

        await it('emits selected-rows-changed on every change and row-selected once', async () => {
            const { el, host } = mount();
            let changes = 0;
            let rowSelected = 0;
            let notified: number[] = [];
            el.addEventListener('selected-rows-changed', () => {
                changes++;
            });
            el.addEventListener('row-selected', () => {
                rowSelected++;
            });
            el.addEventListener('notify::selected-rows', (event) => {
                notified = (event as CustomEvent<{ selectedRows: number[] }>).detail.selectedRows;
            });
            click(rowsOf(el)[1]!);
            click(rowsOf(el)[2]!);
            expect(changes).toBe(2);
            expect(rowSelected).toBe(2);
            expect(notified).toStrictEqual([2]);
            host.remove();
        });
    });

    await describe('<gtk-list-box> row-selected names the row the click landed on', async () => {
        await it('and NULL when that row ended up unselected', () => {
            const { el, host } = mount();
            const seen: (HTMLElement | null)[] = [];
            el.addEventListener('row-selected', (event) => {
                seen.push((event as CustomEvent<{ row: HTMLElement | null }>).detail.row);
            });
            click(rowsOf(el)[2]!);
            expect(seen).toStrictEqual([rowsOf(el)[2]!]);
            // Ctrl+click on the SELECTED row in single mode clears it, and the C emits
            // row-selected with NULL there (gtklistbox.c:1826-1828).
            click(rowsOf(el)[2]!, { ctrlKey: true });
            expect(seen[1]).toBe(null);
            expect(el.selectedRows).toStrictEqual([]);
            host.remove();
        });
    });

    await describe('<gtk-list-box> select_row is the programmatic door, not the click', async () => {
        await it('is idempotent where a click would toggle', () => {
            const { el, host } = mount();
            el.selectRow(el.rows[2]!);
            el.selectRow(el.rows[2]!);
            expect(el.selectedRows).toStrictEqual([2]);
            host.remove();
        });

        await it('clears everything for a null row and moves the anchor with it', async () => {
            const { el, host } = mount({ 'selection-mode': 'multiple' });
            el.selectRow(el.rows[1]!);
            el.selectRow(el.rows[3]!);
            el.selectRow(null);
            expect(el.selectedRows).toStrictEqual([]);
            host.remove();
        });

        await it('ignores an unselectable row', () => {
            const { el, host } = mount({}, [{}, { selectable: 'false' }]);
            el.selectRow(el.rows[1]!);
            expect(el.selectedRows).toStrictEqual([]);
            host.remove();
        });
    });

    await describe('<gtk-list-box-row> on its own', async () => {
        await it('reads activatable and selectable by PRESENCE, defaulting both to true', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const row = document.createElement('gtk-list-box-row') as GtkListBoxRow;
            host.appendChild(row);
            expect(row.activatable).toBe(true);
            expect(row.selectable).toBe(true);
            row.setAttribute('activatable', 'false');
            row.setAttribute('selectable', 'false');
            expect(row.activatable).toBe(false);
            expect(row.selectable).toBe(false);
            host.remove();
        });

        await it('is the tab stop only while activatable, and answers Enter and Space', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const row = document.createElement('gtk-list-box-row') as GtkListBoxRow;
            host.appendChild(row);
            let activations = 0;
            row.addEventListener('activate', () => {
                activations++;
            });
            expect(row.tabIndex).toBe(0);
            key(row, { key: 'Enter' });
            key(row, { key: ' ' });
            expect(activations).toBe(2);
            // `activatable="false"` alone does NOT stop the class: the row is still
            // SELECTABLE, and the C's rule is `activatable || (selectable && can_select)`
            // (gtklistbox.c:3611-3615). Both flags off is what takes the tab stop away.
            row.setAttribute('activatable', 'false');
            expect(row.classList.contains('activatable')).toBe(true);
            row.setAttribute('selectable', 'false');
            // Not activatable means NOT FOCUSABLE upstream, and `attachRowActivation` removes
            // the attribute rather than writing -1 (row-activation.ts).
            expect(row.hasAttribute('tabindex')).toBe(false);
            key(row, { key: 'Enter' });
            expect(activations).toBe(2);
            host.remove();
        });

        await it('puts an authored child in the contents node, after connect too', async () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const row = document.createElement('gtk-list-box-row') as GtkListBoxRow;
            const first = document.createElement('span');
            first.textContent = 'first';
            row.appendChild(first);
            host.appendChild(row);
            expect(row.child).toBe(first);
            const late = document.createElement('span');
            late.textContent = 'late';
            row.appendChild(late);
            await Promise.resolve();
            expect(row.child).toBe(first);
            expect(row.textContent).toContain('late');
            host.remove();
        });
    });
};
