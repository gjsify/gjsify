// `Gtk.StringList` — a REAL list model, and `Gtk.StringObject`, the items it hands out.
//
// WHAT CHANGED, AND WHY (ADR 0122, amending ADR 0046). This type used to be an `Array`
// subclass: `model: list` and `model: [...]` were the same write, nothing in either port
// had to learn a second shape, and the cost was that a GJS author's `list.get_item(0)`,
// `list.connect('items-changed', …)` and `dropDown.model.n_items` all answered nothing.
// ADR 0046 accepted that because no surface consumed a model AS a model. `Adw.ComboRow`
// now does: its selection, its `selected-item` and its subtitle are defined in terms of
// `g_list_model_get_item`, and there is no way to say that over an array of strings without
// inventing a second vocabulary beside GTK's. So the list became the thing GTK says it is —
// a `GListModel` of `GtkStringObject`s — and the array door closed.
//
// WHAT IT COSTS, SPELLED OUT. `length`, `list[0]`, `map`, `filter`, spread and
// `Symbol.species` are gone, because real `Gtk.StringList` has none of them (measured:
// `[...list]` throws `list is not iterable`). `splice` keeps GTK's three-argument meaning
// alone — the `Array.prototype.splice` overload the old class also answered is a different
// function with the same name. `find(string): number` takes GTK's meaning, which is the one
// the old class refused to shadow and can now have: there is no `Array.prototype.find` left
// to collide with.
//
// IT IS PURE JS ON EVERY LEG, and that is the whole reason the subset can have interfaces at
// all. `registerBaseClass` pins a core type to `PURE_JS_ENGINE`, so `GtkStringList` is this
// class on the browser, on GJS-through-the-subset and on the NativeScript host alike. The
// interface surface is therefore installed by the core on this prototype, `items-changed` is
// an ordinary declared signal, and no engine below has to know the word interface.
//
// IT STANDS IN FOR A C TYPE, which is why the refusals below are hand-written rather than
// generated. A read-only property of a JS-REGISTERED class is a getter with no setter in
// GJS, and the subset's generated accessors match that; a read-only property of a C object
// answers `Property GtkStringList.n-items is not writable`, which is what was measured here
// and so what these three properties say.
//
// `item_type` IS `GObject`, NOT `GtkStringObject`, and that is not a bug here. Measured on
// GTK 4.22.5 through both GJS and PyGObject: `gtk_string_list_get_item_type` answers
// `G_TYPE_OBJECT`. If a later GTK narrows it, the vector that pins it goes red and says so.
// It carries no `ParamSpec`: a `GType` is not one of the subset's six value kinds, so the
// property is an accessor pair alone and there is no `notify::item-type` — which costs
// nothing, since nothing can change it.
//
// Measured against GJS 1.88.01 / GTK 4.22.5 (`~/.cache/gjsify-android/p4.js`, `p5.js`,
// `p6.js`, `p7.js`): `items-changed` fires BEFORE `notify::n-items`, and the notify only
// when `removed !== added`; a splice that removes nothing and adds nothing emits neither; an
// item is an OBJECT that moves with a splice rather than an identity bound to a position;
// replacing a string with an equal one still makes a new item; a `null` inside a `strings`
// array TERMINATES it, as a C strv does.
//
// Reference: gtk/gtkstringlist.c, gtk/gtkstringlist.h — `Gtk.StringList` ConstructorProps
// (`strings: string[]`, construct-only) and its `append`, `take`, `remove`, `splice`,
// `get_string`, `find` methods; `Gtk.StringObject`'s read-only `string`.
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { MAXUINT32 } from './glib-paths.js';
import {
    GIR_TYPE,
    GObjectObject,
    ListModel,
    ParamFlags,
    ParamSpec,
    registerBaseClass,
    TYPE_OBJECT,
    type GType,
} from './gobject.js';

/** `gtk_string_list_find`'s "not found" — `GTK_INVALID_LIST_POSITION`, a `guint` of all ones. */
export const INVALID_LIST_POSITION = 0xffffffff;

/** The string an item holds; `null` for one built with no string at all, as GJS answers. */
const ITEM_STRING = new WeakMap<object, string | null>();

/** The items a list holds, in order. State lives here, never in class fields (see `application.ts`). */
const ITEMS = new WeakMap<object, GtkStringObject[]>();

/**
 * A `const char*` argument, with GJS's own two refusals: `null` is named for what it is, and
 * anything else is named by its type. The argument is called `string` in all three GIR
 * signatures that take one (`append`, `find`, `gtk_string_object_new`).
 */
function requireString(value: unknown): string {
    if (value === null || value === undefined) throw new TypeError('Argument string may not be null');
    if (typeof value !== 'string') {
        throw new TypeError(`Expected type string for argument 'string' but got type ${typeof value}`);
    }
    return value;
}

