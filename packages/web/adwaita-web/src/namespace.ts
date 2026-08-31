// ADR 0034 clause 2 — the vocabulary is also reachable as a NAMESPACE (`Adw.ActionRow`,
// `Gtk.Entry`), not only as prefixed classes. Additive: every `Adw…` export keeps working,
// every `<adw-…>` tag keeps working, and nothing published moves.
//
// WHICH NAMESPACE A MEMBER LANDS IN IS NOT A CHOICE MADE HERE. It is read off the GIR tag
// the element already answers to, which is clause 1 applied rather than restated:
//
//   * the element's own spelling IS a tag in gtk-host's generated widget table
//     (`adw-action-row`) → libadwaita owns the GType → `Adw.ActionRow`;
//   * the element is declared in `WEB_ELEMENT_ALIGNMENT` as an alias of a `gtk-*` tag
//     (`<adw-entry>` is `gtk-entry`) → GTK owns the GType → `Gtk.Entry`. On those the
//     `adw-` prefix names the design system and not the widget, which is what each entry's
//     `why` already says; exporting them under `Adw` would carry the flattening this ADR
//     exists to undo one indirection further in.
//
// THE `webOnly` ELEMENTS GET NO MEMBER, and that absence IS the declaration. A
// `webOnly` entry says no widget in the reference vocabulary stands behind the element, so
// there is no GIR name to export it under; a member invented for one could only ever be
// held against this repository's own prose, which ADR 0034 § 5 names as the half that
// cannot go red. Some of them do name a real libadwaita GType — `AdwTabPage`,
// `AdwViewStackPage`, `AdwSidebarItem`, `AdwSidebarSection` descend from `GObject.Object`
// and not `GtkWidget`, so a table of concrete widgets has no row for them — and they are
// why this is worth stating: the day the reference table starts carrying one, its member
// appears here by itself, because the derivation reads that table. `<adw-toggle>` already
// made that move (ADR 0028 § Amendment, 2026-08-28) and needed no edit here.
//
// `Gtk.CheckButton` IS `AdwCheckbox`, NOT `AdwRadio` — the one name two elements declare.
// GTK4 has no radio type: a radio is a GtkCheckButton with its `group` set, which is what
// `<adw-radio>`'s own `why` in the ledger says. So the plain form takes the GIR name and
// the grouped one stays reachable as `AdwRadio`.
//
// IT LIVES BESIDE THE BARREL RATHER THAN IN IT because a member per element plus an import
// per module is construction, and `src/index.ts` is re-exports (root AGENTS.md § Code
// anti-patterns, monolithic entry points). `namespaceExport` in
// `scripts/adwaita-elements.mjs` follows the one re-export hop for exactly that reason.
//
// WHAT HOLDS IT: the namespace half of `scripts/check-vocabulary-alignment.mjs`. It derives
// the members from the elements `customElements.define` registers and the alignment table,
// and compares in both directions — an element with no member fails, a member with no
// element fails, and a member bound to a class that is not that element's fails.

