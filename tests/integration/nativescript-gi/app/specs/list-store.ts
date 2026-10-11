// THE PORTABLE LIST MODEL OVER A REAL `Gio.ListStore`, ON THE DEVICE.
//
// The host twin is `packages/nativescript-bridge/gobject/src/list-store.node-gi.spec.ts`, and this
// mirrors its vector loop rather than importing it: a spec file is not published, and the half of
// it that matters here is the loop, not the three extra cases it adds about `g_list_store_splice`.
// Those are facts about Gio and the host leg already pins them down; what the DEVICE adds is that
// the same `Gio.ListStore` behaviour comes out of the typelibs in the APK.
//
// Three things per row, the same three the host leg measures: the numbers the real store emits,
// that there is exactly ONE emission, and that the item objects outside the splice are the SAME
// objects afterwards — identity in a live model, which is what a renderer's item views hang on.
//
// Only in the opted-in run: without an engine there is no `Gio` to put a model in, and a pure-JS
// stand-in would be `list.spec.ts` again, run slowly, on a phone.
import { LIST_ITEMS_CHANGED_VECTORS } from '@gjsify/adwaita-core/conformance';
import { createRealGioListStore, type RealGioListStore } from '@gjsify/adwaita-gobject-native';

import { describe, expect, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

/** Every item object currently in the store, by position — the identity half of a row. */
function itemsOf(model: RealGioListStore): unknown[] {
    const store = model.store as { get_n_items(): number; get_item(position: number): unknown };
    return Array.from({ length: store.get_n_items() }, (_unused, position) => store.get_item(position));
}

/** How many of `before`'s item objects are still in the store, by identity. */
function carriedOver(before: readonly unknown[], after: readonly unknown[]): number {
    return before.filter((item) => after.includes(item)).length;
}

export default async function listStoreVectors(): Promise<void> {
    await describe('real Gio.ListStore on an Android device: the portable items-changed', async () => {
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
                expect(model.read()).toStrictEqual([...vector.next]);
                expect(carriedOver(before, itemsOf(model))).toBe(vector.survivors);
            });
        }
    });
}
