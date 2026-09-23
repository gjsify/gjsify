// The GTK half of `@gjsify/adwaita-nativescript`'s vocabulary — `Gtk.Entry`, `Gtk.Button`,
// one member per widget that `NS_WIDGET_ALIGNMENT` declares a `gir` alias of a GTK GType.
// `export * as Gtk from './namespace/gtk.js'` in `src/index.ts` makes it the namespace.
//
// The derivation, the three widgets with no member, and why this is a re-export barrel
// rather than the object literal § Amendment 7 left here are all in `./adw.ts`. One
// statement of it, because a second copy is the one that drifts.
//
// `Gtk.Image` IS `GtkImage`, and it is the one member whose binding does not read like its
// name. Converging the CLASS would also change the bare name (`icon` -> `image`), which is
// what `check-storybook-widget-coverage.mjs` joins the two renderers on, so the rename
// waits for `@gjsify/adwaita-web` to make it in the same change — ADR 0034 § Amendment 7,
// § Clause 1. The namespace does not have to wait: the member is read off the GIR tag the
// ledger already declares, so `Gtk.Image` is right here today and stays right after the
// class is renamed.
//
// TWO MEMBERS HERE ARE NOT WIDGETS — `Gtk.Adjustment` and `Gtk.StringList`, the values an
// `adjustment` and a `model` property take. ADR 0034 § Amendment 19 is what lets a
// clause-2 namespace carry them, `CONSTRUCTIBLE_VALUES` in `scripts/value-types.mjs` is
// where each one is declared, and the GIR answers for both in gtk-host's committed
// `generated/value-types.mts`. They are re-exported from `@gjsify/adwaita-core`, which is
// where the portable list and adjustment already live: the class IS that value wearing the
// GIR spelling, so `model: ['a','b']` and `model: new Gtk.StringList({ strings: ['a','b'] })`
// are the same write and nothing in this package had to learn a second input shape.

export { GtkAdjustment as Adjustment } from '@gjsify/adwaita-core';
export { GtkActionBar as ActionBar } from '../widgets/gtk-action-bar.js';
export { GtkBox as Box } from '../widgets/gtk-box.js';
export { GtkButton as Button } from '../widgets/gtk-button.js';
export { GtkDropDown as DropDown } from '../widgets/gtk-drop-down.js';
export { GtkEntry as Entry } from '../widgets/gtk-entry.js';
export { GtkImage as Image } from '../widgets/gtk-image.js';
export { GtkLabel as Label } from '../widgets/gtk-label.js';
export { GtkMenuButton as MenuButton } from '../widgets/gtk-menu-button.js';
export { GtkStringList as StringList } from '@gjsify/adwaita-core';
