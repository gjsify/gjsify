// `Gtk.ListBox` / `Gtk.FlowBox` selection rules, held to gtklistbox.c and gtkflowbox.c
// (ADR 0089).
//
// The suite is the conformance tables plus the two properties a table cannot express: that
// the anchor survives a `Shift`-extend (so a second extend grows the range rather than
// sliding it), and that a second identical click is a no-op through the programmatic door.
import { describe, expect, it } from '@gjsify/unit';

import { BOX_ALL_VECTORS, BOX_ROW_VECTORS, BOX_SELECT_VECTORS } from './conformance/box-selection.js';
import {
    listBoxSelect,
    listBoxSelectAll,
    listBoxSelectRow,
    listBoxUnselectAll,
    listBoxUnselectRow,
    normalizeBoxSelectionMode,
} from './box-selection.js';

export default async () => {
    await describe('the select vectors, through listBoxSelect', async () => {
        for (const vector of BOX_SELECT_VECTORS) {
            await it(vector.rule, () => {
                expect(
                    listBoxSelect(
                        vector.selection,
                        vector.anchor,
                        vector.position,
                        vector.length,
                        vector.mode,
                        vector.step,
                        vector.step.selectable ?? true,
                    ),
                ).toStrictEqual(vector.expected);
            });
        }
    });

    await describe('the programmatic row vectors', async () => {
        for (const vector of BOX_ROW_VECTORS) {
            await it(vector.rule, () => {
                const result =
                    vector.op === 'select'
                        ? listBoxSelectRow(
                              vector.selection,
                              vector.anchor,
                              vector.position,
                              vector.length,
                              vector.mode,
                              vector.step.selectable ?? true,
                          )
                        : listBoxUnselectRow(
                              vector.selection,
                              vector.anchor,
                              vector.position!,
                              vector.length,
                              vector.mode,
                          );
                expect(result).toStrictEqual(vector.expected);
            });
        }
    });

    await describe('the select-all / unselect-all vectors', async () => {
        for (const vector of BOX_ALL_VECTORS) {
            await it(vector.rule, () => {
                const result =
                    vector.op === 'select-all'
                        ? listBoxSelectAll(vector.length, vector.mode)
                        : listBoxUnselectAll(vector.selection, vector.mode);
                expect(result).toStrictEqual(vector.expected);
            });
        }
    });

    await describe('the anchor is what makes a second Shift-extend grow the range', async () => {
        await it('the span grows from the FIRST click, not from the last', () => {
            // Click row 1, then Shift-click row 4, then Shift-click row 5. The C leaves
            // `selected_row` where the first branch found it (gtklistbox.c:1849), so the last
            // two steps produce 1-4 and 1-5 rather than 4-5.
            const first = listBoxSelect([], -1, 1, 8, 'multiple', {});
            expect(first).toStrictEqual({ selection: [1], anchor: 1 });
            const second = listBoxSelect(first.selection, first.anchor, 4, 8, 'multiple', { extend: true });
            expect(second).toStrictEqual({ selection: [1, 2, 3, 4], anchor: 1 });
            const third = listBoxSelect(second.selection, second.anchor, 5, 8, 'multiple', { extend: true });
            expect(third).toStrictEqual({ selection: [1, 2, 3, 4, 5], anchor: 1 });
        });

        await it('Ctrl+click does not move the anchor, so a later extend measures from it', () => {
            const plain = listBoxSelect([], -1, 1, 8, 'multiple', {});
            const toggled = listBoxSelect(plain.selection, plain.anchor, 5, 8, 'multiple', { modify: true });
            expect(toggled).toStrictEqual({ selection: [1, 5], anchor: 1 });
            const extended = listBoxSelect(toggled.selection, toggled.anchor, 3, 8, 'multiple', { extend: true });
            expect(extended).toStrictEqual({ selection: [1, 2, 3], anchor: 1 });
        });
    });

    await describe('normalizeBoxSelectionMode', async () => {
        await it('passes the four GtkSelectionMode nicks through', () => {
            for (const mode of ['none', 'single', 'browse', 'multiple'] as const) {
                expect(normalizeBoxSelectionMode(mode)).toBe(mode);
            }
        });

        await it('falls back to single, the ParamSpec default, for anything else', () => {
            for (const raw of [null, undefined, '', 'SINGLE', 'multi', 3, {}]) {
                expect(normalizeBoxSelectionMode(raw)).toBe('single');
            }
        });
    });

    await describe('the two doors are not interchangeable', async () => {
        // The incident this guards: one function for "the user clicked row 2" and "the
        // application called select_row(row 2)" makes the second CLEAR the selection in single
        // mode, because the click's `!was_selected` is what the programmatic path does not have.
        await it('select_row on the selected row keeps it, where a click would clear it', () => {
            expect(listBoxSelect([2], 2, 2, 5, 'single', { modify: true }).selection).toStrictEqual([]);
            expect(listBoxSelectRow([2], 2, 2, 5, 'single').selection).toStrictEqual([2]);
        });

        await it('unselect_row outside multiple mode clears the box, not the row', () => {
            expect(listBoxUnselectRow([0, 1, 2], 2, 1, 5, 'single').selection).toStrictEqual([]);
            expect(listBoxUnselectRow([0, 1, 2], 2, 1, 5, 'multiple').selection).toStrictEqual([0, 2]);
        });

        await it('a null row clears the anchor as well as the selection', () => {
            expect(listBoxSelectRow([1, 4], 4, null, 5, 'multiple')).toStrictEqual({ selection: [], anchor: -1 });
        });
    });
};