/**
 * A `char**` argument — a C string vector, and it behaves like one: a `null` ELEMENT is the
 * terminator, so `['a', null, 'b']` is a one-element array rather than an error (measured).
 * `null` for the whole argument is the empty vector; anything else in a slot is refused.
 */
function readStrv(value: readonly (string | null)[] | null): string[] {
    const strings: string[] = [];
    for (const entry of value ?? []) {
        if (entry === null || entry === undefined) break;
        if (typeof entry !== 'string') throw new TypeError('Invalid element in string array');
        strings.push(entry);
    }
    return strings;
}

function notWritable(typeName: string, property: string): never {
    throw new Error(`Property ${typeName}.${property} is not writable`);
}

/**
 * `Gtk.StringObject` — one string, as the `GObject` a `GListModel` is allowed to hand out.
 *
 * It exists for the reason it exists in GTK: `g_list_model_get_item` returns a `GObject`, and a
 * string is not one. Two objects holding the same string are NOT equal (measured), so identity
 * here means "this entry of this list", never "this text".
 */
export class GtkStringObject extends GObjectObject {
    static [GIR_TYPE] = 'Gtk.StringObject';

    constructor(props?: Record<string, unknown> | null) {
        // `string` is declared READABLE only, so a bag naming it reaches the accessor below and
        // raises the SAME refusal an assignment raises — which is what GJS does, and why there is
        // no construct door for it. Everything else falls through to `No property … on
        // GtkStringObject`, as it does on the real type.
        super(props ?? undefined);
        if (!ITEM_STRING.has(this)) ITEM_STRING.set(this, null);
    }

    /** `gtk_string_object_new` — the only way to put a string in one. */
    static new(string: string): GtkStringObject {
        const item = new GtkStringObject();
        ITEM_STRING.set(item, requireString(string));
        return item;
    }

    /**
     * `Gtk.StringObject:string`.
     *
     * `null` on one built without a string: `new Gtk.StringObject().string` is `null`, measured,
     * and the GIR's non-null typing describes only the items a list hands out.
     */
    get string(): string | null {
        return ITEM_STRING.get(this) ?? null;
    }

    set string(_value: string) {
        notWritable('GtkStringObject', 'string');
    }

    /** `gtk_string_object_get_string`. */
    get_string(): string | null {
        return this.string;
    }
}

registerBaseClass(GtkStringObject as never, 'GtkStringObject', {}, [
    ParamSpec.string('string', '', '', ParamFlags.READABLE, null),
]);

/**
 * What `new Gtk.StringList({ … })` takes.
 *
 * `strings` only, and CONSTRUCT-ONLY, as GTK declares it. The other two the type has —
 * `item-type` and `n-items` — are `GListModel`'s read-only pair.
 */
export interface GtkStringListProps {
    /** The strings the list starts with. */
    strings?: readonly (string | null)[] | null;
}

/**
 * `Gtk.StringList` — a `Gio.ListModel` of {@link GtkStringObject}s.
 *
 * `new GtkStringList()` is empty, as `gtk_string_list_new(NULL)` is, and the instance is what
 * every `model` property takes. It is NOT an array and nothing array-shaped reaches it.
 */
export class GtkStringList extends GObjectObject {
    static [GIR_TYPE] = 'Gtk.StringList';

    /** Installed by the core from {@link ListModel}; declared here for the type alone. */
    declare readonly get_item: (position: number) => GtkStringObject | null;
    declare readonly get_item_type: () => GType;
    declare readonly get_n_items: () => number;
    declare readonly items_changed: (position: number, removed: number, added: number) => void;

    constructor(props?: GtkStringListProps | null) {
        // `strings` is construct-only in GTK and filled here rather than declared as a ParamSpec:
        // the subset's construct-only path defines a READABLE own property, and the measured type
        // has no readable `strings` at all. Everything else goes to the base constructor, so an
        // unknown key still answers `No property … on GtkStringList`.
        const rest = { ...props } as Record<string, unknown>;
        delete rest['strings'];
        super(rest);
        ITEMS.set(
            this,
            readStrv(props?.strings ?? null).map((string) => GtkStringObject.new(string)),
        );
    }

    /** `gtk_string_list_new`: a list holding `strings`, or an empty one for `null`. */
    static new(strings: readonly (string | null)[] | null): GtkStringList {
        return new GtkStringList({ strings });
    }

    /**
     * `Gtk.StringList:strings` as GTK leaves it after construction: unreadable, and unwritable
     * without saying so.
     *
     * Both halves are measured, not chosen. The property is construct-only, so GJS installs a
     * getter that answers `undefined` and a setter GObject refuses — with a CRITICAL on stderr
     * and NO exception, leaving the list exactly as it was. Omitting the pair would turn
     * `list.strings = […]` into a silent own-property write that looks like it worked.
     */
    get strings(): undefined {
        return undefined;
    }

