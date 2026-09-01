// The libadwaita half of `@gjsify/adwaita-web`'s vocabulary — `Adw.ActionRow`,
// `Adw.Clamp`, one member per element whose own tag is an `adw-*` tag in the GIR.
// `export * as Adw from './namespace/adw.js'` in `src/index.ts` turns this module into
// the namespace object.
//
// ADR 0034 clause 2, and since § Amendment 6 this is the ONLY way to reach one of these
// widget classes: the prefixed `AdwActionRow` / `GtkEntry` exports are gone from the
// package root. The TAGS are untouched — `<adw-action-row>` and `<gtk-entry>` are what
// they were, and nothing here changes a registration.
//
// It landed additive, and the amendment says why that could not be the end state: a
// second spelling that never goes away is a permanent second vocabulary, which is the
// thing clause 2 exists to remove.
//
// WHICH NAMESPACE A MEMBER LANDS IN IS NOT A CHOICE MADE HERE. It is read off the GIR tag
// the element already answers to, which is clause 1 applied rather than restated:
//
//   * the element's own spelling IS a tag in gtk-host's generated widget table
//     (`adw-action-row`) -> libadwaita owns the GType -> `Adw.ActionRow`, this file;
//   * the element is declared in `WEB_ELEMENT_ALIGNMENT` as an alias of a `gtk-*` tag
//     (`<adw-entry>` is `gtk-entry`) -> GTK owns the GType -> `Gtk.Entry`, `./gtk.ts`.
//     On those the `adw-` prefix names the design system and not the widget, which is
//     what each entry's `why` already says; exporting them under `Adw` would carry the
//     flattening this ADR exists to undo one indirection further in.
//
// THE `webOnly` ELEMENTS GET NO MEMBER, and that absence IS the declaration. A
// `webOnly` entry says no widget in the reference vocabulary stands behind the element,
// so there is no GIR name to export it under; a member invented for one could only ever
// be held against this repository's own prose, which ADR 0034 § 5 names as the half that
// cannot go red. Some of them do name a real libadwaita GType — `AdwTabPage`,
// `AdwViewStackPage`, `AdwSidebarItem`, `AdwSidebarSection` descend from `GObject.Object`
// and not `GtkWidget`, so a table of concrete widgets has no row for them — and they are
// why this is worth stating: the day the reference table starts carrying one, its member
// appears here by itself, because the derivation reads that table. `<adw-toggle>` already
// made that move (ADR 0028 § Amendment, 2026-08-28) and needed no edit here.
//
// WHY A RE-EXPORT BARREL AND NOT AN OBJECT LITERAL. It was `export const Adw = { … }`
// beside a merged `export namespace Adw { … }` of instance types, so that `Adw.HeaderBar`
// could annotate as well as construct — every call site in this repository imports these
// classes with `import type`. `tsc` accepts that merge; ROLLDOWN'S oxc PARSER DOES NOT,
// and it fails at PARSE time — `Identifier \`Adw\` has already been declared`, a
// PARSE_ERROR out of `Bundler::generate` that took every showcase importing this package
// with it while `gjsify tsc` stayed green. The two check different things and the bundler
// is the stricter one. An `export { X as Y } from` line needs no merge and no TypeScript
// construct at all: a module namespace carries the value AND the type meaning of every
// name in it, so `new Adw.HeaderBar()` and `as Adw.HeaderBar` both work off ONE list.
// A second list of instance types could drift from the first; this one cannot exist.
//
// WHAT HOLDS IT: the namespace half of `scripts/check-vocabulary-alignment.mjs`. It
// derives the members from the elements `customElements.define` registers and the
// alignment table, and compares in both directions — an element with no member fails, a
// member with no element fails, and a member bound to a class that is not that element's
// fails. `namespaceExport` in `scripts/adwaita-elements.mjs` follows the one hop from
// `src/index.ts` to this file and reads the LEFT side of each `as` as the binding.

