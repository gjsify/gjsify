// The libadwaita half of `@gjsify/adwaita-nativescript`'s vocabulary — `Adw.SwitchRow`,
// `Adw.Clamp`, one member per widget whose own spelling is an `adw-*` tag in the GIR.
// `export * as Adw from './namespace/adw.js'` in `src/index.ts` turns this module into
// the namespace object.
//
// ADR 0034 clause 2, and since § Amendment 9 this is the ONLY way to reach one of these
// widget classes: the prefixed `AdwSwitchRow` / `GtkEntry` exports are gone from the
// package root, exactly as § Amendment 6 removed them from `@gjsify/adwaita-web`. The
// CLASSES did not move — `adw-switch-row.ts` still declares `class AdwSwitchRow`,
// because `check-adwaita-tag-vs-class.mjs` derives that name from the file and clause 1
// is what puts the file there. What moved is one line in one barrel, and the XML dialect
// that reads this list.
//
// WHICH NAMESPACE A MEMBER LANDS IN IS NOT A CHOICE MADE HERE. It is read off the GIR tag
// the widget already answers to, which is clause 1 applied rather than restated:
//
//   * the widget file's own spelling IS a tag in gtk-host's generated widget table
//     (`adw-action-row`) -> libadwaita owns the GType -> `Adw.ActionRow`, this file;
//   * `NS_WIDGET_ALIGNMENT` declares the widget a `gir` alias of a GType whose tag is
//     `gtk-*` (`gtk-image` is `GtkImage`) -> GTK owns the GType -> `Gtk.Image`, `./gtk.ts`.
//
// THE LOOKUP IS THE DIFFERENCE FROM THE WEB SURFACE, and ADR 0034 § 3 says so: this
// ledger is keyed on GTYPES (`gir: 'GtkButton'`), not on tags, so placing a member is a
// lookup through the generated table rather than the prefix split `adwaita-web` gets.
//
// THREE WIDGETS GET NO MEMBER, and that absence IS the declaration. `AdwSliderRow` and
// `AdwDataGrid` are declared `own` — no counterpart type exists, so there is no GIR name
// to export them under. `AdwImageButton` is declared a `composes` of `GtkButton` +
// `GtkImage`: a composition has no single GIR name, and the one ADR 0034 § 1 suggests for
// it (`gtk-button`) is already taken by the plain button this port ALSO ships. One GIR
// name cannot name two constructors — the same collision `Gtk.CheckButton` met on the web
// surface — so the plain form takes the name and the composed one keeps its flat export.
//
// WHY A RE-EXPORT BARREL AND NOT THE OBJECT LITERAL IT WAS. § Amendment 7 kept the
// literal here on the ground that "nothing here annotates with `Adw.ActionRow`: this
// surface's widgets are constructed and its consumers import the class". Removing the
// flat exports is what made that false — `packages/nativescript-bridge/storybook/src/app.ts`
// imports `AdwPreferencesDialog` with `import type`, and so does one published `.mdx`
// fence. An object literal gives `Adw.X` in VALUE position only, and merging it with a
// type-only `export namespace Adw { … }` is a rolldown PARSE_ERROR (`Identifier `Adw` has
// already been declared`) even though `tsc` accepts the merge — measured on the web
// surface, § Amendment 6. A module namespace carries the value AND the type meaning off
// ONE list, so `new Adw.PreferencesDialog()` and `: Adw.PreferencesDialog` both work and
// the two meanings have no place to drift apart.
//
// WHAT HOLDS IT: the namespace half of `scripts/check-vocabulary-alignment.mjs`, over this
// surface as well as the web one. It derives the members from the widget files on disk and
// `NS_WIDGET_ALIGNMENT`, and compares in both directions — a widget with no member fails,
// a member with no widget fails, and a member bound to a class that is not that widget's
// fails. The same gate's caller half holds the OTHER direction of § Amendment 9: no
// consumer in this repository may name a retired flat spelling.

export { AdwAboutDialog as AboutDialog } from '../widgets/adw-about-dialog.js';
export { AdwActionRow as ActionRow } from '../widgets/adw-action-row.js';
export { AdwAlertDialog as AlertDialog } from '../widgets/adw-alert-dialog.js';
export { AdwAvatar as Avatar } from '../widgets/adw-avatar.js';
export { AdwBanner as Banner } from '../widgets/adw-banner.js';
export { AdwBottomSheet as BottomSheet } from '../widgets/adw-bottom-sheet.js';
export { AdwButtonContent as ButtonContent } from '../widgets/adw-button-content.js';
export { AdwButtonRow as ButtonRow } from '../widgets/adw-button-row.js';
export { AdwCarousel as Carousel } from '../widgets/adw-carousel.js';
export { AdwClamp as Clamp } from '../widgets/adw-clamp.js';
export { AdwComboRow as ComboRow } from '../widgets/adw-combo-row.js';
export { AdwEntryRow as EntryRow } from '../widgets/adw-entry-row.js';
export { AdwExpanderRow as ExpanderRow } from '../widgets/adw-expander-row.js';
export { AdwHeaderBar as HeaderBar } from '../widgets/adw-header-bar.js';
export { AdwInlineViewSwitcher as InlineViewSwitcher } from '../widgets/adw-inline-view-switcher.js';
export { AdwNavigationSplitView as NavigationSplitView } from '../widgets/adw-navigation-split-view.js';
export { AdwNavigationView as NavigationView } from '../widgets/adw-navigation-view.js';
export { AdwOverlaySplitView as OverlaySplitView } from '../widgets/adw-overlay-split-view.js';
export { AdwPasswordEntryRow as PasswordEntryRow } from '../widgets/adw-password-entry-row.js';
export { AdwPreferencesDialog as PreferencesDialog } from '../widgets/adw-preferences-dialog.js';
export { AdwPreferencesGroup as PreferencesGroup } from '../widgets/adw-preferences-group.js';
export { AdwPreferencesPage as PreferencesPage } from '../widgets/adw-preferences-page.js';
export { AdwShortcutLabel as ShortcutLabel } from '../widgets/adw-shortcut-label.js';
export { AdwSidebar as Sidebar } from '../widgets/adw-sidebar.js';
export { AdwSpinRow as SpinRow } from '../widgets/adw-spin-row.js';
export { AdwSpinner as Spinner } from '../widgets/adw-spinner.js';
export { AdwSplitButton as SplitButton } from '../widgets/adw-split-button.js';
export { AdwStatusPage as StatusPage } from '../widgets/adw-status-page.js';
export { AdwSwitchRow as SwitchRow } from '../widgets/adw-switch-row.js';
export { AdwTabView as TabView } from '../widgets/adw-tab-view.js';
export { AdwToastOverlay as ToastOverlay } from '../widgets/adw-toast-overlay.js';
export { AdwToggleGroup as ToggleGroup } from '../widgets/adw-toggle-group.js';
export { AdwToolbarView as ToolbarView } from '../widgets/adw-toolbar-view.js';
export { AdwViewStack as ViewStack } from '../widgets/adw-view-stack.js';
export { AdwViewSwitcher as ViewSwitcher } from '../widgets/adw-view-switcher.js';
export { AdwViewSwitcherBar as ViewSwitcherBar } from '../widgets/adw-view-switcher-bar.js';
export { AdwWindowTitle as WindowTitle } from '../widgets/adw-window-title.js';
export { AdwWrapBox as WrapBox } from '../widgets/adw-wrap-box.js';
