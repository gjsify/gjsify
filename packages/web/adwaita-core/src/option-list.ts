// `GjsifyOptionList` — the core's OWN `Gio.ListModel`, for the door `Gtk.StringList` cannot serve.
//
// WHY A SECOND LIST MODEL EXISTS AT ALL. ADR 0122 § 6 narrows `Adw.ComboRow:model` and
// `Gtk.DropDown:model` to a real `Gio.ListModel`: an array written to either is a `TypeError`
// naming the type. That closes the PROPERTY door on arrays and leaves the MARKUP door open —
// `<adw-combo-row model='[{"value":"a","label":"Apple"}]'>` is a JSON attribute, and the
// conformance vectors, `gtk-drop-down.spec.ts` and the generated website data all pin the
// `{value,label}` descriptor it carries. Something has to turn that attribute into a model.
//
// `Gtk.StringList` CANNOT be that something, and the reason is one field. It holds
// `Gtk.StringObject`s, which hold a string and nothing else, so a descriptor round-tripped
// through one comes back with its `value` gone and every item addressable only by its display
// text. `{ value: 'de', label: 'Deutsch' }` would become `'Deutsch'`, and the two halves of the
// descriptor exist precisely because an author needs them to differ.
//
// WHY IT IS NOT CALLED `Adw*` OR `Gtk*`. There is no such type in libadwaita or GTK. A GTK
// author in this position reaches for `Gio.ListStore` plus a `GObject` subclass of their own, and
// this IS that subclass — written once, in the core, so four surfaces do not each invent one.
// Putting a library's prefix on it would claim a C type that can be looked up and is not there;
// `Gjsify` is the prefix this repository already uses for a type that is its own
// (`GjsifyCanvas2DBridge`, `GjsifyStandInFileFilter`).
//
// IT IS PURE JS ON EVERY LEG, for the reason `gtk-string-list.ts` states at length:
// `registerBaseClass` pins a core type to `PURE_JS_ENGINE`, so this is the same class on the
// browser, on GJS-through-the-subset and on the NativeScript host, and no engine below has to
// learn the word interface. That is also what lets an item satisfy `checkPropertyValue` for
// `selected-item`, which takes a registered `GObject` and nothing else.
//
// THE EMISSION RULE IS `Gtk.StringList`'s, because it is `GListModel`'s: `items-changed` first,
// then `notify::n-items` and only when the count moved, and neither when a splice removes
// nothing and adds nothing. Measured there against GJS 1.88.01 / GTK 4.22.5; not re-measured
// here, because a list model that emitted differently would be the odd one out.
//
// Reference: gio/glistmodel.h, gio/gliststore.c — `Gio.ListModel`'s `items-changed`,
// `g_list_store_splice`'s one-emission-per-change contract.
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

import { MAXUINT32 } from './glib-paths.js';
import { GObjectObject, ListModel, ParamFlags, ParamSpec, registerBaseClass, type GType } from './gobject.js';
import { INVALID_LIST_POSITION } from './gtk-string-list.js';
import { listItemsChanged, normalizeComboOptions, type AdwComboOption, type AdwComboOptionInput } from './list.js';

/** The two strings an item holds. State lives here, never in class fields (see `application.ts`). */
const OPTION = new WeakMap<object, AdwComboOption>();

/** The items a list holds, in order. */
const ITEMS = new WeakMap<object, GjsifyOptionObject[]>();

function notWritable(typeName: string, property: string): never {
    throw new Error(`Property ${typeName}.${property} is not writable`);
}

/**
 * One selectable item, as the `GObject` a `GListModel` is allowed to hand out.
 *
 * Both properties are READ-ONLY, and that is not caution: an item is what a model contains, and
 * a model reports a content change through `items-changed`. A writable `label` would let the
 * text under a selection move with nothing emitted, which is the failure
 * `GtkStringObject`'s read-only `string` exists to prevent.
 *
 * It deliberately has NO `string` property. `readListModel` unwraps an item that has one as a
 * bare string — that is `Gtk.StringObject`'s shape — and an option that answered to it would
 * lose its `value` on the way out, which is the whole reason this type exists.
 */
