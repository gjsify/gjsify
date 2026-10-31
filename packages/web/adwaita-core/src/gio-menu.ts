// `Gio.MenuModel`, `Gio.Menu` and `Gio.MenuItem` — a REAL menu model (ADR 0128).
//
// WHAT CHANGED, AND WHY (ADR 0128, amending ADR 0042). `GioMenu` used to be an `Array`
// subclass and `AdwMenuModel` a `readonly AdwMenuNode[]`: `menuModel: menu` and
// `menuModel: [...]` were the same write, no widget had to learn a second shape, and the
// cost was that a GJS author's `menu.get_n_items()`, `menu.append(…)` after the write and
// `menu.connect('items-changed', …)` all answered nothing. ADR 0042 accepted that because
// no surface consumed a menu AS a model. The widgets now do: `menu-model` is declared
// `value_type=GMenuModel` on both `Adw.SplitButton` and `Gtk.MenuButton` (measured), a
// mutation of a HELD menu arrives over `items-changed` and never over `notify`, and there
// is no way to say that over an array without inventing a second vocabulary beside GIO's.
// So the menu became what GIO says it is, and the array door closed.
//
// THE BASE IS AN ABSTRACT CLASS, NOT AN INTERFACE, and that is the one place a reader
// coming from ADR 0122's string list guesses wrong. `Gio.ListModel` IS an interface and
// the subset's whole `ACCEPTED_INTERFACES` apparatus exists for it; `Gio.MenuModel` is a
// class — `new Gio.MenuModel()` throws `Cannot instantiate abstract type GMenuModel`,
// `GObject.type_parent(Gio.Menu)` is `GMenuModel` with nothing in between, and
// `items-changed` is declared on the BASE. So {@link GioMenuModel} is registered with
// `registerBaseClass` under the GType `GMenuModel`, carries the signal, and
// {@link GioMenu} inherits it. A port that copied the string list wholesale would have
// invented an interface GTK does not have.
//
// WHAT IT COSTS, SPELLED OUT. `length`, `menu[0]`, `map`, `filter` and spread are gone,
// because a real `Gio.Menu` has none of them. `Array.isArray(menu)` is now FALSE, which is
// what makes the array door closed rather than merely discouraged: `normalizeMenuModel`
// gates on it, so an array is still an AUTHORED input and a menu is no longer one.
// {@link buildMenu} is the one-way street between them.
//
// IT IS PURE JS ON EVERY LEG — `registerBaseClass` pins it to `PURE_JS_ENGINE`, so this is
// the class on the browser, on GJS-through-the-subset and on the NativeScript host alike,
// and `items-changed` is an ordinary declared signal no engine below has to know about.
//
// MEASURED AGAINST GJS 1.88 / GTK 4.22, and the measurements are the vectors in
// `conformance/menu.ts` rather than prose here: ONE `items-changed` per mutator with the
// triple each one emits; `remove_all()` on an EMPTY menu STILL emits `(0, 0, 0)`, so the
// no-op skip that is right for `Gtk.StringList` is wrong here; a link read hands back the
// INSTANCE while an item read is a SNAPSHOT; a link's `items-changed` does NOT bubble to
// the menu holding it; `freeze()` flips `is_mutable()` and locks nothing.
//
// WHERE IT DIVERGES, each row in `MENU_MODEL_DIVERGENCE_VECTORS`: the two out-of-range
// reads (GIO's attribute read SEGFAULTS, so there is no behaviour to copy and this one
// answers `null`), the `icon` attribute (GIO's is a serialised `GIcon` as `(sv)`, which is
// outside ADR 0118 § 2's variant subset, so the port carries an icon NAME as `s`), and the
// varargs getters GJS cannot call at all.
//
// Reference: @girs/gio-2.0 — `Gio.MenuModel`, `Gio.Menu`, `Gio.MenuItem`,
// `Gio.MenuAttributeIter`, `Gio.MenuLinkIter`; glib/gio/gmenumodel.c, gio/gmenu.c.
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

import { Variant } from './glib-variant.js';
import {
    checkPropertyValue,
    GIR_TYPE,
    GObjectObject,
    ParamFlags,
    ParamSpec,
    registerBaseClass,
    registeredClassOf,
    TYPE_OBJECT,
    TYPE_UINT,
} from './gobject.js';
import type { GType } from './gobject.js';
import { normalizeMenuModel, parseMenuModel } from './menu.js';
import type { AdwMenuInput, AdwMenuNode, AdwMenuTree } from './menu.js';

/** `G_MENU_ATTRIBUTE_ACTION`. */
export const MENU_ATTRIBUTE_ACTION = 'action';

/** `G_MENU_ATTRIBUTE_ACTION_NAMESPACE` — carried, and never interpreted by the port. */
export const MENU_ATTRIBUTE_ACTION_NAMESPACE = 'action-namespace';

/** `G_MENU_ATTRIBUTE_ICON`. The NAME is shared with GIO even where the type diverges. */
export const MENU_ATTRIBUTE_ICON = 'icon';

/** `G_MENU_ATTRIBUTE_LABEL`. */
export const MENU_ATTRIBUTE_LABEL = 'label';

/** `G_MENU_ATTRIBUTE_TARGET` — the one attribute whose variant type varies by target. */
export const MENU_ATTRIBUTE_TARGET = 'target';

/** `G_MENU_LINK_SECTION`. */
export const MENU_LINK_SECTION = 'section';

/** `G_MENU_LINK_SUBMENU`. */
export const MENU_LINK_SUBMENU = 'submenu';

/**
 * `G_MENU_EXPORTER_MAX_SECTION_SIZE`.
 *
 * Nothing in the port enforces it and nothing should — it is a D-Bus exporter limit. It is
 * exported so a caller reading it is handed the real number rather than `undefined`, which
 * is the failure mode of a port that exports only the constants it happens to use itself.
 */
