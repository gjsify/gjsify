// The portable list model as a real `Gtk.StringList` (ADR 0046 § Amendment).
//
// The sibling of `menu.ts`, for the same reason it exists: `@gjsify/adwaita-core` is
// headless by contract (ADR 0015) and may not import `gi://`, so the SHAPE of the value
// is shared and the CONSTRUCTION is here. `coerce` in `props.ts` calls {@link
// buildStringList} at the ParamSpec seam, so `<adw-combo-row model={['Blue', 'Teal']}>`
// is the same write as `<gtk-box orientation="vertical"/>`: an authored value the host
// turns into what GObject will store. Before this module the value existed on three
// renderers and reached GTK on none, and the website gallery refused `Adw.ComboRow` and
// `Gtk.DropDown` a Solid/Vue/React snippet for exactly that gap.
//
// WHY A `Gtk.StringList` AND NOT A STORE OF SOMETHING RICHER. `Adw.ComboRow` and
// `Gtk.DropDown` draw a `Gtk.StringObject` with no factory and no expression — it is the
// model `Gtk.DropDown.new_from_strings` builds and the one the common case is fed. A
// store of richer objects would need an `expression` written beside it, which is a
// SECOND property from one prop, and the seam writes one property per prop.
//
// A LIST THE SEAM BUILT IS UPDATED IN PLACE, NEVER REPLACED. `AdwComboRow:selected` is a
// POSITION into the model, and replacing the model takes it away. MEASURED on GTK 4.22.4
// through a real `Adw.ComboRow` and a real `Gtk.DropDown`, selected 2 of `['a','b','c']`:
// `model = new Gtk.StringList(…)` lands on 0 — with ONE label changed and with the SAME
// three strings alike — while `model.splice(…)` on the list the widget already holds
// keeps it: a whole-list splice keeps the position (2 → 2), a minimal one keeps the ITEM
// (prepend: 2 → 3 with the same string under it; remove one before it: 2 → 1). So
// `setProp` hands a freshly built list to {@link reconcileStringList}, which splices the
// common-prefix/suffix-trimmed difference into the held list and emits nothing at all
// when the strings are equal. That is also why a consumer needs no memo to keep an
// authored `model={['a','b']}` literal from resetting the selection on every render:
// the seam answers an unchanged array with silence. Only a list THIS module built is
// spliced — one an application handed in imperatively is its own object, and an array
// written over it replaces it, as the imperative line would. The neighbouring measurement
// in `list/controller.ts` chose a whole-model splice for a different reason (a factory
// re-binds a row when its model OBJECT changes); here the reason is the selection.
//
// WHAT DOES NOT CROSS, stated rather than left to be found. A `Gtk.StringObject` holds
// ONE string, so an item's `label` crosses and its `value` does not. On this surface
// that loses nothing an author could reach: GTK spells a selection as a POSITION
// (`AdwComboRow:selected`, a guint) and has no `selectedValue`, so the core's addressing
// vocabulary has no reader here. {@link fromStringList} therefore answers each label as
// its own value — the bare-string form an author writes in the common case — and
// `list-model.spec.ts` holds that against the shared vectors so the loss is a
// measurement, not a surprise.
//
// Values through `gi://`, types through `@girs/*`.

import Gtk from 'gi://Gtk?version=4.0';

import type { AdwListModel, AdwListModelInput } from '@gjsify/adwaita-core';
import { normalizeComboOptions } from '@gjsify/adwaita-core';

/**
 * The lists this module built, so {@link reconcileStringList} never splices an object an
 * application owns. Weak on purpose: the widget's reference is the only one that matters.
 */
const seamBuilt = new WeakSet<Gtk.StringList>();

/**
 * A portable list model as a live `Gtk.StringList`.
 *
 * Accepts the AUTHORED form as well as the normalised one: `normalizeComboOptions` is
 * total and idempotent, so a JSX attribute needs no conversion step of its own, and a
 * renderer handing its own normalised model back in takes the same door.
 */
export function buildStringList(input: AdwListModelInput): Gtk.StringList {
    const list = new Gtk.StringList({ strings: normalizeComboOptions(input).map((option) => option.label) });
    seamBuilt.add(list);
    return list;
}

/**
 * Whether a value is a portable list model rather than a `Gio.ListModel`.
 *
 * An ARRAY, and nothing else — the same test `isPortableMenu` makes. A `Gio.ListModel`
 * is a GObject and never an array, so the imperative path (a real `Gtk.StringList`, a
 * `Gio.ListStore`) is never mistaken for the portable one.
 */
export const isPortableListModel = (value: unknown): value is AdwListModelInput => Array.isArray(value);

/** The strings a `Gtk.StringList` holds, in order — read off GTK, never off an input. */
export function stringsOf(model: Gtk.StringList): string[] {
    const out: string[] = [];
    for (let index = 0; index < model.get_n_items(); index += 1) out.push(model.get_string(index) ?? '');
    return out;
}

/**
 * Splice a freshly built list's difference into the list `widget[accessor]` holds, if
 * both are this module's — see the header for the measurement that makes this a rule.
 *
 * Answers whether the write is DONE: `true` means the held list now reads as `fresh`
 * (an equal list is left untouched, so nothing is emitted); `false` means one of the two
 * is not the seam's, and the caller writes the property as it would any other.
 */
export function reconcileStringList(widget: object, accessor: string, fresh: unknown): boolean {
    if (!(fresh instanceof Gtk.StringList) || !seamBuilt.has(fresh)) return false;
    const held = (widget as Record<string, unknown>)[accessor];
    if (!(held instanceof Gtk.StringList) || !seamBuilt.has(held)) return false;
    const before = stringsOf(held);
    const after = stringsOf(fresh);
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore -= 1;
        endAfter -= 1;
    }
    if (start !== endBefore || start !== endAfter) held.splice(start, endBefore - start, after.slice(start, endAfter));
    return true;
}

/**
 * A `Gtk.StringList` back as a portable model — the inverse of {@link buildStringList}
 * for the half that crosses.
 *
 * It exists to make the claim above measurable: `list-model.spec.ts` drives every
 * `LIST_NORMALIZE_VECTORS` row through the builder and back through this, so a label
 * that stopped arriving fails a test naming it instead of vanishing from a popup.
 */
export function fromStringList(model: Gtk.StringList): AdwListModel {
    return stringsOf(model).map((label) => ({ value: label, label }));
}