export class GjsifyOptionObject extends GObjectObject {
    constructor(props?: Record<string, unknown> | null) {
        // Both properties are declared READABLE only, so a bag naming either reaches the accessor
        // below and raises the same refusal an assignment raises. Anything else falls through to
        // `No property … on GjsifyOptionObject`.
        super(props ?? undefined);
        if (!OPTION.has(this)) OPTION.set(this, { value: '', label: '' });
    }

    /** An item holding `value` and `label` — the only way to put either in one. */
    static new(value: string, label: string): GjsifyOptionObject {
        const item = new GjsifyOptionObject();
        OPTION.set(item, { value: String(value), label: String(label) });
        return item;
    }

    /** An item for one authored entry, through the normaliser every surface already shares. */
    static fromInput(entry: AdwComboOptionInput): GjsifyOptionObject {
        const [option] = normalizeComboOptions([entry]);
        return GjsifyOptionObject.new(option!.value, option!.label);
    }

    /** The value this item is addressed by. */
    get value(): string {
        return OPTION.get(this)!.value;
    }

    set value(_value: string) {
        notWritable('GjsifyOptionObject', 'value');
    }

    /** The text this item draws as. */
    get label(): string {
        return OPTION.get(this)!.label;
    }

    set label(_value: string) {
        notWritable('GjsifyOptionObject', 'label');
    }

    /** The descriptor this item holds, as a COPY — nothing hands out the stored record. */
    toOption(): AdwComboOption {
        const option = OPTION.get(this)!;
        return { value: option.value, label: option.label };
    }
}

registerBaseClass(GjsifyOptionObject as never, 'GjsifyOptionObject', {}, [
    ParamSpec.string('value', '', '', ParamFlags.READABLE, ''),
    ParamSpec.string('label', '', '', ParamFlags.READABLE, ''),
]);

/** What `new GjsifyOptionList({ … })` takes. */
export interface GjsifyOptionListProps {
    /** The options the list starts with, in any form {@link normalizeComboOptions} accepts. */
    options?: readonly AdwComboOptionInput[] | null;
}

/**
 * A `Gio.ListModel` of {@link GjsifyOptionObject}s — what a `model` property holds once the
 * array door is closed.
 *
 * `new GjsifyOptionList()` is empty. The instance is a GObject with a real identity, so a
 * `model` write that assigns the SAME list again is the no-op GTK makes it, and
 * `row.model === list` answers true.
 */
export class GjsifyOptionList extends GObjectObject {
    /** Installed by the core from {@link ListModel}; declared here for the type alone. */
    declare readonly get_item: (position: number) => GjsifyOptionObject | null;
    declare readonly get_item_type: () => GType;
    declare readonly get_n_items: () => number;
    declare readonly items_changed: (position: number, removed: number, added: number) => void;

    constructor(props?: GjsifyOptionListProps | null) {
        // `options` is filled here rather than declared as a ParamSpec, for `Gtk.StringList:strings`'
        // reason one level over: it is the construct argument, not a readable property, and
        // declaring it would define a readable own property no such type has.
        const rest = { ...props } as Record<string, unknown>;
        delete rest['options'];
        super(rest);
        ITEMS.set(
            this,
            (props?.options ?? []).map((entry) => GjsifyOptionObject.fromInput(entry)),
        );
    }

    /** A list holding `options`, or an empty one for `null` — the markup door's constructor. */
    static new(options: readonly AdwComboOptionInput[] | null): GjsifyOptionList {
        return new GjsifyOptionList({ options });
    }

    /** The item type, which here is the specific one: this list holds nothing else. */
    get item_type(): GType {
        return (GjsifyOptionObject as unknown as { $gtype: GType }).$gtype;
    }

    set item_type(_value: GType) {
        notWritable('GjsifyOptionList', 'item-type');
    }

    get itemType(): GType {
        return this.item_type;
    }

    set itemType(_value: GType) {
        notWritable('GjsifyOptionList', 'item-type');
    }

    /** `n-items` — the `ParamSpec`'s reader, and `get_n_items`'s answer. */
    get n_items(): number {
        return ITEMS.get(this)!.length;
    }