export const MENU_EXPORTER_MAX_SECTION_SIZE = 1000;

/** What one position of a menu holds: its attributes and its links, both open vocabularies. */
interface MenuEntry {
    attributes: Map<string, Variant>;
    links: Map<string, GioMenuModel>;
}

/** The entries a menu holds, in order. State lives here, never in class fields. */
const ENTRIES = new WeakMap<object, MenuEntry[]>();

/** Whether `freeze()` has been called — a FLAG, not a lock (measured). */
const FROZEN = new WeakSet<object>();

/** What an item carries before it is appended; an item is a snapshot and never shared. */
const ITEM_ENTRY = new WeakMap<object, MenuEntry>();

/** Where one attribute iterator stands. A GIO iterator starts BEFORE the first entry. */
const ATTRIBUTE_CURSOR = new WeakMap<object, { entries: Array<readonly [string, Variant]>; index: number }>();

/** Where one link iterator stands, over the linked MODELS rather than over copies. */
const LINK_CURSOR = new WeakMap<object, { entries: Array<readonly [string, GioMenuModel]>; index: number }>();

const emptyEntry = (): MenuEntry => ({ attributes: new Map(), links: new Map() });

const copyEntry = (entry: MenuEntry): MenuEntry => ({
    attributes: new Map(entry.attributes),
    links: new Map(entry.links),
});

