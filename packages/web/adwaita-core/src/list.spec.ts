// The portable list model, held to its own vectors (ADR 0046).
//
// This suite asserts the FUNCTIONS. What the renderers add on top of it is the half no
// pure test can reach: that a splice actually leaves item views standing —
// `adw-row-state.spec.ts` and `gtk-drop-down.spec.ts` compare node IDENTITY across an
// assignment, which is the difference between this module being correct and it being used.
import { describe, expect, it } from '@gjsify/unit';

import {
    LIST_ITEMS_CHANGED_VECTORS,
    LIST_NORMALIZE_VECTORS,
    LIST_PARSE_VECTORS,
    LIST_SELECTION_CLAMP_VECTORS,
    TAB_PAGES_ITEMS_CHANGED_VECTORS,
    replayTabPagesAsSplices,
} from './conformance/list.js';
import { clampListSelection, listItemsChanged, normalizeComboOptions, parseListModel } from './list.js';
import { tabViewItemsChanged } from './tab-view.js';

export default async () => {
    await describe('normalizeComboOptions (the item vocabulary)', async () => {
        for (const vector of LIST_NORMALIZE_VECTORS) {
            await it(vector.rule, () => {
                expect(normalizeComboOptions(vector.input)).toStrictEqual([...vector.model]);
            });
        }

        await it('answers the empty model for input that is not an array at all', () => {
            // The property door takes whatever a caller assigns, and `.map` on a non-array
            // would throw out of a setter nobody is in a position to catch.
            expect(normalizeComboOptions(null)).toStrictEqual([]);
            expect(normalizeComboOptions(undefined)).toStrictEqual([]);
        });

        await it('is idempotent, so a renderer may hand its own model back in', () => {
            const once = normalizeComboOptions(['a', { label: 'B' }]);
            expect(normalizeComboOptions(once)).toStrictEqual(once);
        });
    });

    await describe('parseListModel (the JSON attribute door)', async () => {
        for (const vector of LIST_PARSE_VECTORS) {
            await it(vector.rule, () => {
                expect(parseListModel(vector.attribute)).toStrictEqual([...vector.model]);
            });
        }

        await it('treats an absent attribute as the empty model', () => {
            expect(parseListModel(null)).toStrictEqual([]);
        });
    });

    await describe('listItemsChanged (Gio.ListModel::items-changed)', async () => {
        for (const vector of LIST_ITEMS_CHANGED_VECTORS) {
            await it(vector.rule, () => {
                const change = listItemsChanged(vector.previous, vector.next);
                expect(change).toStrictEqual(vector.change === null ? null : { ...vector.change });
                // The survivor count is the renderer's contract, so it is derived from the
                // splice HERE and asserted against the widgets there — two readings of one
                // number rather than a figure only the renderer suites can be wrong about.
                expect(vector.previous.length - (change?.removed ?? 0)).toBe(vector.survivors);
            });
        }

        await it('applying the splice reproduces the new model, for every row', () => {
            // The property that makes it a MODEL signal rather than an invalidation ping.
            for (const vector of LIST_ITEMS_CHANGED_VECTORS) {
                const change = listItemsChanged(vector.previous, vector.next);
                const applied = [...vector.previous];
                if (change) {
                    applied.splice(
                        change.position,
                        change.removed,
                        ...vector.next.slice(change.position, change.position + change.added),
                    );
                }
                expect(applied).toStrictEqual([...vector.next]);
            }
        });
    });

    await describe('clampListSelection (GtkSingleSelection autoselect)', async () => {
        for (const vector of LIST_SELECTION_CLAMP_VECTORS) {
            await it(vector.rule, () => {
                expect(clampListSelection(vector.selected, vector.length)).toBe(vector.result);
            });
        }
    });

    await describe('tabViewItemsChanged (the one signal that already had this shape)', async () => {
        for (const vector of TAB_PAGES_ITEMS_CHANGED_VECTORS) {
            await it(vector.rule, () => {
                expect(tabViewItemsChanged(vector.change)).toStrictEqual({ ...vector.itemsChanged });
                expect(replayTabPagesAsSplices(vector.before, [vector.change])).toStrictEqual([...vector.after]);
            });
        }
    });
};