    set n_items(_value: number) {
        notWritable('GjsifyOptionList', 'n-items');
    }

    /** `vfunc_get_item_type` — what the interface's `get_item_type()` calls through to. */
    vfunc_get_item_type(): GType {
        return this.item_type;
    }

    /** `vfunc_get_n_items`. */
    vfunc_get_n_items(): number {
        return this.n_items;
    }

    /** `vfunc_get_item` — `null` past the end, as `g_list_model_get_item` returns `NULL`. */
    vfunc_get_item(position: number): GjsifyOptionObject | null {
        return ITEMS.get(this)![position] ?? null;
    }

    /** The descriptors this list holds, as copies — the form every renderer draws from. */
    toOptions(): AdwComboOption[] {
        return ITEMS.get(this)!.map((item) => item.toOption());
    }

    /** One more option at the end. */
    append(option: AdwComboOptionInput): void {
        this.splice(this.n_items, 0, [option]);
    }

    /** The option at `position`, which must be in range. */
    remove(position: number): void {
        this.splice(position, 1, []);
    }

    /**
     * `g_list_store_splice(position, n_removals, additions)` — the C signature, all three
     * arguments, additions as ONE array, so a hundred-item replacement is one emission.
     *
     * Out of range is a CRITICAL and a no-op rather than an exception, which is the shape
     * `Gtk.StringList` measured for the same call: this door is reachable from a markup
     * attribute, and an author's slip must not take the widget down.
     */
    splice(position: number, nRemovals: number, additions: readonly AdwComboOptionInput[] | null): void {
        this.spliceItems(
            position,
            nRemovals,
            (additions ?? []).map((entry) => GjsifyOptionObject.fromInput(entry)),
        );
    }

    /**
     * The POSITION of the first option with this value, {@link INVALID_LIST_POSITION} when there
     * is none — `gtk_string_list_find`'s meaning of the name, over the half a descriptor is
     * addressed by.
     */
    find(value: string): number {
        const index = ITEMS.get(this)!.findIndex((item) => item.value === value);
        return index === -1 ? INVALID_LIST_POSITION : index;
    }

    /**
     * Replace the contents with `next` IN PLACE, as the ONE splice that turns one into the
     * other — {@link listItemsChanged}'s minimal range.
     *
     * This is the markup door's update path and it keeps the list's IDENTITY, which is what
     * makes it different from a `model` write. Re-parsing an attribute must not look to the
     * widget like a new model: a model REPLACEMENT re-runs autoselect and resets the selection
     * to 0 (ADR 0122 § 4, measured), while appending one option to the end of the list the
     * widget already holds moves nothing. An author editing `model='[…]'` means the second.
     */
    reconcile(next: readonly AdwComboOptionInput[] | null): void {
        const options = normalizeComboOptions(next ?? []);
        const change = listItemsChanged(this.toOptions(), options);
        if (!change) return;
        this.spliceItems(
            change.position,
            change.removed,
            options
                .slice(change.position, change.position + change.added)
                .map((option) => GjsifyOptionObject.new(option.value, option.label)),
        );
    }

    /** The one mutation, so the emission rule is written once. See the file header. */
    private spliceItems(position: number, nRemovals: number, added: readonly GjsifyOptionObject[]): void {
        const items = ITEMS.get(this)!;
        if (!Number.isFinite(position) || position < 0 || position + nRemovals > items.length) {
            console.warn(
                "GLib-GIO-CRITICAL: g_list_store_splice: assertion 'position + n_removals <= " + "n_items' failed",
            );
            return;
        }
        if (nRemovals === 0 && added.length === 0) return;
        items.splice(position, nRemovals, ...added);
        this.items_changed(position, nRemovals, added.length);
        if (nRemovals !== added.length) this.notify('n-items');
    }
}

registerBaseClass(
    GjsifyOptionList as never,
    'GjsifyOptionList',
    {},
    [ParamSpec.uint('n-items', '', '', ParamFlags.READABLE, 0, MAXUINT32, 0)],
    [ListModel],
);
