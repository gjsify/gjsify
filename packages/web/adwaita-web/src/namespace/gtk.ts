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
export { GtkBox as Box } from '../elements/gtk-box.js';
export { GtkButton as Button } from '../elements/gtk-button.js';
export { GtkCheckButton as CheckButton } from '../elements/checks.js';
export { GtkDropDown as DropDown } from '../elements/gtk-drop-down.js';
export { GtkEntry as Entry } from '../elements/gtk-entry.js';
export { GtkImage as Image } from '../elements/gtk-image.js';
export { GtkLabel as Label } from '../elements/gtk-label.js';
export { GtkMenuButton as MenuButton } from '../elements/gtk-menu-button.js';
export { GtkPopover as Popover } from '../elements/gtk-popover.js';
export { GtkProgressBar as ProgressBar } from '../elements/gtk-progress-bar.js';
export { GtkStringList as StringList } from '@gjsify/adwaita-core';
export { GtkSwitch as Switch } from '../elements/gtk-switch.js';