import { AdwAboutDialog } from './elements/adw-about-dialog.js';
import { AdwActionRow } from './elements/adw-action-row.js';
import { AdwAlertDialog } from './elements/adw-alert-dialog.js';
import { AdwAvatar } from './elements/adw-avatar.js';
import { AdwBanner } from './elements/adw-banner.js';
import { AdwBottomSheet } from './elements/adw-bottom-sheet.js';
import { AdwButtonContent } from './elements/adw-button-content.js';
import { AdwButtonRow } from './elements/adw-button-row.js';
import { AdwButton } from './elements/adw-button.js';
import { AdwCarousel, AdwCarouselIndicatorDots, AdwCarouselIndicatorLines } from './elements/adw-carousel.js';
import { AdwCheckbox } from './elements/adw-checks.js';
import { AdwClamp } from './elements/adw-clamp.js';
import { AdwComboRow } from './elements/adw-combo-row.js';
import { AdwDialog } from './elements/adw-dialog.js';
import { AdwDropDown } from './elements/adw-drop-down.js';
import { AdwEntryRow } from './elements/adw-entry-row.js';
import { AdwEntry } from './elements/adw-entry.js';
import { AdwExpanderRow } from './elements/adw-expander-row.js';
import { AdwHeaderBar } from './elements/adw-header-bar.js';
import { AdwIcon } from './elements/adw-icon.js';
import { AdwInlineViewSwitcher } from './elements/adw-inline-view-switcher.js';
import { AdwMenuButton } from './elements/adw-menu-button.js';
import { AdwNavigationSplitView } from './elements/adw-navigation-split-view.js';
import { AdwNavigationPage, AdwNavigationView } from './elements/adw-navigation-view.js';
import { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';
import { AdwPasswordEntryRow } from './elements/adw-password-entry-row.js';
import { AdwPopover } from './elements/adw-popover.js';
import { AdwPreferencesDialog, AdwPreferencesPage } from './elements/adw-preferences-dialog.js';
import { AdwPreferencesGroup } from './elements/adw-preferences-group.js';
import { AdwProgressBar } from './elements/adw-progress-bar.js';
import { AdwShortcutLabel } from './elements/adw-shortcut-label.js';
import { AdwSidebar } from './elements/adw-sidebar.js';
import { AdwSpinRow } from './elements/adw-spin-row.js';
import { AdwSpinner } from './elements/adw-spinner.js';
import { AdwSplitButton } from './elements/adw-split-button.js';
import { AdwStatusPage } from './elements/adw-status-page.js';
import { AdwSwitchRow } from './elements/adw-switch-row.js';
import { AdwSwitch } from './elements/adw-switch.js';
import { AdwTabView } from './elements/adw-tab-view.js';
import { AdwToastOverlay } from './elements/adw-toast-overlay.js';
import { AdwToggle, AdwToggleGroup } from './elements/adw-toggle-group.js';
import { AdwToolbarView } from './elements/adw-toolbar-view.js';
import { AdwViewStack } from './elements/adw-view-stack.js';
import { AdwViewSwitcherBar } from './elements/adw-view-switcher-bar.js';
import { AdwViewSwitcher } from './elements/adw-view-switcher.js';
import { AdwWindowTitle } from './elements/adw-window-title.js';
import { AdwWindow } from './elements/adw-window.js';
import { AdwWrapBox } from './elements/adw-wrap-box.js';

/** The libadwaita half: every element whose own spelling is an `adw-*` tag in the GIR. */
export const Adw = {
    AboutDialog: AdwAboutDialog,
    ActionRow: AdwActionRow,
    AlertDialog: AdwAlertDialog,
    Avatar: AdwAvatar,
    Banner: AdwBanner,
    BottomSheet: AdwBottomSheet,
    ButtonContent: AdwButtonContent,
    ButtonRow: AdwButtonRow,
    Carousel: AdwCarousel,
    CarouselIndicatorDots: AdwCarouselIndicatorDots,
    CarouselIndicatorLines: AdwCarouselIndicatorLines,
    Clamp: AdwClamp,
    ComboRow: AdwComboRow,
    Dialog: AdwDialog,
    EntryRow: AdwEntryRow,
    ExpanderRow: AdwExpanderRow,
    HeaderBar: AdwHeaderBar,
    InlineViewSwitcher: AdwInlineViewSwitcher,
    NavigationPage: AdwNavigationPage,
    NavigationSplitView: AdwNavigationSplitView,
    NavigationView: AdwNavigationView,
    OverlaySplitView: AdwOverlaySplitView,
    PasswordEntryRow: AdwPasswordEntryRow,
    PreferencesDialog: AdwPreferencesDialog,
    PreferencesGroup: AdwPreferencesGroup,
    PreferencesPage: AdwPreferencesPage,
    ShortcutLabel: AdwShortcutLabel,
    Sidebar: AdwSidebar,
    SpinRow: AdwSpinRow,
    Spinner: AdwSpinner,
    SplitButton: AdwSplitButton,
    StatusPage: AdwStatusPage,
    SwitchRow: AdwSwitchRow,
    TabView: AdwTabView,
    ToastOverlay: AdwToastOverlay,
    Toggle: AdwToggle,
    ToggleGroup: AdwToggleGroup,
    ToolbarView: AdwToolbarView,
    ViewStack: AdwViewStack,
    ViewSwitcher: AdwViewSwitcher,
    ViewSwitcherBar: AdwViewSwitcherBar,
    Window: AdwWindow,
    WindowTitle: AdwWindowTitle,
    WrapBox: AdwWrapBox,
};

/** The GTK half: the elements the alignment table declares an alias of a `gtk-*` tag. */
export const Gtk = {
    Button: AdwButton,
    CheckButton: AdwCheckbox,
    DropDown: AdwDropDown,
    Entry: AdwEntry,
    Image: AdwIcon,
    MenuButton: AdwMenuButton,
    Popover: AdwPopover,
    ProgressBar: AdwProgressBar,
    Switch: AdwSwitch,
};
