// THE PORTABLE LIST MODEL OVER A REAL `Gio.ListStore` (ADR 0105 stage 3, the `GListModel` half).
//
// `LIST_ITEMS_CHANGED_VECTORS` says what `items-changed` a model replacement should emit, and the
// table was derived from `g_list_store_splice`'s documented shape — one emission per change. Three
// surfaces assert it against plain arrays (`list.spec.ts` drives the function, the browser
// selectors drive their `model` property, and both compare node identity across an assignment).
// None of them had a real `GListModel` underneath, so the borrowed shape was never checked against
// the library it was borrowed from. That is this file: every row driven through a real
// `Gio.ListStore`, with the store's OWN `items-changed` as the witness.
//
// THREE THINGS ARE MEASURED PER ROW, and only the first is what the pure leg already knows:
//   1. the three numbers the real store emits are the three `listItemsChanged` computed;
//   2. there is exactly ONE emission — the property the splice exists for, which an
//      item-at-a-time implementation would fail while every number still read correct;
//   3. `survivors` is item IDENTITY in the store: the real item objects outside the splice are the
//      SAME objects afterwards. In pure JS that number is derived arithmetic (`previous.length -
//      removed`); here it is counted off the live model, which is what a renderer's item views
//      actually hang on.
//
// WHY `requireGi` IS A PARAMETER: `engine.ts`'s header.

import { describe, expect, it } from '@gjsify/unit';

import { LIST_ITEMS_CHANGED_VECTORS } from '@gjsify/adwaita-core/conformance';

import { createRealGioListStore, type RealGioListStore } from './list-store.js';
import type { RequireGi } from './engine.js';

/** Every item object currently in the store, by position — the identity half of a row. */
function itemsOf(model: RealGioListStore): unknown[] {
    const store = model.store as { get_n_items(): number; get_item(position: number): unknown };
    return Array.from({ length: store.get_n_items() }, (_unused, position) => store.get_item(position));
}

/** How many of `before`'s item objects are still in the store, by identity. */
function carriedOver(before: readonly unknown[], after: readonly unknown[]): number {
    return before.filter((item) => after.includes(item)).length;
}

export const realGioListStoreSuite = (requireGi: RequireGi) => async () => {
    await describe('real Gio.ListStore: the portable items-changed (ADR 0046 over ADR 0105)', async () => {
        for (const vector of LIST_ITEMS_CHANGED_VECTORS) {
            await it(vector.rule, () => {
                const model = createRealGioListStore(requireGi);
                model.setModel(vector.previous);
                const before = itemsOf(model);

                const emitted: unknown[] = [];
                const off = model.onItemsChanged((change) => emitted.push(change));
                const answered = model.setModel(vector.next);
                off();

                const expected = vector.change === null ? [] : [{ ...vector.change }];
                expect(emitted).toStrictEqual(expected);
                expect(answered).toStrictEqual(vector.change === null ? null : { ...vector.change });
                // The store itself now reads as the new model — the signal describes a change
                // that really happened, rather than one the caller was told about.
                expect(model.read()).toStrictEqual([...vector.next]);
                expect(carriedOver(before, itemsOf(model))).toBe(vector.survivors);
            });
        }
    });

    await describe('real Gio.ListStore: what the real store adds (ADR 0105 stage 3)', async () => {
        // The measurement the `null` rests on. `g_list_store_splice` emits `items-changed`
        // UNCONDITIONALLY, so the portable rule "an equal model emits NOTHING, as GTK does" is
        // kept by NOT splicing — never by splicing zeros. In pure JS the two are the same
        // no-op and nothing could tell them apart; here the difference is one spurious signal
        // every listener has to re-read the model for.
        await it('a zero splice is NOT free: the store emits (position, 0, 0) for it', () => {
            const model = createRealGioListStore(requireGi);
            model.setModel([{ value: 'a', label: 'A' }]);

            const emitted: unknown[] = [];
            const off = model.onItemsChanged((change) => emitted.push(change));
            (model.store as { splice(p: number, r: number, a: readonly unknown[]): void }).splice(1, 0, []);
            const viaSetModel = model.setModel([{ value: 'a', label: 'A' }]);
            off();

            expect([emitted, viaSetModel]).toStrictEqual([[{ position: 1, removed: 0, added: 0 }], null]);
        });

        await it('holds the portable descriptor through a real GObject property round-trip', () => {
            // Both halves survive the store, including the two the vectors pin down as edges:
            // an empty value is a value, and neither half may come back as the other's.
            const model = createRealGioListStore(requireGi);
            model.setModel([
                { value: '', label: 'blank' },
                { value: 'k', label: 'k' },
            ]);
            expect(model.read()).toStrictEqual([
                { value: '', label: 'blank' },
                { value: 'k', label: 'k' },
            ]);
        });

        await it('is a real GListModel: a second store in one process registers its own item type', () => {
            // A GType name is process-global and a duplicate THROWS, so this is what a consumer
            // with two combo rows does, and it is the reason the item type is per store.
            const first = createRealGioListStore(requireGi);
            const second = createRealGioListStore(requireGi);
            first.setModel([{ value: 'a', label: 'A' }]);
            second.setModel([{ value: 'b', label: 'B' }]);
            expect([first.read(), second.read()]).toStrictEqual([
                [{ value: 'a', label: 'A' }],
                [{ value: 'b', label: 'B' }],
            ]);
        });
    });
};
