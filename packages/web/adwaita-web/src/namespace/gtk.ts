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
export { GtkActionBar as ActionBar } from '../elements/gtk-action-bar.js';
export { GtkAspectFrame as AspectFrame } from '../elements/gtk-aspect-frame.js';
export { GtkBox as Box } from '../elements/gtk-box.js';
export { GtkButton as Button } from '../elements/gtk-button.js';
export { GtkCenterBox as CenterBox } from '../elements/gtk-center-box.js';
export { GtkCheckButton as CheckButton } from '../elements/checks.js';
export { GtkColorDialogButton as ColorDialogButton } from '../elements/gtk-color-dialog-button.js';
export { GtkColumnView as ColumnView } from '../elements/gtk-column-view.js';
export { GtkDropDown as DropDown } from '../elements/gtk-drop-down.js';
export { GtkEditableLabel as EditableLabel } from '../elements/gtk-editable-label.js';
export { GtkEntry as Entry } from '../elements/gtk-entry.js';
export { GtkExpander as Expander } from '../elements/gtk-expander.js';
export { GtkFixed as Fixed } from '../elements/gtk-fixed.js';
export { GtkFontDialogButton as FontDialogButton } from '../elements/gtk-font-dialog-button.js';
export { GtkFrame as Frame } from '../elements/gtk-frame.js';
export { GtkGrid as Grid } from '../elements/gtk-grid.js';
export { GtkGridView as GridView } from '../elements/gtk-grid-view.js';
export { GtkImage as Image } from '../elements/gtk-image.js';
export { GtkLinkButton as LinkButton } from '../elements/gtk-link-button.js';
export { GtkLabel as Label } from '../elements/gtk-label.js';
export { GtkLevelBar as LevelBar } from '../elements/gtk-level-bar.js';
export { GtkListView as ListView } from '../elements/gtk-list-view.js';
export { GtkMenuButton as MenuButton } from '../elements/gtk-menu-button.js';
export { GtkOverlay as Overlay } from '../elements/gtk-overlay.js';
export { GtkPaned as Paned } from '../elements/gtk-paned.js';
export { GtkPasswordEntry as PasswordEntry } from '../elements/gtk-password-entry.js';
export { GtkPopover as Popover } from '../elements/gtk-popover.js';
export { GtkPopoverBin as PopoverBin } from '../elements/gtk-popover-bin.js';
export { GtkPopoverMenu as PopoverMenu } from '../elements/gtk-popover-menu.js';
export { GtkPopoverMenuBar as PopoverMenuBar } from '../elements/gtk-popover-menu-bar.js';
export { GtkProgressBar as ProgressBar } from '../elements/gtk-progress-bar.js';
export { GtkRevealer as Revealer } from '../elements/gtk-revealer.js';
export { GtkScale as Scale } from '../elements/gtk-scale.js';
export { GtkScaleButton as ScaleButton } from '../elements/gtk-scale-button.js';
export { GtkSearchBar as SearchBar } from '../elements/gtk-search-bar.js';
export { GtkSearchEntry as SearchEntry } from '../elements/gtk-search-entry.js';
export { GtkSeparator as Separator } from '../elements/gtk-separator.js';
export { GtkSpinButton as SpinButton } from '../elements/gtk-spin-button.js';
export { GtkSpinner as Spinner } from '../elements/gtk-spinner.js';
export { GtkStringList as StringList } from '@gjsify/adwaita-core';
export { GtkSwitch as Switch } from '../elements/gtk-switch.js';
export { GtkText as Text } from '../elements/gtk-text.js';
export { GtkTextView as TextView } from '../elements/gtk-text-view.js';
export { GtkToggleButton as ToggleButton } from '../elements/gtk-toggle-button.js';
export { GtkTreeExpander as TreeExpander } from '../elements/gtk-tree-expander.js';
