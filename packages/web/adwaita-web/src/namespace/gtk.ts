// The GTK half of `@gjsify/adwaita-web`'s vocabulary — `Gtk.Entry`, `Gtk.Button`, one
// member per element that `WEB_ELEMENT_ALIGNMENT` declares an alias of a `gtk-*` tag.
// `export * as Gtk from './namespace/gtk.js'` in `src/index.ts` makes it the namespace.
//
// The derivation, the reason these are NOT `Adw.*`, why the `webOnly` elements have no
// member, and why this is a re-export barrel rather than an object literal are all in
// `./adw.ts`. One statement of it, because a second copy is the one that drifts.
//
// `Gtk.CheckButton` IS `GtkCheckButton`, NOT `AdwRadio` — the one GIR name two elements
// declare. GTK4 has no radio type: a radio is a GtkCheckButton with its `group` set,
// which is what `<adw-radio>`'s own `why` in the ledger says. So the plain form takes the
// GIR name and the grouped one keeps its flat export in `src/index.ts`.

export { GtkButton as Button } from '../elements/gtk-button.js';
export { GtkCheckButton as CheckButton } from '../elements/checks.js';
export { GtkDropDown as DropDown } from '../elements/gtk-drop-down.js';
export { GtkEntry as Entry } from '../elements/gtk-entry.js';
export { GtkImage as Image } from '../elements/gtk-image.js';
export { GtkMenuButton as MenuButton } from '../elements/gtk-menu-button.js';
export { GtkPopover as Popover } from '../elements/gtk-popover.js';
export { GtkProgressBar as ProgressBar } from '../elements/gtk-progress-bar.js';
export { GtkSwitch as Switch } from '../elements/gtk-switch.js';
