// The portable list model over a REAL `Gio.ListStore` — ADR 0105 stage 3, the `GListModel` half.
//
// `@gjsify/adwaita-core`'s `list.ts` carries the portable model as plain data plus ONE function:
// `listItemsChanged(previous, next)` computes the single minimal splice that turns one into the
// other, which is `g_list_store_splice`'s shape and is the whole reason a renderer can append to a
// hundred-item list by adding one node. That function has always been held against vectors it
// shares with the browser and NativeScript surfaces — and never against the library whose shape it
// borrows. This module is that: the same arithmetic, applied to a real `Gio.ListStore`.
//
// WHAT IT ADDS BESIDE A TEST. A consumer that has real Gio (Android through node-gi, ADR 0104) can
// hand `store` to anything that wants a `GListModel` — `Adw.ComboRow:model`, `Gtk.DropDown:model`
// — while the splice arithmetic, the item vocabulary and the "an equal model changes nothing" rule
// stay the core's. Nothing here decides; it only applies.
//
// THE `null` IS LOAD-BEARING, measured. `g_list_store_splice` emits `items-changed`
// UNCONDITIONALLY: a `splice(3, 0, [])` on a real store emits `(3, 0, 0)` — a change of nothing,
// which every listener must then re-read for (measured on node-gi, GLib 2.86). The portable rule
// "an equal model emits NOTHING, as GTK does" therefore cannot be implemented by splicing with
// zeros; it is implemented by not calling `splice` at all, which is exactly what
// `listItemsChanged`'s `null` says. Backing the model with the real store is what makes that
// visible: in pure JS the no-op and the zero-splice are indistinguishable.
//
// WHY THE ITEM IS A GObject AND NOT THE PLAIN DESCRIPTOR. A `GListStore` holds GObjects — its
// `item-type` is a GType and `g_list_store_splice` type-checks every addition. So each portable
// `{value, label}` is carried by one real item object. `read()` turns them back, so a caller that
// only wants the portable model never sees them.
//
// Copyright (c) GNOME contributors (GLib/GTK). LGPLv2.1+.

import { listItemsChanged } from '@gjsify/adwaita-core';
import type { AdwComboOption, AdwListItemsChanged, AdwListModel } from '@gjsify/adwaita-core';
import type { RequireGi } from './engine.js';

/** How many stores this module has built — the GType-name counter, see below. */
let stores = 0;

/** One real list item: a GObject carrying the portable descriptor's two halves. */
interface RealItem {
    [property: string]: unknown;
    value: string;
    label: string;
}

/** As much of a real `Gio.ListStore` as this module uses. */
interface RealStore {
    get_n_items(): number;
    get_item(position: number): RealItem | null;
    splice(position: number, removals: number, additions: readonly RealItem[]): void;
    connect(signal: string, handler: (...args: unknown[]) => unknown): number;
    disconnect(id: number): void;
}

/** The portable list model, stored in a real `Gio.ListStore`. */
export interface RealGioListStore {
    /**
     * The real `Gio.ListStore`. This is the value a GTK widget's `model` property takes — handed
     * out untyped because the typed one would need `@girs/gio-2.0`, which this package does not
     * depend on for the reason `engine.ts`'s header gives.
     */
    readonly store: unknown;
    /** The store's content, read back OUT of it as portable items. */
    read(): AdwComboOption[];
    /**
     * Replace the content with `next` and answer the one `items-changed` the store emitted, or
     * `null` when nothing was spliced because the two models are equal.
     *
     * Items outside the splice carry over as the SAME item objects: a consumer holding an item
     * view per item keeps it, which is what the portable vectors' `survivors` counts.
     */
    setModel(next: AdwListModel | null | undefined): AdwListItemsChanged | null;
    /** Subscribe to the store's REAL `items-changed`; the returned function disconnects. */
    onItemsChanged(handler: (change: AdwListItemsChanged) => void): () => void;
}

/**
 * A portable list model whose store is a real `Gio.ListStore`.
 *
 * `requireGi` is injected for the same reason the engine's is — see `engine.ts`'s header.
 */
export function createRealGioListStore(requireGi: RequireGi): RealGioListStore {
    const GObject = requireGi('GObject', '2.0') as {
        registerClass(
            meta: Record<string, unknown>,
            klass: Function,
        ): new (props?: Record<string, unknown>) => RealItem;
        Object: new () => unknown;
        ParamSpec: { string(n: string, k: string, b: string, f: number, v?: string): unknown };
        ParamFlags: Record<string, number>;
    };
    const Gio = requireGi('Gio', '2.0') as {
        ListStore: new (props: Record<string, unknown>) => RealStore;
    };

    const flags = GObject.ParamFlags.READWRITE;
    // One GType per store rather than one per process: a GType name is process-global and a
    // duplicate THROWS, so a module-level registration would make a second store in the same
    // process fail — and a counter here is cheaper than a registry keyed on a `requireGi`.
    const Item = GObject.registerClass(
        {
            GTypeName: `AdwPortableListItem_RealGio${++stores}`,
            Properties: {
                value: GObject.ParamSpec.string('value', 'Value', 'The value the item is addressed by', flags, ''),
                label: GObject.ParamSpec.string('label', 'Label', 'The text the item draws', flags, ''),
            },
        },
        class AdwPortableListItem extends (GObject.Object as new () => object) {},
    );

    const store = new Gio.ListStore({ item_type: (Item as unknown as { $gtype: unknown }).$gtype });

    function read(): AdwComboOption[] {
        const items: AdwComboOption[] = [];
        for (let position = 0; position < store.get_n_items(); position++) {
            const item = store.get_item(position);
            if (item) items.push({ value: item.value, label: item.label });
        }
        return items;
    }

    return {
        store,
        read,
        setModel(next) {
            const change = listItemsChanged(read(), next ?? []);
            if (!change) return null;
            const additions = (next ?? [])
                .slice(change.position, change.position + change.added)
                .map(({ value, label }) => new Item({ value, label }));
            store.splice(change.position, change.removed, additions);
            return change;
        },
        onItemsChanged(handler) {
            const id = store.connect('items-changed', (_store, position, removed, added) =>
                handler({ position: position as number, removed: removed as number, added: added as number }),
            );
            return () => store.disconnect(id);
        },
    };
}
