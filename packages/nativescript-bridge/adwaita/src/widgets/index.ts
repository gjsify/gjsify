// Widget barrel for @gjsify/adwaita-nativescript.
//
// Re-exports every Adwaita NativeScript widget AND wires them into NativeScript's
// XML element registry via the global `registerElement` so they can be used from
// markup: `<AdwPreferencesGroup>`, `<AdwActionRow>`, `<AdwSwitchRow>`, etc. The
// barrel itself has NO top-level side effects — registration is explicit via
// `registerAdwaitaElements()` (mirroring the `/register` convention spirit), so
// importing a widget class does not eagerly touch the runtime.

export { AdwPreferencesPage } from './adw-preferences-page.js';
export { AdwPreferencesGroup } from './adw-preferences-group.js';
export { AdwActionRow } from './adw-action-row.js';
export { AdwSwitchRow, NOTIFY_ACTIVE } from './adw-switch-row.js';
export type { NotifyActiveEventData } from './adw-switch-row.js';
export { AdwEntryRow, NOTIFY_TEXT } from './adw-entry-row.js';
export type { NotifyTextEventData } from './adw-entry-row.js';
export { AdwPasswordEntryRow } from './adw-password-entry-row.js';
export { AdwComboRow, NOTIFY_SELECTED } from './adw-combo-row.js';
export type { AdwComboOption, NotifySelectedEventData } from './adw-combo-row.js';
export { AdwSpinRow, NOTIFY_VALUE } from './adw-spin-row.js';
export type { NotifyValueEventData } from './adw-spin-row.js';
export { AdwSliderRow, NOTIFY_SLIDER_VALUE } from './adw-slider-row.js';
export type { NotifySliderValueEventData } from './adw-slider-row.js';
export { AdwExpanderRow, NOTIFY_EXPANDED } from './adw-expander-row.js';
export type { NotifyExpandedEventData } from './adw-expander-row.js';
export { AdwButton } from './adw-button.js';
export type { AdwButtonVariant } from './adw-button.js';
export { AdwImageButton, DEFAULT_ICON_BUTTON_ICON_SIZE } from './adw-image-button.js';
export { AdwBanner, BUTTON_CLICKED } from './adw-banner.js';
export { AdwAvatar, DEFAULT_AVATAR_SIZE, avatarInitials } from './adw-avatar.js';
export { AdwWindowTitle } from './adw-window-title.js';
export { AdwClamp, DEFAULT_CLAMP_MAX_SIZE } from './adw-clamp.js';

// --- Presentation / layout ---
export { AdwHeaderBar } from './adw-header-bar.js';
export { AdwToolbarView } from './adw-toolbar-view.js';
export { AdwWrapBox } from './adw-wrap-box.js';
export { AdwSpinner, DEFAULT_SPINNER_SIZE } from './adw-spinner.js';
export { AdwStatusPage } from './adw-status-page.js';
export { AdwButtonRow, ACTIVATED } from './adw-button-row.js';
export { AdwButtonContent } from './adw-button-content.js';
export { AdwSplitButton, CLICKED, MENU_TAPPED } from './adw-split-button.js';
export type { MenuTappedEventData } from './adw-split-button.js';
export { AdwToggleGroup, NOTIFY_SELECTED as NOTIFY_TOGGLE_SELECTED } from './adw-toggle-group.js';
export type { NotifyToggleSelectedEventData } from './adw-toggle-group.js';

// --- View switching ---
export { AdwViewSwitcherBase, NOTIFY_SELECTED as NOTIFY_VIEW_SELECTED } from './view-switcher-base.js';
export type { AdwViewPage, NotifyViewSelectedEventData } from './view-switcher-base.js';
export { AdwViewSwitcher } from './adw-view-switcher.js';
export { AdwInlineViewSwitcher } from './adw-inline-view-switcher.js';
export { AdwTabView } from './adw-tab-view.js';
export { AdwCarousel, DEFAULT_CAROUSEL_PAGE_WIDTH, NOTIFY_POSITION } from './adw-carousel.js';
export type { NotifyPositionEventData } from './adw-carousel.js';

// --- Navigation ---
export { AdwNavigationView, NOTIFY_VISIBLE_PAGE } from './adw-navigation-view.js';
export type { NotifyVisiblePageEventData } from './adw-navigation-view.js';
export { AdwSplitViewBase, DEFAULT_SIDEBAR_WIDTH, NOTIFY_SHOW_SIDEBAR } from './split-view-base.js';
export type { NotifyShowSidebarEventData } from './split-view-base.js';
export { AdwNavigationSplitView } from './adw-navigation-split-view.js';
export { AdwOverlaySplitView } from './adw-overlay-split-view.js';
export { AdwSidebar, NOTIFY_SELECTED as NOTIFY_SIDEBAR_SELECTED } from './adw-sidebar.js';
export type { NotifySidebarSelectedEventData } from './adw-sidebar.js';
export { AdwBottomSheet, NOTIFY_OPEN } from './adw-bottom-sheet.js';
export type { NotifyOpenEventData } from './adw-bottom-sheet.js';

