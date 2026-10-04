// The view half of the portable list, held to the C it was ported from (ADR 0089).
//
// Every case here is a line of `gtk_list_base_select_item`, `gtk_grid_view_compute_n_columns`
// or `gtk_column_view_sorter_add_column` — so a rewrite that "simplifies" the autoselect
// refusal or the clamp order fails naming the behaviour, not the implementation.
import { describe, expect, it } from '@gjsify/unit';

import {
    COLUMN_VIEW_SORT_VECTORS,
    GRID_VIEW_COLUMN_VECTORS,
    LIST_VIEW_SELECT_VECTORS,
} from './conformance/list-view.js';
import {
    ADW_GRID_VIEW_MAX_COLUMNS,
    columnViewSort,
    columnViewTracks,
    gridViewColumns,
    listItemField,
    listViewSelect,
    listViewSelectAll,
    ListViewState,
    normalizeColumnViewColumns,
    normalizeListSelectionMode,
    parseColumnViewColumns,
} from './list-view.js';
import { normalizeComboOptions } from './list.js';

const MODEL = normalizeComboOptions(['Alpha', 'Beta', 'Gamma', 'Delta']);

export default async () => {
    await describe('normalizeListSelectionMode', async () => {
        await it('takes the three nicks and answers single for anything else', () => {
            expect(normalizeListSelectionMode('none')).toBe('none');
            expect(normalizeListSelectionMode('multiple')).toBe('multiple');
            expect(normalizeListSelectionMode('browse')).toBe('single');
            expect(normalizeListSelectionMode(null)).toBe('single');
        });
    });

    await describe('the selection vectors, through ListViewState', async () => {
        for (const vector of LIST_VIEW_SELECT_VECTORS) {
            await it(vector.rule, () => {
                const state = new ListViewState();
                state.setSelectionMode(vector.mode);
                state.setModel(normalizeComboOptions(Array.from({ length: vector.length }, (_, i) => `${i}`)));
                for (const click of vector.clicks) {
                    state.selectItem(click.position, { modify: click.modify, extend: click.extend });
                }
                expect(state.selection).toStrictEqual([...vector.selection]);
            });
        }
    });

    await describe('the column vectors, through gridViewColumns', async () => {
        for (const vector of GRID_VIEW_COLUMN_VECTORS) {
            await it(vector.rule, () => {
                expect(
                    gridViewColumns(
                        vector.forSize,
                        vector.itemSize,
                        vector.spacing,
                        vector.minColumns,
                        vector.maxColumns,
                    ),
                ).toBe(vector.columns);
            });
        }
    });

    await describe('the sort vectors, through columnViewSort', async () => {
        for (const vector of COLUMN_VIEW_SORT_VECTORS) {
            await it(vector.rule, () => {
                const [column] = normalizeColumnViewColumns([
                    { key: 'label', id: vector.column, sortable: vector.sortable },
                ]);
                expect(columnViewSort(vector.current, column!)).toStrictEqual(vector.next);
            });
        }
    });

    await describe('listViewSelect — gtk_list_base_select_item', async () => {
        await it('a plain click selects exclusively', () => {
            expect(listViewSelect([0, 1], -1, 3, 4, 'multiple').selection).toStrictEqual([3]);
        });

        await it('ignores a position the model does not have', () => {
            expect(listViewSelect([1], 1, 9, 4, 'multiple').selection).toStrictEqual([1]);
        });

        await it('selects nothing at all in none mode, which is GtkNoSelection', () => {
            expect(listViewSelect([], -1, 2, 4, 'none').selection).toStrictEqual([]);
        });

        await it('Ctrl+click adds and removes in multiple mode', () => {
            const added = listViewSelect([0], 0, 2, 4, 'multiple', { modify: true });
            expect(added.selection).toStrictEqual([0, 2]);
            expect(
                listViewSelect(added.selection, added.anchor, 0, 4, 'multiple', { modify: true }).selection,
            ).toStrictEqual([2]);
        });

        await it('Ctrl+click on the SELECTED row leaves it selected in single mode', () => {
            // gtk_single_selection_unselect_item refuses while autoselect is on, and
            // autoselect defaults TRUE — so the row stays selected.
            expect(listViewSelect([1], 1, 1, 4, 'single', { modify: true }).selection).toStrictEqual([1]);
        });

        await it('Ctrl+click on another row MOVES the single selection', () => {
            expect(listViewSelect([1], 1, 3, 4, 'single', { modify: true }).selection).toStrictEqual([3]);
        });

        await it('Shift+click selects the span from the anchor and drops the rest', () => {
            expect(listViewSelect([0], 0, 2, 4, 'multiple', { extend: true }).selection).toStrictEqual([0, 1, 2]);
            expect(listViewSelect([3], 3, 1, 4, 'multiple', { extend: true }).selection).toStrictEqual([1, 2, 3]);
        });

        await it('Ctrl+Shift takes the span from the ANCHOR state, so it can clear a run', () => {
            const selected = listViewSelect([0, 1, 2, 3], 0, 2, 4, 'multiple', { extend: true, modify: true });
            expect(selected.selection).toStrictEqual([0, 1, 2, 3]);
            const cleared = listViewSelect([1, 2, 3], 0, 2, 4, 'multiple', { extend: true, modify: true });
            expect(cleared.selection).toStrictEqual([3]);
        });

        await it('Shift+click in single mode falls through to a plain selection', () => {
            // GtkSingleSelection has no select_range, so the C's range branch fails and
            // the single-item path runs.
            expect(listViewSelect([0], 0, 3, 4, 'single', { extend: true }).selection).toStrictEqual([3]);
        });

        await it('moves the anchor to every accepted position', () => {
            expect(listViewSelect([], -1, 2, 4, 'multiple').anchor).toBe(2);
            expect(listViewSelect([], -1, 9, 4, 'multiple').anchor).toBe(-1);
        });

        await it('select-all is GtkMultiSelection only', () => {
            expect(listViewSelectAll(3, 'multiple')).toStrictEqual([0, 1, 2]);
            expect(listViewSelectAll(3, 'single')).toStrictEqual([]);
            expect(listViewSelectAll(3, 'none')).toStrictEqual([]);
        });
    });

    await describe('ListViewState', async () => {
        await it('hands back a COPY of the model, items included', () => {
            const state = new ListViewState();
            state.setModel(MODEL);
            const read = state.model;
            read.push({ value: 'Epsilon', label: 'Epsilon' });
            read[0]!.label = 'mutated';
            expect(state.count).toBe(4);
            expect(state.model[0]!.label).toBe('Alpha');
        });

        await it('emits ONE splice per assignment and none for an equal model', () => {
            const state = new ListViewState();
            const splices: string[] = [];
            state.subscribeItems((change) => splices.push(`${change.position}/${change.removed}/${change.added}`));
            state.setModel(MODEL);
            state.setModel([...MODEL]);
            state.setModel([...MODEL, { value: 'Epsilon', label: 'Epsilon' }]);
            expect(splices).toStrictEqual(['0/0/4', '4/0/1']);
        });

        await it('drops a selected position the new model does not have, and does NOT autoselect', () => {
            const state = new ListViewState();
            state.setModel(MODEL);
            state.selectItem(3);
            state.setModel(MODEL.slice(0, 2));
            expect(state.selection).toStrictEqual([]);
        });

        await it('reports whether the selection changed, not whether the anchor moved', () => {
            const state = new ListViewState();
            state.setModel(MODEL);
            expect(state.selectItem(1)).toBe(true);
            expect(state.selectItem(1)).toBe(false);
        });

        await it('narrowing to single keeps the last clicked row', () => {
            const state = new ListViewState();
            state.setModel(MODEL);
            state.setSelectionMode('multiple');
            state.selectItem(0);
            state.selectItem(2, { modify: true });
            state.setSelectionMode('single');
            expect(state.selection).toStrictEqual([2]);
        });

        await it('narrowing to none clears the selection', () => {
            const state = new ListViewState();
            state.setModel(MODEL);
            state.selectItem(1);
            state.setSelectionMode('none');
            expect(state.selection).toStrictEqual([]);
        });

        await it('hands a factory the item, its position and its selected state', () => {
            const state = new ListViewState();
            state.setModel(MODEL);
            state.selectItem(2);
            expect(state.itemContext(2)).toStrictEqual({
                item: { value: 'Gamma', label: 'Gamma' },
                position: 2,
                selected: true,
            });
            expect(state.itemContext(9)).toBe(null);
        });

        await it('tells selection subscribers whether a USER produced the change', () => {
            const state = new ListViewState();
            const seen: boolean[] = [];
            state.setModel(MODEL);
            state.subscribeSelection((change) => seen.push(change.interactive));
            state.selectItem(1);
            state.setSelection([2]);
            expect(seen).toStrictEqual([true, false]);
        });
    });

    await describe('gridViewColumns — gtk_grid_view_compute_n_columns', async () => {
        await it('divides the available size by the item size, rounding down', () => {
            expect(gridViewColumns(400, 100, 0, 1, ADW_GRID_VIEW_MAX_COLUMNS)).toBe(4);
            expect(gridViewColumns(399, 100, 0, 1, ADW_GRID_VIEW_MAX_COLUMNS)).toBe(3);
        });

        await it('counts the spacing BETWEEN items only, so the last column needs no gap', () => {
            // Three 100px items with 12px gaps measure 324px; the C adds the spacing to
            // both sides of the division, which is what makes 324 fit exactly three.
            expect(gridViewColumns(324, 100, 12, 1, 7)).toBe(3);
            expect(gridViewColumns(323, 100, 12, 1, 7)).toBe(2);
        });

        await it('clamps to min and max', () => {
            expect(gridViewColumns(4000, 100, 0, 1, 7)).toBe(7);
            expect(gridViewColumns(50, 100, 0, 2, 7)).toBe(2);
        });

        await it('keeps CLAMP order when max is below min, as the ParamSpec documents', () => {
            expect(gridViewColumns(50, 100, 0, 4, 2)).toBe(4);
            expect(gridViewColumns(4000, 100, 0, 4, 2)).toBe(4);
        });

        await it('never divides by zero for a zero-sized item', () => {
            expect(gridViewColumns(400, 0, 0, 1, 7)).toBe(7);
        });
    });

    await describe('column descriptors', async () => {
        await it('defaults the title and the id to the key, and drops a keyless entry', () => {
            const columns = normalizeColumnViewColumns([{ key: 'label' }, { title: 'orphan' }]);
            expect(columns.length).toBe(1);
            expect(columns[0]!.title).toBe('label');
            expect(columns[0]!.id).toBe('label');
            expect(columns[0]!.visible).toBe(true);
        });

        await it('clamps an unknown field to label, the half a reader can always see', () => {
            expect(normalizeColumnViewColumns([{ key: 'size' }])[0]!.key).toBe('label');
            expect(normalizeColumnViewColumns([{ key: 'value' }])[0]!.key).toBe('value');
        });

        await it('reads the clamped field off an item', () => {
            const item = { value: 'de_DE', label: 'German' };
            expect(listItemField(item, 'label')).toBe('German');
            expect(listItemField(item, 'value')).toBe('de_DE');
        });

        await it('parses the markup door and is total on malformed JSON', () => {
            expect(parseColumnViewColumns('[{"key":"label"}]').length).toBe(1);
            expect(parseColumnViewColumns('{')).toStrictEqual([]);
            expect(parseColumnViewColumns('{"key":"label"}')).toStrictEqual([]);
            expect(parseColumnViewColumns(null)).toStrictEqual([]);
        });

        await it('maps fixed-width and expand onto the data grid tracks', () => {
            const tracks = columnViewTracks(
                normalizeColumnViewColumns([
                    { key: 'label', id: 'a', fixedWidth: 80 },
                    { key: 'label', id: 'b', expand: true },
                    { key: 'value', id: 'c' },
                    { key: 'value', id: 'd', visible: false },
                ]),
            );
            expect(tracks).toStrictEqual([
                { kind: 'fixed', css: '80px' },
                { kind: 'flex', weight: 1 },
                { kind: 'auto' },
            ]);
        });
    });

    await describe('columnViewSort — gtk_column_view_sorter_add_column', async () => {
        const [name, size] = normalizeColumnViewColumns([
            { key: 'label', id: 'name', sortable: true },
            { key: 'value', id: 'size', sortable: true },
        ]);
        const inert = normalizeColumnViewColumns([{ key: 'label', id: 'kind' }])[0]!;

        await it('a first click sorts ascending', () => {
            expect(columnViewSort(null, name!)).toStrictEqual({ column: 'name', descending: false });
        });

        await it('a second click on the primary column inverts it', () => {
            expect(columnViewSort({ column: 'name', descending: false }, name!)).toStrictEqual({
                column: 'name',
                descending: true,
            });
        });

        await it('a click on another column makes it primary, ascending', () => {
            expect(columnViewSort({ column: 'name', descending: true }, size!)).toStrictEqual({
                column: 'size',
                descending: false,
            });
        });

        await it('a column with no sorter is refused, as sorter == NULL is', () => {
            const current = { column: 'name', descending: false };
            expect(columnViewSort(current, inert)).toBe(current);
        });
    });
};
