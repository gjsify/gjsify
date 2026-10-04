// DOM-level tests for <gtk-column-view>: the header, one cell per visible column, the
// per-column factory, and the sort state a header click produces. The rows, the model and
// the selection are <gtk-list-view>'s and are asserted there; what is checked here is
// that they still arrive through the subclass.
import { describe, expect, it } from '@gjsify/unit';

import { COLUMN_VIEW_SORT_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { GtkColumnView } from './elements/gtk-column-view.js';

const COLUMNS =
    '[{"key":"label","id":"name","title":"Name","sortable":true},{"key":"value","id":"code","title":"Code"}]';

function mount(attrs: Record<string, string> = {}): { el: GtkColumnView; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-column-view') as GtkColumnView;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

const headers = (el: GtkColumnView): HTMLElement[] => [
    ...el.querySelectorAll<HTMLElement>('.adw-column-view-header-cell'),
];
const rows = (el: GtkColumnView): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.adw-column-view-row')];
const cellsOf = (row: HTMLElement): string[] =>
    [...row.querySelectorAll<HTMLElement>('.adw-column-view-cell')].map((cell) => cell.textContent ?? '');

const MODEL = '[{"value":"de","label":"German"},{"value":"fr","label":"French"}]';

export const GtkColumnViewTest = async () => {
    await describe('<gtk-column-view> header and cells', async () => {
        await it('draws one header button per column and one cell per column per row', () => {
            const { el, host } = mount({ columns: COLUMNS, model: MODEL });
            expect(headers(el).map((button) => button.textContent?.trim())).toStrictEqual(['Name', 'Code']);
            expect(rows(el).length).toBe(2);
            expect(cellsOf(rows(el)[0]!)).toStrictEqual(['German', 'de']);
            expect(cellsOf(rows(el)[1]!)).toStrictEqual(['French', 'fr']);
            host.remove();
        });

        await it('announces itself as a grid of rows, headers and cells', () => {
            const { el, host } = mount({ columns: COLUMNS, model: MODEL });
            expect(el.getAttribute('role')).toBe('grid');
            expect(headers(el)[0]!.getAttribute('role')).toBe('columnheader');
            expect(rows(el)[0]!.getAttribute('role')).toBe('row');
            expect(rows(el)[0]!.querySelector('.adw-column-view-cell')?.getAttribute('role')).toBe('gridcell');
            host.remove();
        });

        await it('leaves an invisible column out of both the header and the rows', () => {
            const { el, host } = mount({ model: MODEL });
            el.columns = [
                { key: 'label', id: 'name', title: 'Name' },
                { key: 'value', id: 'code', title: 'Code', visible: false },
            ];
            expect(headers(el).length).toBe(1);
            expect(cellsOf(rows(el)[0]!)).toStrictEqual(['German']);
            host.remove();
        });

        await it('gives the header and every row the same track list', () => {
            const { el, host } = mount({ model: MODEL });
            el.columns = [
                { key: 'label', id: 'name', fixedWidth: 120 },
                { key: 'value', id: 'code', expand: true },
            ];
            const header = el.querySelector<HTMLElement>('.adw-column-view-header')!;
            expect(header.style.gridTemplateColumns).toBe('120px 1fr');
            expect(rows(el)[0]!.style.gridTemplateColumns).toBe('120px 1fr');
            host.remove();
        });

        await it('draws a column with a factory instead of its portable field', () => {
            const { el, host } = mount({ columns: COLUMNS, model: MODEL });
            el.columnFactories = {
                code: (context) => {
                    const node = document.createElement('code');
                    node.textContent = context.item.value.toUpperCase();
                    return node;
                },
            };
            expect(cellsOf(rows(el)[0]!)).toStrictEqual(['German', 'DE']);
            host.remove();
        });
    });

    await describe('<gtk-column-view> drives the sort vectors with real header clicks', async () => {
        for (const vector of COLUMN_VIEW_SORT_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount({ model: MODEL });
                el.columns = [
                    { key: 'label', id: 'name', title: 'Name', sortable: true },
                    { key: 'value', id: 'code', title: 'Code', sortable: vector.sortable },
                ];
                el.sorter = vector.current;
                headers(el)
                    .find((button) => button.dataset.columnId === vector.column)!
                    .click();
                expect(el.sorter).toStrictEqual(vector.next);
                host.remove();
            });
        }
    });

    await describe('<gtk-column-view> sorting', async () => {
        await it('sorts ascending on the first click and inverts on the second', () => {
            const { el, host } = mount({ columns: COLUMNS, model: MODEL });
            const seen: (string | null)[] = [];
            el.addEventListener('notify::sorter', (event) => {
                const sorter = (event as CustomEvent).detail.sorter as { column: string; descending: boolean } | null;
                seen.push(sorter === null ? null : `${sorter.column}/${sorter.descending}`);
            });
            headers(el)[0]!.click();
            expect(el.sorter).toStrictEqual({ column: 'name', descending: false });
            expect(headers(el)[0]!.getAttribute('aria-sort')).toBe('ascending');
            headers(el)[0]!.click();
            expect(el.sorter).toStrictEqual({ column: 'name', descending: true });
            expect(headers(el)[0]!.getAttribute('aria-sort')).toBe('descending');
            expect(seen).toStrictEqual(['name/false', 'name/true']);
            host.remove();
        });

        await it('does not sort by a column that declares no sorter', () => {
            const { el, host } = mount({ columns: COLUMNS, model: MODEL });
            headers(el)[1]!.click();
            expect(el.sorter).toBe(null);
            expect(headers(el)[1]!.hasAttribute('aria-sort')).toBe(false);
            host.remove();
        });

        await it('REORDERS nothing by itself, the way gtk_column_view_get_sorter does not', () => {
            // The view publishes the sort and the consumer re-assigns the model; a view
            // that reordered its own rows would fight whatever model the consumer holds.
            const { el, host } = mount({ columns: COLUMNS, model: MODEL });
            headers(el)[0]!.click();
            expect(rows(el).map((row) => cellsOf(row)[0])).toStrictEqual(['German', 'French']);
            host.remove();
        });
    });

    await describe('<gtk-column-view> separators', async () => {
        await it('colours the cell borders only while show-column-separators is set', () => {
            const { el, host } = mount({ columns: COLUMNS, model: MODEL });
            expect(el.classList.contains('column-separators')).toBe(false);
            el.showColumnSeparators = true;
            expect(el.classList.contains('column-separators')).toBe(true);
            el.showRowSeparators = true;
            expect(el.classList.contains('separators')).toBe(true);
            host.remove();
        });
    });
};