/** `g_action_name_is_valid`: alnum, `.` and `-`, non-empty — and NOT `_` (measured). */
function actionNameIsValid(name: string): boolean {
    if (name.length === 0) return false;
    for (const char of name) {
        const alnum = (char >= '0' && char <= '9') || (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
        if (!alnum && char !== '.' && char !== '-') return false;
    }
    return true;
}

function invalidDetailedAction(detailed: string): never {
    throw new Error(`Detailed action name '${detailed}' has invalid format`);
}

const INTEGER_TARGET = /^[+-]?[0-9]+$/;
const DOUBLE_TARGET = /^[+-]?(?:[0-9]+\.[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

/**
 * One `GVariant` text target, in ADR 0118 § 2's subset — `b`, `i`, `d` and `s`.
 *
 * NOT a general `GVariant` parser, and the narrowing is the subset's rather than a
 * shortcut: a target outside it is refused with GIO's own words, so a caller learns at the
 * write instead of getting a target the model cannot carry. The three forms a menu
 * actually uses are measured — `win.zoom(2)` is `i`, `win.flag(true)` is `b`,
 * `app.view('list')` is `s` and the same target as `app.view::list`.
 */
function targetVariant(text: string, detailed: string): Variant {
    const first = text[0];
    if (text.length >= 2 && (first === "'" || first === '"') && text[text.length - 1] === first) {
        return new Variant('s', unescapeVariantString(text.slice(1, -1), first));
    }
    if (text === 'true' || text === 'false') return new Variant('b', text === 'true');
    if (INTEGER_TARGET.test(text)) return new Variant('i', Number(text));
    if (DOUBLE_TARGET.test(text)) return new Variant('d', Number(text));
    return invalidDetailedAction(detailed);
}

/** The two characters `GVariant` text escapes inside a quoted string, and no others. */
function unescapeVariantString(inner: string, quote: string): string {
    let out = '';
    for (let i = 0; i < inner.length; i += 1) {
        const char = inner[i] as string;
        const next = inner[i + 1];
        if (char === '\\' && (next === quote || next === '\\')) {
            out += next;
            i += 1;
            continue;
        }
        out += char;
    }
    return out;
}

/**
 * `g_action_parse_detailed_name`, as the twin's own refusal.
 *
 * THE REASON IT REFUSES AT ALL. On GTK, `g_menu_item_set_detailed_action` does not return
 * an error for a malformed name — it calls `g_error()`, which is a SIGABRT, uncatchable
 * from JS, and `@gjsify/gtk-host` guards the call for exactly that reason. The twin has no
 * process to lose, and it still refuses: a model that quietly stored `app.x(` would be a
 * menu the GTK leg cannot build, so the divergence would surface as a crash on the one
 * platform that cannot report it. Refusing on EVERY leg is what makes the model portable.
 */
function parseDetailedName(detailed: string): { name: string; target?: Variant } {
    const colons = detailed.indexOf('::');
    if (colons > 0) {
        const name = detailed.slice(0, colons);
        if (!actionNameIsValid(name)) invalidDetailedAction(detailed);
        return { name, target: new Variant('s', detailed.slice(colons + 2)) };
    }
    const open = detailed.indexOf('(');
    if (open > 0 && detailed.endsWith(')') && detailed.length > open + 2) {
        const name = detailed.slice(0, open);
        if (!actionNameIsValid(name)) invalidDetailedAction(detailed);
        return { name, target: targetVariant(detailed.slice(open + 1, -1), detailed) };
    }
    if (!actionNameIsValid(detailed)) invalidDetailedAction(detailed);
    return { name: detailed };
}

/** `g_action_print_detailed_name` — the inverse, and `::` for a string as GIO chooses. */
function printDetailedName(name: string, target: Variant | undefined): string {
    if (target === undefined) return name;
    return target.get_type_string() === 's'
        ? `${name}::${target.deepUnpack<string>()}`
        : `${name}(${target.print(false)})`;
}

// --- `Gio.MenuItem` — a SNAPSHOT, not a handle ------------------------------------------------

/**
 * One menu item, as `g_menu_item_new` builds one.
 *
 * IT IS A SNAPSHOT, and that is the measured fact a reader coming from the old `Array`
 * version gets wrong: appending an item COPIES what it carries, so a later `set_label` on
 * the same object does not reach the menu (`MENU_MODEL_DIVERGENCE_VECTORS`,
 * `item-is-a-snapshot`). It is a builder for one position, not a view onto it.
 *
 * Both halves of the constructor are nullable, as they are in C: `g_menu_item_new(NULL,
 * NULL)` is legal and produces an item carrying neither attribute.
 */
export class GioMenuItem extends GObjectObject {
    static [GIR_TYPE] = 'Gio.MenuItem';

    constructor(label: string | null = null, detailedAction: string | null = null) {
        super();
        ITEM_ENTRY.set(this, emptyEntry());
        this.set_label(label);
        this.set_detailed_action(detailedAction);
    }

    /** `g_menu_item_new_section` — an item whose whole content is the `section` link. */
    static new_section(label: string | null, section: GioMenuModel): GioMenuItem {
        const item = new GioMenuItem(label);
        item.set_section(section);
        return item;
    }

    /** `g_menu_item_new_submenu`. */
    static new_submenu(label: string | null, submenu: GioMenuModel): GioMenuItem {
        const item = new GioMenuItem(label);
        item.set_submenu(submenu);
        return item;
    }

    /**
     * `g_menu_item_new_from_model` — a COPY of what the model holds at `itemIndex`.
     *
     * The copy is the point: this is how an item is edited at all, since a position is not
     * addressable and {@link GioMenu.remove} plus an insert is the only way back in.
     */
    static new_from_model(model: GioMenuModel, itemIndex: number): GioMenuItem {
        const item = new GioMenuItem();
        const source = entryAt(model, itemIndex);
        if (source !== undefined) ITEM_ENTRY.set(item, copyEntry(source));
        return item;
    }

    /** `g_menu_item_set_label`. `null` REMOVES the attribute, which is what C does. */
    set_label(label: string | null): void {
        this.set_attribute_value(MENU_ATTRIBUTE_LABEL, label === null ? null : new Variant('s', label));
    }

    /**
     * `g_menu_item_set_detailed_action` — the action NAME and its target, parsed apart.
     *
     * The parse is why the model carries one string: `app.view::list` becomes `action` plus
     * a `target` of the target's own type, and {@link printDetailedName} puts it back
     * together. A malformed name is REFUSED here rather than stored — see
     * {@link parseDetailedName} for why that is the twin's own decision and not GIO's.
     */
    set_detailed_action(detailedAction: string | null): void {
        if (detailedAction === null) {
            this.set_action_and_target_value(null, null);
            return;
        }
        const { name, target } = parseDetailedName(detailedAction);
        this.set_action_and_target_value(name, target ?? null);
    }

    /** `g_menu_item_set_action_and_target_value`; a `null` action removes the target too. */
    set_action_and_target_value(action: string | null, target: Variant | null): void {
        if (action === null) {
            this.set_attribute_value(MENU_ATTRIBUTE_ACTION, null);
            this.set_attribute_value(MENU_ATTRIBUTE_TARGET, null);
            return;
        }
        this.set_attribute_value(MENU_ATTRIBUTE_ACTION, new Variant('s', action));
        this.set_attribute_value(MENU_ATTRIBUTE_TARGET, target);
    }

    /**
     * `g_menu_item_set_attribute_value`. `null` is a DELETE, never a stored empty value.
     *
     * A bare JS string is refused in GJS's own words (measured): the convenience of passing
     * text belongs to `g_menu_item_set_attribute`, which is varargs and therefore not part
     * of the surface a port owes.
     */
    set_attribute_value(name: string, value: Variant | null): void {
        const entry = ITEM_ENTRY.get(this)!;
        if (value === null || value === undefined) {
            entry.attributes.delete(name);
            return;
        }
        if (!(value instanceof Variant)) {
            throw new TypeError(
                `Expected an object of type GVariant for argument 'value' but got type ${typeof value}`,
            );
        }
        entry.attributes.set(name, value);
    }

    /** `g_menu_item_get_attribute_value` — see {@link GioMenuModel.get_item_attribute_value}. */
    get_attribute_value(name: string, expectedType: string | null = null): Variant | null {
        return matchingAttribute(ITEM_ENTRY.get(this)!, name, expectedType);
    }

    /** `g_menu_item_set_link`. `null` removes it; any link name is legal, as in C. */
    set_link(name: string, model: GioMenuModel | null): void {
        const entry = ITEM_ENTRY.get(this)!;
        if (model === null || model === undefined) entry.links.delete(name);
        else entry.links.set(name, model);
    }

    /** `g_menu_item_get_link` — the INSTANCE, not a copy. */
    get_link(name: string): GioMenuModel | null {
        return ITEM_ENTRY.get(this)!.links.get(name) ?? null;
    }

    /** `g_menu_item_set_section`. */
    set_section(section: GioMenuModel | null): void {
        this.set_link(MENU_LINK_SECTION, section);
    }

    /** `g_menu_item_set_submenu`. */
    set_submenu(submenu: GioMenuModel | null): void {
        this.set_link(MENU_LINK_SUBMENU, submenu);
    }
}

registerBaseClass(GioMenuItem as never, 'GMenuItem', {});

/**
 * One attribute read, with GIO's `expected_type` filter — the one place both the item's
 * reader and the model's reader have to agree, so it is written once.
 *
 * A MISMATCHED `expected_type` ANSWERS `null`. Measured: GIO neither converts nor throws,
 * so a caller cannot tell a typo from an absence and must not try. The type is a STRING
 * here rather than a `GLib.VariantType`, which the variant subset does not have — the
 * divergence is in `MENU_MODEL_DIVERGENCE_VECTORS` under `variant-type-is-a-string`.
 */
function matchingAttribute(entry: MenuEntry, name: string, expectedType: string | null): Variant | null {
    const value = entry.attributes.get(name);
    if (value === undefined) return null;
    if (expectedType !== null && expectedType !== undefined && value.get_type_string() !== expectedType) return null;
    return value;
}

/** The entry a model holds at `index`, or `undefined` — the one bounds check both readers share. */
function entryAt(model: GioMenuModel, index: number): MenuEntry | undefined {
    if (!Number.isInteger(index) || index < 0) return undefined;
    return ENTRIES.get(model)?.[index];
}

// --- The two iterators ------------------------------------------------------------------------

/**
 * `Gio.MenuAttributeIter` — the attributes of one item, in insertion order.
 *
 * `next()` BEFORE the first read, as in C: an iterator starts before the beginning, so a
 * loop is `while (iter.next())` and `get_name()` is only valid inside it. Only the
 * attributes actually SET are yielded (measured: a section item carrying a heading yields
 * `label` alone, not both link names with one empty).
 */
export class GioMenuAttributeIter extends GObjectObject {
    static [GIR_TYPE] = 'Gio.MenuAttributeIter';

    constructor(entries: ReadonlyArray<readonly [string, Variant]> = []) {
        super();
        ATTRIBUTE_CURSOR.set(this, { entries: [...entries], index: -1 });
    }

    /** `g_menu_attribute_iter_next`. */
    next(): boolean {
        const cursor = ATTRIBUTE_CURSOR.get(this)!;
        if (cursor.index + 1 >= cursor.entries.length) {
            cursor.index = cursor.entries.length;
            return false;
        }
        cursor.index += 1;
        return true;
    }

    /** `g_menu_attribute_iter_get_name` — `null` outside a successful `next()`. */
    get_name(): string | null {
        const cursor = ATTRIBUTE_CURSOR.get(this)!;
        return cursor.entries[cursor.index]?.[0] ?? null;
    }

    /** `g_menu_attribute_iter_get_value`. */
    get_value(): Variant | null {
        const cursor = ATTRIBUTE_CURSOR.get(this)!;
        return cursor.entries[cursor.index]?.[1] ?? null;
    }

    /** `g_menu_attribute_iter_get_next` — the three out-arguments GJS returns as a tuple. */
    get_next(): [boolean, string | null, Variant | null] {
        const moved = this.next();
        return moved ? [true, this.get_name(), this.get_value()] : [false, null, null];
    }
}

registerBaseClass(GioMenuAttributeIter as never, 'GMenuAttributeIter', {});

/** `Gio.MenuLinkIter` — the same walk over an item's links, and the value is a MODEL. */
export class GioMenuLinkIter extends GObjectObject {
    static [GIR_TYPE] = 'Gio.MenuLinkIter';

    constructor(entries: ReadonlyArray<readonly [string, GioMenuModel]> = []) {
        super();
        LINK_CURSOR.set(this, { entries: [...entries], index: -1 });
    }

    /** `g_menu_link_iter_next`. */
    next(): boolean {
        const cursor = LINK_CURSOR.get(this)!;
        if (cursor.index + 1 >= cursor.entries.length) {
            cursor.index = cursor.entries.length;
            return false;
        }
        cursor.index += 1;
        return true;
    }

    /** `g_menu_link_iter_get_name`. */
    get_name(): string | null {
        const cursor = LINK_CURSOR.get(this)!;
        return cursor.entries[cursor.index]?.[0] ?? null;
    }

    /** `g_menu_link_iter_get_value` — the linked model itself. */
    get_value(): GioMenuModel | null {
        const cursor = LINK_CURSOR.get(this)!;
        return cursor.entries[cursor.index]?.[1] ?? null;
    }

    /** `g_menu_link_iter_get_next`. */
    get_next(): [boolean, string | null, GioMenuModel | null] {
        const moved = this.next();
        return moved ? [true, this.get_name(), this.get_value()] : [false, null, null];
    }
}

registerBaseClass(GioMenuLinkIter as never, 'GMenuLinkIter', {});

// --- `Gio.MenuModel` — the ABSTRACT base ------------------------------------------------------

/**
 * `Gio.MenuModel` — what a `menu-model` property takes, and it cannot be constructed.
 *
 * `new Gio.MenuModel()` throws `Cannot instantiate abstract type GMenuModel` (measured), so
 * this constructor refuses too: a base a caller can instantiate is a type GTK does not have,
 * and a widget door accepting one would accept a model with no items and no way to get any.
 *
 * THE READS DELEGATE TO VFUNCS, as they do in C — `g_menu_model_get_n_items` calls
 * `GMenuModelClass->get_n_items`. {@link GioMenu} is the only subclass the port ships, but a
 * CALLER's subclass is the reason the indirection is here: a model backed by something else
 * overrides `vfunc_get_n_items` and the public reads, `menuTree` and every renderer follow it.
 *
 * `items-changed` is declared HERE and inherited, which is where it is in GTK —
 * `GObject.signal_lookup('items-changed', Gio.MenuModel.$gtype)` is non-zero (measured), and
 * `findSignal` walks the static chain, so a `GioMenu` instance resolves it from this class.
 */
export abstract class GioMenuModel extends GObjectObject {
    static [GIR_TYPE] = 'Gio.MenuModel';

    /**
     * `Gio.MenuModel.$gtype` — installed by the `registerBaseClass` below, declared here so a
     * caller can NAME the type. It is the `valueType` a widget declaring a `menu-model` property
     * passes (`ForeignObjectProperty`), which is why this one needs a type where the other
     * registered base classes do not: `Gtk.FileFilter.$gtype` is declared for the same reason,
     * a `Gio.ListStore`'s `item_type`.
     */
    declare static readonly $gtype: GType;

    constructor() {
        super();
        // `new.target`, so a SUBCLASS passes and the base alone refuses — the same reach
        // `g_object_new` has when it looks at the GType's abstract flag.
        if (new.target === GioMenuModel) {
            throw new Error('Cannot instantiate abstract type GMenuModel');
        }
    }

    /** `g_menu_model_is_mutable`. */
    is_mutable(): boolean {
        return this.vfunc_is_mutable();
    }

    /** `g_menu_model_get_n_items`. */
    get_n_items(): number {
        return this.vfunc_get_n_items();
    }

    /**
     * `g_menu_model_get_item_attribute_value`.
     *
     * `expectedType` is a type STRING and not a `GLib.VariantType`, which the variant subset
     * does not have (`MENU_MODEL_DIVERGENCE_VECTORS`, `variant-type-is-a-string`). A
     * mismatch answers `null` rather than converting or throwing, as GIO does.
     */
    get_item_attribute_value(itemIndex: number, attribute: string, expectedType: string | null = null): Variant | null {
        return this.vfunc_get_item_attribute_value(itemIndex, attribute, expectedType);
    }

    /** `g_menu_model_get_item_link` — the linked model INSTANCE, or `null`. */
    get_item_link(itemIndex: number, link: string): GioMenuModel | null {
        return this.vfunc_get_item_link(itemIndex, link);
    }

    /** `g_menu_model_iterate_item_attributes`. */
    iterate_item_attributes(itemIndex: number): GioMenuAttributeIter {
        return this.vfunc_iterate_item_attributes(itemIndex);
    }

    /** `g_menu_model_iterate_item_links`. */
    iterate_item_links(itemIndex: number): GioMenuLinkIter {
        return this.vfunc_iterate_item_links(itemIndex);
    }

    /**
     * `g_menu_model_items_changed` — PUBLIC, and it changes nothing.
     *
     * Measured: `model.items_changed(3, 2, 1)` emits that triple and leaves the count alone,
     * because it is how a SUBCLASS reports a splice it made in its own storage. A lying triple
     * is not policed, here or in GIO.
     */
    items_changed(position: number, removed: number, added: number): void {
        this.emit('items-changed', position, removed, added);
    }

    /** `GMenuModelClass->is_mutable`; a model is immutable unless it says otherwise. */
    vfunc_is_mutable(): boolean {
        return false;
    }

    abstract vfunc_get_n_items(): number;

    abstract vfunc_get_item_attribute_value(
        itemIndex: number,
        attribute: string,
        expectedType: string | null,
    ): Variant | null;

    abstract vfunc_get_item_link(itemIndex: number, link: string): GioMenuModel | null;

    abstract vfunc_iterate_item_attributes(itemIndex: number): GioMenuAttributeIter;

    abstract vfunc_iterate_item_links(itemIndex: number): GioMenuLinkIter;
}

registerBaseClass(GioMenuModel as never, 'GMenuModel', {
    'items-changed': [TYPE_UINT, TYPE_UINT, TYPE_UINT],
});

// --- `Gio.Menu` — the one concrete model ------------------------------------------------------

/** The item a `label` + `detailedAction` pair builds, so the six shorthands share one path. */
function plainEntry(label: string | null, detailedAction: string | null): MenuEntry {
    const item = new GioMenuItem(label, detailedAction);
    return ITEM_ENTRY.get(item)!;
}

/** The item a section or submenu mutator builds: a heading plus the one link. */
function linkEntry(label: string | null, link: string, model: GioMenuModel): MenuEntry {
    const item = new GioMenuItem(label);
    item.set_link(link, model);
    return ITEM_ENTRY.get(item)!;
}

/**
 * `Gio.Menu` — a mutable `Gio.MenuModel`, and what every menu in the port is.
 *
 * ONE `items-changed` PER MUTATOR, with the triple each one emits held by
 * `MENU_MUTATOR_EMISSION_VECTORS`. The row that separates this from `Gtk.StringList`:
 * `remove_all()` on an EMPTY menu STILL emits `(0, 0, 0)` (measured), so the no-op skip ADR
 * 0122 § 3 is right about for a list store is wrong here, and neither {@link remove_all} nor
 * {@link insertEntry} has one.
 *
 * An item is COPIED IN. `append_item(item)` takes what the item carries at that moment and a
 * later `set_label` on the same object reaches nothing — see {@link GioMenuItem}.
 */
export class GioMenu extends GioMenuModel {
    static [GIR_TYPE] = 'Gio.Menu';

    constructor() {
        super();
        ENTRIES.set(this, []);
    }

    /** `g_menu_new`. */
    static new(): GioMenu {
        return new GioMenu();
    }

    /** `g_menu_insert` — a plain item at `position`. */
    insert(position: number, label: string | null, detailedAction: string | null = null): void {
        this.insertEntry(position, plainEntry(label, detailedAction));
    }

    /** `g_menu_append`. */
    append(label: string | null, detailedAction: string | null = null): void {
        this.insertEntry(this.get_n_items(), plainEntry(label, detailedAction));
    }

    /** `g_menu_prepend`. */
    prepend(label: string | null, detailedAction: string | null = null): void {
        this.insertEntry(0, plainEntry(label, detailedAction));
    }

    /** `g_menu_insert_item` — the item's attributes and links, copied. */
    insert_item(position: number, item: GioMenuItem): void {
        this.insertEntry(position, copyEntry(ITEM_ENTRY.get(item)!));
    }

    /** `g_menu_append_item`. */
    append_item(item: GioMenuItem): void {
        this.insert_item(this.get_n_items(), item);
    }

    /** `g_menu_prepend_item`. */
    prepend_item(item: GioMenuItem): void {
        this.insert_item(0, item);
    }

    /** `g_menu_insert_section` — ONE item of this menu, however many the section holds. */
    insert_section(position: number, label: string | null, section: GioMenuModel): void {
        this.insertEntry(position, linkEntry(label, MENU_LINK_SECTION, section));
    }

    /** `g_menu_append_section`. */
    append_section(label: string | null, section: GioMenuModel): void {
        this.insert_section(this.get_n_items(), label, section);
    }

    /** `g_menu_prepend_section`. */
    prepend_section(label: string | null, section: GioMenuModel): void {
        this.insert_section(0, label, section);
    }

    /** `g_menu_insert_submenu`. */
    insert_submenu(position: number, label: string | null, submenu: GioMenuModel): void {
        this.insertEntry(position, linkEntry(label, MENU_LINK_SUBMENU, submenu));
    }

    /** `g_menu_append_submenu`. */
    append_submenu(label: string | null, submenu: GioMenuModel): void {
        this.insert_submenu(this.get_n_items(), label, submenu);
    }

    /** `g_menu_prepend_submenu`. */
    prepend_submenu(label: string | null, submenu: GioMenuModel): void {
        this.insert_submenu(0, label, submenu);
    }

    /** `g_menu_remove` — one item, reported where it was. */
    remove(position: number): void {
        const entries = ENTRIES.get(this)!;
        if (!Number.isInteger(position) || position < 0 || position >= entries.length) return;
        entries.splice(position, 1);
        this.items_changed(position, 1, 0);
    }

    /**
     * `g_menu_remove_all`.
     *
     * It emits on an EMPTY menu too — `(0, 0, 0)`, measured. A renderer may therefore drop
     * every row it holds on this one emission without reading the count first.
     */
    remove_all(): void {
        const entries = ENTRIES.get(this)!;
        const removed = entries.length;
        entries.length = 0;
        this.items_changed(0, removed, 0);
    }

    /**
     * `g_menu_freeze` — a FLAG, not a lock.
     *
     * Measured both ways: `is_mutable()` flips to false and the mutators keep working, so a
     * twin that refused a post-freeze append would break a caller GIO lets through
     * (`MENU_MODEL_DIVERGENCE_VECTORS`, `freeze-does-not-lock`).
     */
    freeze(): void {
        FROZEN.add(this);
    }

    override vfunc_is_mutable(): boolean {
        return !FROZEN.has(this);
    }

    override vfunc_get_n_items(): number {
        return ENTRIES.get(this)!.length;
    }

    override vfunc_get_item_attribute_value(
        itemIndex: number,
        attribute: string,
        expectedType: string | null,
    ): Variant | null {
        const entry = entryAt(this, itemIndex);
        return entry === undefined ? null : matchingAttribute(entry, attribute, expectedType);
    }

    override vfunc_get_item_link(itemIndex: number, link: string): GioMenuModel | null {
        return entryAt(this, itemIndex)?.links.get(link) ?? null;
    }

    override vfunc_iterate_item_attributes(itemIndex: number): GioMenuAttributeIter {
        return new GioMenuAttributeIter([...(entryAt(this, itemIndex)?.attributes ?? [])]);
    }

    override vfunc_iterate_item_links(itemIndex: number): GioMenuLinkIter {
        return new GioMenuLinkIter([...(entryAt(this, itemIndex)?.links ?? [])]);
    }

    /** The one insert, so the emission rule is written once. Out of range clamps, as C does. */
    private insertEntry(position: number, entry: MenuEntry): void {
        const entries = ENTRIES.get(this)!;
        const at = !Number.isInteger(position) || position < 0 ? entries.length : Math.min(position, entries.length);
        entries.splice(at, 0, entry);
        this.items_changed(at, 0, 1);
    }
}

registerBaseClass(GioMenu as never, 'GMenu', {});

// --- The two bridges: a tree in, a tree out ---------------------------------------------------

/** Item attribute key → GIO attribute name. `action` is absent: it goes through the parser. */
const ITEM_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [
    ['icon', MENU_ATTRIBUTE_ICON],
    ['verbIcon', 'verb-icon'],
    ['accel', 'accel'],
    ['hiddenWhen', 'hidden-when'],
    ['custom', 'custom'],
    ['id', 'id'],
];

/** One node as a {@link GioMenuItem}, links included — the core's own `itemOf`. */
function itemOf(node: AdwMenuNode): GioMenuItem {
    const item = new GioMenuItem();
    const record = node as unknown as Record<string, unknown>;
    if (node.kind === 'item') {
        // `set_detailed_action` PARSES, which is why the model carries ONE string: it writes
        // `action` plus a `target` of the target's own type. A malformed name is refused here
        // and on every leg — see `parseDetailedName`.
        if (node.action !== undefined) item.set_detailed_action(node.action);
        item.set_label(node.label);
        for (const [key, name] of ITEM_ATTRIBUTES) {
            const value = record[key];
            if (typeof value === 'string') item.set_attribute_value(name, new Variant('s', value));
        }
        // `use-markup` as the STRING `'true'`, which is what the GTK host has always written:
        // GTK reads it with `"&s"`, so a boolean is a FAILED read and the flag is lost. The
        // reader below accepts both (`MENU_ATTRIBUTE_VARIANT_VECTORS` has the pair).
        if (node.useMarkup === true) item.set_attribute_value('use-markup', new Variant('s', 'true'));
        return item;
    }

    const child = buildMenu(node.items);
    if (node.kind === 'section') {
        item.set_section(child);
        if (node.label !== undefined) item.set_label(node.label);
        if (node.displayHint !== undefined)
            item.set_attribute_value('display-hint', new Variant('s', node.displayHint));
        if (node.textDirection !== undefined) {
            item.set_attribute_value('text-direction', new Variant('s', node.textDirection));
        }
        return item;
    }

    item.set_submenu(child);
    item.set_label(node.label);
    for (const [key, name] of [
        ['icon', MENU_ATTRIBUTE_ICON],
        ['submenuAction', 'submenu-action'],
        ['macosSpecial', 'gtk-macos-special'],
    ] as const) {
        const value = record[key];
        if (typeof value === 'string') item.set_attribute_value(name, new Variant('s', value));
    }
    return item;
}

/**
 * An authored or normalised menu TREE as a live {@link GioMenu} — the one-way street.
 *
 * It takes the AUTHORED form as well as the normalised one because `normalizeMenuModel` is
 * idempotent, so a JSX attribute needs no conversion step of its own. This is the only way
 * an array becomes a model now that `menuModel` refuses one: ADR 0128 § 4 closed the door
 * and this is the door's replacement, named so a caller can find it.
 */
export function buildMenu(input: AdwMenuInput | AdwMenuTree): GioMenu {
    const menu = new GjsifyMenu();
    for (const node of normalizeMenuModel(input as AdwMenuInput)) menu.append_item(itemOf(node));
    return menu;
}

/** A string-typed attribute of one item, or `undefined`. */
function attr(model: GioMenuModel, index: number, name: string): string | undefined {
    return model.get_item_attribute_value(index, name, 's')?.deepUnpack<string>();
}

/** The DETAILED action name GIO split into `action` + `target`, put back together. */
function detailedAction(model: GioMenuModel, index: number): string | undefined {
    const name = attr(model, index, MENU_ATTRIBUTE_ACTION);
    if (name === undefined) return undefined;
    return printDetailedName(name, model.get_item_attribute_value(index, MENU_ATTRIBUTE_TARGET) ?? undefined);
}

/**
 * A `Gio.MenuModel` as a portable TREE — the inverse of {@link buildMenu}.
 *
 * THIS IS THE ONE BRIDGE every renderer crosses, and it crosses it ONCE PER RENDER. The
 * tree walkers (`menuNodeAt`, `flattenMenu`, `menuRefusals`, `assertMenuRenderable`) all take
 * an `AdwMenuTree` rather than a model, because a walker reading through the model would make
 * every path lookup a chain of `get_item_link` calls and every renderer's loop a different
 * number of them. One snapshot, then plain data.
 *
 * IT IS A DEEP SNAPSHOT, which is the measured behaviour and not a convenience: an item read
 * out of a `Gio.Menu` is a copy (`MENU_MODEL_DIVERGENCE_VECTORS`, `item-is-a-snapshot`), so a
 * tree that aliased the model would promise a sharing GIO does not do. A mutation arrives
 * through `items-changed` and the renderer takes a new snapshot — see {@link watchMenuModel}.
 *
 * It reads what GTK reads plus `id`, so an application's own extra attributes do not survive
 * the trip. Stated rather than implied: this is the inverse of the builder above, not a
 * general `GMenuModel` serialiser. Both edges a hand-built menu can reach are GTK's own: an
 * item carrying BOTH links reads as a SECTION (`gtkmenutracker.c:317-352` decides the same
 * way), and a non-string `label` reads as `''` (so does `g_menu_item_get_attribute(…, "&s")`).
 */
export function menuTree(model: GioMenuModel): AdwMenuTree {
    const nodes: AdwMenuNode[] = [];
    for (let index = 0; index < model.get_n_items(); index += 1) {
        const section = model.get_item_link(index, MENU_LINK_SECTION);
        const submenu = model.get_item_link(index, MENU_LINK_SUBMENU);
        const label = attr(model, index, MENU_ATTRIBUTE_LABEL);
        // The key ORDER matches `normalizeMenuModel`'s, so a comparison that stringifies is
        // comparing menus rather than insertion order — which `GjsifyMenu.reconcile` relies on.
        if (section !== null) {
            const node: Record<string, unknown> = { kind: 'section', items: menuTree(section) };
            if (label !== undefined) node.label = label;
            const hint = attr(model, index, 'display-hint');
            if (hint !== undefined) node.displayHint = hint;
            const direction = attr(model, index, 'text-direction');
            if (direction !== undefined) node.textDirection = direction;
            nodes.push(node as unknown as AdwMenuNode);
            continue;
        }
        if (submenu !== null) {
            const node: Record<string, unknown> = { kind: 'submenu', label: label ?? '', items: menuTree(submenu) };
            for (const [key, name] of [
                ['icon', MENU_ATTRIBUTE_ICON],
                ['submenuAction', 'submenu-action'],
                ['macosSpecial', 'gtk-macos-special'],
            ] as const) {
                const value = attr(model, index, name);
                if (value !== undefined) node[key] = value;
            }
            nodes.push(node as unknown as AdwMenuNode);
            continue;
        }
        const item: Record<string, unknown> = { kind: 'item', label: label ?? '' };
        const action = detailedAction(model, index);
        if (action !== undefined) item.action = action;
        for (const [key, name] of ITEM_ATTRIBUTES) {
            const value = attr(model, index, name);
            if (value !== undefined) item[key] = value;
        }
        // BOTH types, because the portable writer sets `s` and GIO itself sets `b` (measured).
        // Present and not boolean-false is the flag: a reader asking for one type alone would
        // drop the attribute written by the other half of the port.
        const markup = model.get_item_attribute_value(index, 'use-markup');
        if (markup !== null && markup.deepUnpack<unknown>() !== false) item.useMarkup = true;
        nodes.push(item as unknown as AdwMenuNode);
    }
    return nodes;
}

/**
 * Connect `handler` to `model` and to every model it LINKS TO, recursively.
 *
 * THIS IS WHY IT EXISTS: a section's own `items-changed` does NOT bubble to the menu holding
 * it (measured — `MENU_LINK_VECTORS`, `link-emission-does-not-bubble`), while the link read
 * reflects the change at once. A renderer connected to the root alone therefore shows a stale
 * section for ever. The defect was unreachable while a menu was an array, because every
 * mutation went through a re-parse of the whole tree; it arrives WITH the real model, so the
 * watcher arrives with it.
 *
 * The returned function disconnects every handler it made. It is RE-RUN on each emission by
 * its caller — a renderer calls `watchMenuModel` again after it re-snapshots — because a
 * mutation can add a link that was not there to connect to.
 */
export function watchMenuModel(model: GioMenuModel, handler: () => void): () => void {
    const connections: Array<readonly [GioMenuModel, number]> = [];
    const seen = new Set<GioMenuModel>();
    const descend = (each: GioMenuModel): void => {
        if (seen.has(each)) return;
        seen.add(each);
        connections.push([each, each.connect('items-changed', handler)]);
        for (let index = 0; index < each.get_n_items(); index += 1) {
            for (const name of [MENU_LINK_SECTION, MENU_LINK_SUBMENU]) {
                const link = each.get_item_link(index, name);
                if (link !== null) descend(link);
            }
        }
    };
    descend(model);
    return () => {
        for (const [each, id] of connections) each.disconnect(id);
        connections.length = 0;
    };
}

// --- The authored menu and the door it comes through ------------------------------------------

/**
 * The menu a SURFACE owns, so an authored `menuModel` attribute keeps its identity.
 *
 * ONE instance per element, re-parsed INTO rather than replaced: a `menu-model` write notifies
 * and rebuilds the popover, while an edit to the same `menu='[…]'` attribute is a content
 * change the popover already open should follow. Mirrors `GjsifyOptionList` (ADR 0122 § 5),
 * and it is the same reason — the authored door is the one place the port, not GIO, decides.
 */
export class GjsifyMenu extends GioMenu {
    /**
     * Replace the contents with `next` IN PLACE, keeping this menu's identity.
     *
     * EQUAL CONTENT EMITS NOTHING, so re-rendering an unchanged attribute does not reopen a
     * popover; anything else is ONE `items-changed(0, old, new)`. Not the minimal splice
     * `GjsifyOptionList` computes: a menu is a TREE, so "the one splice that turns one into
     * the other" is not a position and a length, and a renderer re-snapshots the whole tree
     * on any emission anyway ({@link menuTree}).
     */
    reconcile(next: AdwMenuInput | AdwMenuTree | null | undefined): void {
        const nodes = normalizeMenuModel(next as AdwMenuInput);
        if (JSON.stringify(menuTree(this)) === JSON.stringify(nodes)) return;
        const entries = ENTRIES.get(this)!;
        const removed = entries.length;
        entries.length = 0;
        for (const node of nodes) entries.push(copyEntry(ITEM_ENTRY.get(itemOf(node))!));
        this.items_changed(0, removed, entries.length);
    }
}

registerBaseClass(GjsifyMenu as never, 'GjsifyMenu', {});

/** `Adw.SplitButton:menu-model`'s own ParamSpec, so {@link readMenuModelWrite} refuses in its words. */
const MENU_MODEL_SPEC = ParamSpec.object('menu-model', '', '', ParamFlags.READWRITE, TYPE_OBJECT);

/** The GType name of `value`'s most derived registered class, for the type refusal. */
function registeredTypeName(value: object): string | undefined {
    for (let each = (value as { constructor?: unknown }).constructor; typeof each === 'function';) {
        const info = registeredClassOf(each as object);
        if (info !== undefined) return info.typeName;
        each = Object.getPrototypeOf(each) as unknown;
    }
    return undefined;
}

/**
 * What a write to a `menu-model` property reads as — the ONE door, for all four surfaces.
 *
 * ADR 0128 § 4 makes `menu-model` an object property over `Gio.MenuModel` and § 7 leaves the
 * JSON markup attribute open, so every `menuModel` setter in this repository has the same
 * four-way answer to give. It is written here once because it was about to be written fifteen
 * times, and it mirrors `readModelWrite` (`option-list.ts`) deliberately — the two doors
 * answer the same question about two different models, and a reader who knows one knows this.
 *
 *   - `null` / `undefined` is the "no menu" write, which clears the popover;
 *   - a STRING is the markup attribute, parsed and reconciled into `authored` — the surface's
 *     OWN menu, whose identity survives the edit;
 *   - a real model is handed through by IDENTITY, so `widget.menuModel === model` holds as it
 *     is measured to in libadwaita;
 *   - anything else, an ARRAY above all, is a `TypeError`.
 *
 * THE DUCK TEST, and not `instanceof` alone, because a REAL `Gio.Menu` reached through node-gi
 * (ADR 0104) is no registered class of this subset — and handing one to `Gtk.MenuButton`
 * is the whole point of having the property.
 *
 * THE TYPE REFUSAL IS THE PORT'S OWN, which is the one place this door is wider than
 * `checkPropertyValue`. A `TYPE_OBJECT` spec catches a non-object and an unregistered object,
 * and that is all it can catch: `G_TYPE_OBJECT` accepts ANY GObject, so a registered
 * `Gtk.StringList` passes the value check and still cannot be a menu. GJS raises
 * `Object is of type … - cannot convert to GMenuModel` at the GValue conversion that follows
 * (measured with a `Gtk.Label`); the subset has no such conversion, so the message is raised
 * here, with the GType found by walking the constructor chain.
 */
export function readMenuModelWrite(value: unknown, authored: GjsifyMenu): GioMenuModel | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        authored.reconcile(parseMenuModel(value));
        return authored;
    }
    if (value instanceof GioMenuModel) return value;
    const duck = value as Partial<GioMenuModel>;
    if (typeof duck.get_n_items === 'function' && typeof duck.get_item_link === 'function') {
        return value as GioMenuModel;
    }
    checkPropertyValue(MENU_MODEL_SPEC, value);
    throw new TypeError(
        `Object is of type ${registeredTypeName(value as object) ?? 'GObject'} - cannot convert to GMenuModel`,
    );
}