    set strings(_value: readonly string[] | undefined) {
        console.warn(
            'GLib-GObject-CRITICAL: g_object_set_is_valid_property: construct property "strings" ' +
                "for object 'GtkStringList' can't be set after construction",
        );
    }

    /** `Gtk.StringList:item-type` — see the file header on why it is `GObject`. */
    get item_type(): GType {
        return TYPE_OBJECT;
    }

    set item_type(_value: GType) {
        notWritable('GtkStringList', 'item-type');
    }

    get itemType(): GType {
        return this.item_type;
    }

    set itemType(_value: GType) {
        notWritable('GtkStringList', 'item-type');
    }

    /** `Gtk.StringList:n-items` — the `ParamSpec`'s reader, and `get_n_items`'s answer. */
    get n_items(): number {
        return ITEMS.get(this)!.length;
    }

    set n_items(_value: number) {
        notWritable('GtkStringList', 'n-items');
    }

    /** `vfunc_get_item_type` — what the interface's `get_item_type()` calls through to. */
    vfunc_get_item_type(): GType {
        return TYPE_OBJECT;
    }

    /** `vfunc_get_n_items`. */
    vfunc_get_n_items(): number {
        return this.n_items;
    }

    /** `vfunc_get_item` — `null` past the end, as `g_list_model_get_item` returns `NULL`. */
    vfunc_get_item(position: number): GtkStringObject | null {
        return ITEMS.get(this)![position] ?? null;
    }

    /** `gtk_string_list_append`. */
    append(string: string): void {
        this.spliceItems(this.n_items, 0, [GtkStringObject.new(requireString(string))]);
    }

    /**
     * `gtk_string_list_take` — `append` without the copy.
     *
     * The copy is what the two differ by in C ("this variant … is convenient for formatting
     * strings"), and JS strings are immutable, so here the two are one function. It exists so
     * code ported from GJS keeps working rather than to say something `append` does not.
     */
    take(string: string): void {
        this.append(string);
    }

    /** `gtk_string_list_remove` — the string at `position`, which must be in range. */
    remove(position: number): void {
        this.spliceItems(position, 1, []);
    }

    /**
     * `gtk_string_list_splice(position, n_removals, additions)` — the C signature, all three
     * arguments, additions as ONE array.
     *
     * Not `Array.prototype.splice`'s rest-argument form: this class is no longer an array, so the
     * overload that used to serve both spellings would now be the subset inventing one. Each of
     * the three refusals below is GJS's own, measured: a short call, a bare string where a strv
     * belongs, and `undefined` in a slot that takes `null`.
     */
    splice(position: number, nRemovals: number, additions: readonly (string | null)[] | null): void {
        // `arguments`, not a rest parameter: the arity message needs the COUNT PASSED.
        const passed = arguments.length;
        if (passed < 3) {
            throw new Error(`method Gtk.StringList.splice: At least 3 arguments required, but only ${passed} passed`);
        }
        if (typeof additions === 'string') throw new TypeError("Cannot convert string to array of 'utf8'");
        if (additions === undefined) {
            throw new TypeError("Expected type utf8 for Argument 'additions' but got type 'undefined'");
        }
        this.spliceItems(
            position,
            nRemovals,
            readStrv(additions).map((string) => GtkStringObject.new(string)),
        );
    }

    /** `gtk_string_list_get_string` — `null` past the end, as C returns `NULL`. */
    get_string(position: number): string | null {
        return ITEMS.get(this)![position]?.string ?? null;
    }

    /**
     * `gtk_string_list_find` — the POSITION of the first equal string, GTK's meaning of the name,
     * not `Array.prototype.find`'s. {@link INVALID_LIST_POSITION} when there is none.
     */
    find(string: string): number {
        const needle = requireString(string);
        const index = ITEMS.get(this)!.findIndex((item) => item.string === needle);
        return index === -1 ? INVALID_LIST_POSITION : index;
    }

    /**
     * The one mutation, so the emission rule is written once: `items-changed` first, then
     * `notify::n-items` and only when the count actually moved, and NEITHER when the splice
     * removes nothing and adds nothing. All three measured; GTK's own
     * `gtk_string_list_items_changed` is the same two lines.
     *
     * Out of range is a CRITICAL and a no-op, not an exception — `remove` past the end lands on
     * the same assertion, because `gtk_string_list_remove` IS a splice in C.
     */
    private spliceItems(position: number, nRemovals: number, added: readonly GtkStringObject[]): void {
        const items = ITEMS.get(this)!;
        if (position + nRemovals > items.length) {
            console.warn(
                "Gtk-CRITICAL: gtk_string_list_splice: assertion 'position + n_removals <= " +
                    "objects_get_size (&self->items)' failed",
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
    GtkStringList as never,
    'GtkStringList',
    {},
    [ParamSpec.uint('n-items', '', '', ParamFlags.READABLE, 0, MAXUINT32, 0)],
    [ListModel],
);
