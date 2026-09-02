// ADR 0034 clause 2 — the vocabulary is also reachable as a NAMESPACE (`Adw.ActionRow`,
// `Gtk.Entry`), not only as prefixed classes. Additive: every `Adw…` export keeps working,
// every `<adw:AdwSwitchRow>` XML element keeps resolving, and nothing published moves.
//
// WHICH NAMESPACE A MEMBER LANDS IN IS NOT A CHOICE MADE HERE. It is read off the GIR tag
// the widget already answers to, which is clause 1 applied rather than restated:
//
//   * the widget file's own spelling IS a tag in gtk-host's generated widget table
//     (`adw-action-row`) → libadwaita owns the GType → `Adw.ActionRow`;
//   * `NS_WIDGET_ALIGNMENT` declares the widget a `gir` alias of a GType whose tag is
//     `gtk-*` (`adw-entry` is `GtkEntry`) → GTK owns the GType → `Gtk.Entry`.
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
// surface — so the plain form takes the name and the composed one stays reachable as
// `AdwImageButton`.
//
// IT LIVES BESIDE THE BARREL RATHER THAN IN IT because a member per widget plus an import
// per module is construction, and `src/index.ts` is re-exports (root AGENTS.md § Code
// anti-patterns, monolithic entry points). `namespaceExport` in
// `scripts/adwaita-elements.mjs` follows the one re-export hop for exactly that reason.
//
// WHAT HOLDS IT: the namespace half of `scripts/check-vocabulary-alignment.mjs`, over this
// surface as well as the web one. It derives the members from the widget files on disk and
// `NS_WIDGET_ALIGNMENT`, and compares in both directions — a widget with no member fails,
// a member with no widget fails, and a member bound to a class that is not that widget's
// fails.

import { AdwAboutDialog } from './widgets/adw-about-dialog.js';
import { AdwActionRow } from './widgets/adw-action-row.js';
import { AdwAlertDialog } from './widgets/adw-alert-dialog.js';
import { AdwAvatar } from './widgets/adw-avatar.js';
import { AdwBanner } from './widgets/adw-banner.js';
import { AdwBottomSheet } from './widgets/adw-bottom-sheet.js';
import { AdwButtonContent } from './widgets/adw-button-content.js';
import { AdwButtonRow } from './widgets/adw-button-row.js';
import { AdwCarousel } from './widgets/adw-carousel.js';
import { AdwClamp } from './widgets/adw-clamp.js';
import { AdwComboRow } from './widgets/adw-combo-row.js';
import { AdwEntryRow } from './widgets/adw-entry-row.js';
import { AdwExpanderRow } from './widgets/adw-expander-row.js';
import { AdwHeaderBar } from './widgets/adw-header-bar.js';
import { AdwIcon } from './widgets/adw-icon.js';
import { AdwInlineViewSwitcher } from './widgets/adw-inline-view-switcher.js';
import { AdwNavigationSplitView } from './widgets/adw-navigation-split-view.js';
import { AdwNavigationView } from './widgets/adw-navigation-view.js';
import { AdwOverlaySplitView } from './widgets/adw-overlay-split-view.js';
import { AdwPasswordEntryRow } from './widgets/adw-password-entry-row.js';
import { AdwPreferencesDialog } from './widgets/adw-preferences-dialog.js';
import { AdwPreferencesGroup } from './widgets/adw-preferences-group.js';
import { AdwPreferencesPage } from './widgets/adw-preferences-page.js';
import { AdwShortcutLabel } from './widgets/adw-shortcut-label.js';
import { AdwSidebar } from './widgets/adw-sidebar.js';
import { AdwSpinRow } from './widgets/adw-spin-row.js';
import { AdwSpinner } from './widgets/adw-spinner.js';
import { AdwSplitButton } from './widgets/adw-split-button.js';
import { AdwStatusPage } from './widgets/adw-status-page.js';
import { AdwSwitchRow } from './widgets/adw-switch-row.js';
import { AdwTabView } from './widgets/adw-tab-view.js';
import { AdwToastOverlay } from './widgets/adw-toast-overlay.js';
import { AdwToggleGroup } from './widgets/adw-toggle-group.js';
import { AdwToolbarView } from './widgets/adw-toolbar-view.js';
import { AdwViewStack } from './widgets/adw-view-stack.js';
import { AdwViewSwitcherBar } from './widgets/adw-view-switcher-bar.js';
import { AdwViewSwitcher } from './widgets/adw-view-switcher.js';
import { AdwWindowTitle } from './widgets/adw-window-title.js';
import { AdwWrapBox } from './widgets/adw-wrap-box.js';
import { GtkButton } from './widgets/gtk-button.js';
import { GtkDropDown } from './widgets/gtk-drop-down.js';
import { GtkEntry } from './widgets/gtk-entry.js';
import { GtkMenuButton } from './widgets/gtk-menu-button.js';

/** The libadwaita half: every widget whose own spelling is an `adw-*` tag. */
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
    Clamp: AdwClamp,
    ComboRow: AdwComboRow,
    EntryRow: AdwEntryRow,
    ExpanderRow: AdwExpanderRow,
    HeaderBar: AdwHeaderBar,
    InlineViewSwitcher: AdwInlineViewSwitcher,
    NavigationSplitView: AdwNavigationSplitView,
    NavigationView: AdwNavigationView,
    OverlaySplitView: AdwOverlaySplitView,
    PasswordEntryRow: AdwPasswordEntryRow,
    PreferencesDialog: AdwPreferencesDialog,
    PreferencesGroup: AdwPreferencesGroup,
    PreferencesPage: AdwPreferencesPage,
    ShortcutLabel: AdwShortcutLabel,
    Sidebar: AdwSidebar,
    Spinner: AdwSpinner,
    SpinRow: AdwSpinRow,
    SplitButton: AdwSplitButton,
    StatusPage: AdwStatusPage,
    SwitchRow: AdwSwitchRow,
    TabView: AdwTabView,
    ToastOverlay: AdwToastOverlay,
    ToggleGroup: AdwToggleGroup,
    ToolbarView: AdwToolbarView,
    ViewStack: AdwViewStack,
    ViewSwitcher: AdwViewSwitcher,
    ViewSwitcherBar: AdwViewSwitcherBar,
    WindowTitle: AdwWindowTitle,
    WrapBox: AdwWrapBox,
};

/** The GTK half: the widgets `NS_WIDGET_ALIGNMENT` declares a `gir` alias of a GTK type. */
export const Gtk = {
    Button: GtkButton,
    DropDown: GtkDropDown,
    Entry: GtkEntry,
    Image: AdwIcon,
    MenuButton: GtkMenuButton,
};