// --- Feedback / dialogs ---
export { AdwToast, AdwToastOverlay, DEFAULT_TOAST_TIMEOUT, TOAST_BUTTON_CLICKED } from './adw-toast-overlay.js';
export type { AdwToastOptions } from './adw-toast-overlay.js';
export { AdwAlertDialog, NOTIFY_RESPONSE } from './adw-alert-dialog.js';
export type { NotifyResponseEventData } from './adw-alert-dialog.js';
export { AdwAboutDialog, CLOSED as ABOUT_CLOSED } from './adw-about-dialog.js';
export { AdwPreferencesDialog, CLOSED as PREFERENCES_CLOSED } from './adw-preferences-dialog.js';

// --- Interaction helpers ---
// Wire Adwaita press-darken onto a custom activatable row (the built-in
// activatable rows already call this internally).
export { attachRowPressFeedback } from './row-press.js';

// --- Icon rendering ---
// Rasterise an Adwaita symbolic SVG (e.g. from `@gjsify/adwaita-icons`) to a native
// image — NativeScript has no SVG decoder. `AdwImageButton` uses this internally.
export {
    ADWAITA_ICON_GRID,
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    extractIconPaths,
    extractPathData,
    renderSymbolicIcon,
} from './icons.js';
export type { IconPath, SymbolicIconOptions } from './icons.js';

import { AdwPreferencesPage } from './adw-preferences-page.js';
import { AdwPreferencesGroup } from './adw-preferences-group.js';
import { AdwActionRow } from './adw-action-row.js';
import { AdwSwitchRow } from './adw-switch-row.js';
import { AdwEntryRow } from './adw-entry-row.js';
import { AdwPasswordEntryRow } from './adw-password-entry-row.js';
import { AdwComboRow } from './adw-combo-row.js';
import { AdwSpinRow } from './adw-spin-row.js';
import { AdwSliderRow } from './adw-slider-row.js';
import { AdwExpanderRow } from './adw-expander-row.js';
import { AdwButton } from './adw-button.js';
import { AdwImageButton } from './adw-image-button.js';
import { AdwBanner } from './adw-banner.js';
import { AdwAvatar } from './adw-avatar.js';
import { AdwWindowTitle } from './adw-window-title.js';
import { AdwClamp } from './adw-clamp.js';
import { AdwHeaderBar } from './adw-header-bar.js';
import { AdwToolbarView } from './adw-toolbar-view.js';
import { AdwWrapBox } from './adw-wrap-box.js';
import { AdwSpinner } from './adw-spinner.js';
import { AdwStatusPage } from './adw-status-page.js';
import { AdwButtonRow } from './adw-button-row.js';
import { AdwButtonContent } from './adw-button-content.js';
import { AdwSplitButton } from './adw-split-button.js';
import { AdwToggleGroup } from './adw-toggle-group.js';
import { AdwViewSwitcher } from './adw-view-switcher.js';
import { AdwInlineViewSwitcher } from './adw-inline-view-switcher.js';
import { AdwTabView } from './adw-tab-view.js';
import { AdwCarousel } from './adw-carousel.js';
import { AdwNavigationView } from './adw-navigation-view.js';
import { AdwNavigationSplitView } from './adw-navigation-split-view.js';
import { AdwOverlaySplitView } from './adw-overlay-split-view.js';
import { AdwSidebar } from './adw-sidebar.js';
import { AdwBottomSheet } from './adw-bottom-sheet.js';
import { AdwToastOverlay } from './adw-toast-overlay.js';
import { AdwAboutDialog } from './adw-about-dialog.js';
import { AdwPreferencesDialog } from './adw-preferences-dialog.js';

/** XML element name → constructor map registered with NativeScript. */
const ELEMENTS = {
    AdwPreferencesPage,
    AdwPreferencesGroup,
    AdwActionRow,
    AdwSwitchRow,
    AdwEntryRow,
    AdwPasswordEntryRow,
    AdwComboRow,
    AdwSpinRow,
    AdwSliderRow,
    AdwExpanderRow,
    AdwButton,
    AdwImageButton,
    AdwBanner,
    AdwAvatar,
    AdwWindowTitle,
    AdwClamp,
    // Presentation / layout
    AdwHeaderBar,
    AdwToolbarView,
    AdwWrapBox,
    AdwSpinner,
    AdwStatusPage,
    AdwButtonRow,
    AdwButtonContent,
    AdwSplitButton,
    AdwToggleGroup,
    // View switching
    AdwViewSwitcher,
    AdwInlineViewSwitcher,
    AdwTabView,
    AdwCarousel,
    // Navigation
    AdwNavigationView,
    AdwNavigationSplitView,
    AdwOverlaySplitView,
    AdwSidebar,
    AdwBottomSheet,
    // Feedback (View-based overlays only; AdwAlertDialog/AdwToast are not Views)
    AdwToastOverlay,
    AdwAboutDialog,
    AdwPreferencesDialog,
} as const;

let registered = false;

/**
 * Register all Adwaita widgets as NativeScript XML elements (idempotent).
 *
 * After calling this once at app bootstrap, markup like
 * `<AdwSwitchRow title="Dark mode" />` resolves to the corresponding class.
 * No-op (returns silently) when the `registerElement` runtime global is absent
 * — i.e. off NativeScript, or when the bundler context has not injected it yet —
 * so the call is safe to make unconditionally.
 */
export function registerAdwaitaElements(): void {
    if (registered) return;
    if (typeof registerElement !== 'function') return;
    for (const [name, ctor] of Object.entries(ELEMENTS)) {
        registerElement(name, () => ctor);
    }
    registered = true;
}
