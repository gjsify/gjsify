// The GTK half of `@gjsify/adwaita-nativescript`'s vocabulary — `Gtk.Entry`, `Gtk.Button`,
// one member per widget that `NS_WIDGET_ALIGNMENT` declares a `gir` alias of a GTK GType.
// `export * as Gtk from './namespace/gtk.js'` in `src/index.ts` makes it the namespace.
//
// The derivation, the three widgets with no member, and why this is a re-export barrel
// rather than the object literal § Amendment 7 left here are all in `./adw.ts`. One
// statement of it, because a second copy is the one that drifts.
//
// `Gtk.Image` IS `AdwIcon`, and it is the one member whose binding does not read like its
// name. Converging the CLASS would also change the bare name (`icon` -> `image`), which is
// what `check-storybook-widget-coverage.mjs` joins the two renderers on, so the rename
// waits for `@gjsify/adwaita-web` to make it in the same change — ADR 0034 § Amendment 7,
// § Clause 1. The namespace does not have to wait: the member is read off the GIR tag the
// ledger already declares, so `Gtk.Image` is right here today and stays right after the
// class is renamed.

export { GtkButton as Button } from '../widgets/gtk-button.js';
export { GtkDropDown as DropDown } from '../widgets/gtk-drop-down.js';
export { GtkEntry as Entry } from '../widgets/gtk-entry.js';
export { AdwIcon as Image } from '../widgets/adw-icon.js';
export { GtkMenuButton as MenuButton } from '../widgets/gtk-menu-button.js';
