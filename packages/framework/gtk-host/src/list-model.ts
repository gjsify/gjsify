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
 * A portable list model as a live `Gtk.StringList`.
 *
 * Accepts the AUTHORED form as well as the normalised one: `normalizeComboOptions` is
 * total and idempotent, so a JSX attribute needs no conversion step of its own, and a
 * renderer handing its own normalised model back in takes the same door.
 */
export function buildStringList(input: AdwListModelInput): Gtk.StringList {
    return new Gtk.StringList({ strings: normalizeComboOptions(input).map((option) => option.label) });
}

/**
 * Whether a value is a portable list model rather than a `Gio.ListModel`.
 *
 * An ARRAY, and nothing else — the same test `isPortableMenu` makes. A `Gio.ListModel`
 * is a GObject and never an array, so the imperative path (a real `Gtk.StringList`, a
 * `Gio.ListStore`) is never mistaken for the portable one.
 */
export const isPortableListModel = (value: unknown): value is AdwListModelInput => Array.isArray(value);

/**
 * A `Gtk.StringList` back as a portable model — the inverse of {@link buildStringList}
 * for the half that crosses.
 *
 * It exists to make the claim above measurable: `list-model.spec.ts` drives every
 * `LIST_NORMALIZE_VECTORS` row through the builder and back through this, so a label
 * that stopped arriving fails a test naming it instead of vanishing from a popup.
 */
export function fromStringList(model: Gtk.StringList): AdwListModel {
    const items: { value: string; label: string }[] = [];
    for (let index = 0; index < model.get_n_items(); index += 1) {
        const label = model.get_string(index) ?? '';
        items.push({ value: label, label });
    }
    return items;
}
