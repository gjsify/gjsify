// `Gtk.StringList` — the AUTHORING DOOR onto the portable list model.
//
// WHAT WAS MISSING, AND WHERE IT SHOWED. `list.ts` has carried the VALUE since ADR 0046:
// every surface's `model` takes `AdwListModelInput` and `normalizeComboOptions` reduces
// it, bare strings included. What no surface had was the name a GJS author reaches for,
// so the website gallery wrote the same list twice:
//
//   gjs           model: new Gtk.StringList({ strings: ['Blue', 'Teal', 'Green'] })
//   nativescript  model: ['Blue', 'Teal', 'Green']
//
// and the gallery's pane ledger named that one line as the whole reason `Adw.ComboRow`
// and `Gtk.DropDown` could not be one text.
//
// IT IS AN `Array` SUBCLASS, for the reason `gio-menu.ts` is one: `model` already accepts
// an array and `normalizeComboOptions` gates on `Array.isArray`, which is TRUE for a
// subclass. So `model: list` and `model: [...]` are the SAME WRITE — no widget learns a
// second input shape, and there is no conversion step to forget. That is also why nothing
// in either port had to change to accept it.
//
// `Symbol.species` IS `Array`, AND IT IS NOT DECORATION. `map`, `filter`, `slice` and
// `concat` build their result through `ArraySpeciesCreate`, which calls the constructor
// with a LENGTH. This class's constructor takes `{ strings }`, so a species-built result
// would read that number as a props bag and answer an empty list — silently, inside
// `normalizeComboOptions`, which maps. Handing those methods plain `Array` back is the
// whole fix; `gio-menu.ts` needs none because it never overrode the constructor.
//
// WHAT IT IS NOT. `GtkStringList` is a `GListModel` of `GtkStringObject`s, with
// `items-changed`, an item type and `get_item()`. None of that is here: `listItemsChanged`
// in `list.ts` already computes the splice a renderer needs, and there is no
// `Gtk.StringObject` on any port to hand back. This is the half that BUILDS a list.
//
// `find` IS DELIBERATELY NOT OVERRIDDEN. `gtk_string_list_find` takes a string and answers
// a position; `Array.prototype.find` takes a predicate and answers an element. One name,
// two incompatible meanings, and the JS one is the one every consumer of an array already
// calls — so overriding it would break `list.find((s) => …)` to buy a spelling nobody
// wrote. `indexOf` is the JS name for what GIR calls `find`.
//
// Reference: @girs/gtk-4.0 5.4.0 — `Gtk.StringList` ConstructorProps (`strings: string[]`)
// and its `append`, `take`, `remove`, `splice`, `get_string`, `get_n_items` methods.
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/**
 * What `new Gtk.StringList({ … })` takes — the GJS spelling of the type's own
 * construct-time properties.
 *
 * `strings` only. The other two `StringList` declares — `item-type` and `n-items` — are
 * `GListModel`'s read-only pair, and a construct bag that accepted them would be offering
 * a write the type does not have.
 */
export interface GtkStringListProps {
    /** The strings the list starts with. */
    strings?: readonly string[] | null;
}

/**
 * A list of strings under construction — `Gtk.StringList`'s building half over a plain
 * JS array.
 *
 * `new GtkStringList()` is empty, as `gtk_string_list_new(NULL)` is, and the instance IS
 * the value a `model` property takes.
 */
export class GtkStringList extends Array<string> {
    /** See the file header: `map`/`filter`/`slice` must not call this constructor. */
    static get [Symbol.species](): ArrayConstructor {
        return Array;
    }

    constructor(props?: GtkStringListProps | null) {
        super();
        for (const string of props?.strings ?? []) this.push(string);
    }

    /** `gtk_string_list_append`. */
    append(string: string): void {
        this.push(string);
    }

    /**
     * `gtk_string_list_take` — `append` without the copy.
     *
     * The copy is what the two differ by in C ("this variant … is convenient for
     * formatting strings"), and JS strings are immutable, so here the two are one
     * function. It exists so code ported from GJS keeps working rather than to say
     * something `append` does not.
     */
    take(string: string): void {
        this.push(string);
    }

    /** `gtk_string_list_remove` — the string at `position`, which must be in range. */
    remove(position: number): void {
        Array.prototype.splice.call(this, position, 1);
    }

    /**
     * `gtk_string_list_splice` AND `Array.prototype.splice`, which is the point.
     *
     * The two say the same thing and pass the additions differently: C takes ONE array of
     * them, JS takes them as rest arguments. A list whose elements are strings can tell
     * the two apart with no ambiguity — an element is never an array — so both spellings
     * work and a `list.splice(1, 2, ['a', 'b'])` ported straight from GJS inserts two
     * strings instead of silently inserting one array as an element.
     *
     * `nRemovals` omitted is `Array.prototype.splice`'s "to the end", which is a different
     * thing from passing `undefined` — so it is spelled as the count that reaches the end,
     * which `splice` clamps the same way for a negative `position` as the one-argument form
     * does.
     */
    splice(position: number, nRemovals?: number, ...additions: readonly (string | readonly string[])[]): string[] {
        const removals = nRemovals ?? this.length - position;
        const flat = additions.flatMap((entry) => (typeof entry === 'string' ? [entry] : [...entry]));
        return Array.prototype.splice.call(this, position, removals, ...flat) as string[];
    }

    /** `gtk_string_list_get_string` — `null` past the end, as C returns `NULL`. */
    get_string(position: number): string | null {
        return this[position] ?? null;
    }

    /** `g_list_model_get_n_items`, which a `GtkStringList` answers with its length. */
    get_n_items(): number {
        return this.length;
    }
}