export { AdwAboutDialog as AboutDialog } from '../elements/adw-about-dialog.js';
export { AdwActionRow as ActionRow } from '../elements/adw-action-row.js';
export { AdwAlertDialog as AlertDialog } from '../elements/adw-alert-dialog.js';
export { AdwAvatar as Avatar } from '../elements/adw-avatar.js';
export { AdwBanner as Banner } from '../elements/adw-banner.js';
export { AdwBottomSheet as BottomSheet } from '../elements/adw-bottom-sheet.js';
export { AdwButtonContent as ButtonContent } from '../elements/adw-button-content.js';
export { AdwButtonRow as ButtonRow } from '../elements/adw-button-row.js';
export { AdwCarousel as Carousel } from '../elements/adw-carousel.js';
export { AdwCarouselIndicatorDots as CarouselIndicatorDots } from '../elements/adw-carousel.js';
export { AdwCarouselIndicatorLines as CarouselIndicatorLines } from '../elements/adw-carousel.js';
export { AdwClamp as Clamp } from '../elements/adw-clamp.js';
export { AdwComboRow as ComboRow } from '../elements/adw-combo-row.js';
export { AdwDialog as Dialog } from '../elements/adw-dialog.js';
export { AdwEntryRow as EntryRow } from '../elements/adw-entry-row.js';
export { AdwExpanderRow as ExpanderRow } from '../elements/adw-expander-row.js';
export { AdwHeaderBar as HeaderBar } from '../elements/adw-header-bar.js';
export { AdwInlineViewSwitcher as InlineViewSwitcher } from '../elements/adw-inline-view-switcher.js';
export { AdwNavigationPage as NavigationPage } from '../elements/adw-navigation-view.js';
export { AdwNavigationSplitView as NavigationSplitView } from '../elements/adw-navigation-split-view.js';
export { AdwNavigationView as NavigationView } from '../elements/adw-navigation-view.js';
export { AdwOverlaySplitView as OverlaySplitView } from '../elements/adw-overlay-split-view.js';
export { AdwPasswordEntryRow as PasswordEntryRow } from '../elements/adw-password-entry-row.js';
export { AdwPreferencesDialog as PreferencesDialog } from '../elements/adw-preferences-dialog.js';
export { AdwPreferencesGroup as PreferencesGroup } from '../elements/adw-preferences-group.js';
export { AdwPreferencesPage as PreferencesPage } from '../elements/adw-preferences-dialog.js';
export { AdwShortcutLabel as ShortcutLabel } from '../elements/adw-shortcut-label.js';
export { AdwSidebar as Sidebar } from '../elements/adw-sidebar.js';
export { AdwSpinRow as SpinRow } from '../elements/adw-spin-row.js';
export { AdwSpinner as Spinner } from '../elements/adw-spinner.js';
export { AdwSplitButton as SplitButton } from '../elements/adw-split-button.js';
export { AdwStatusPage as StatusPage } from '../elements/adw-status-page.js';
export { AdwSwitchRow as SwitchRow } from '../elements/adw-switch-row.js';
export { AdwTabView as TabView } from '../elements/adw-tab-view.js';
export { AdwToastOverlay as ToastOverlay } from '../elements/adw-toast-overlay.js';
export { AdwToggle as Toggle } from '../elements/adw-toggle-group.js';
export { AdwToggleGroup as ToggleGroup } from '../elements/adw-toggle-group.js';
export { AdwToolbarView as ToolbarView } from '../elements/adw-toolbar-view.js';
export { AdwViewStack as ViewStack } from '../elements/adw-view-stack.js';
export { AdwViewSwitcher as ViewSwitcher } from '../elements/adw-view-switcher.js';
export { AdwViewSwitcherBar as ViewSwitcherBar } from '../elements/adw-view-switcher-bar.js';
export { AdwWindow as Window } from '../elements/adw-window.js';
export { AdwWindowTitle as WindowTitle } from '../elements/adw-window-title.js';
export { AdwWrapBox as WrapBox } from '../elements/adw-wrap-box.js';
