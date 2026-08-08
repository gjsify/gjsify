// @gjsify/adwaita-web — Adwaita/Libadwaita web components for browser targets.
// Importing this module registers all custom elements AND self-applies the
// compiled stylesheet — no separate CSS import is needed. The compiled CSS is
// still exported at `@gjsify/adwaita-web/style.css` (e.g. for a <link>) and the
// SCSS partials at `@gjsify/adwaita-web/scss/...` for custom theming.
// Reference: refs/libadwaita (colors/sizing), refs/adwaita-web (component patterns).

import '@gjsify/adwaita-fonts'; // Registers @font-face (fontsource pattern)
import { ADWAITA_WEB_CSS } from './styles.generated.js';

// Self-apply the compiled stylesheet on import. This makes `import
// '@gjsify/adwaita-web'` enough to style the components under ANY bundler —
// a separate `import '@gjsify/adwaita-web/style.css'` is a no-op under a gjsify
// `--app browser` build (css-as-string yields a string a side-effect import
// discards), which used to leave consumers unstyled. Idempotent + browser-only.
if (typeof document !== 'undefined' && !document.getElementById('adwaita-web-style')) {
    const style = document.createElement('style');
    style.id = 'adwaita-web-style';
    style.textContent = ADWAITA_WEB_CSS;
    document.head.appendChild(style);
}

// Responsive breakpoints: the browser size source for `@gjsify/adwaita-core`'s
// `AdwBreakpoint`, and the `breakpoint="…"` attribute wiring the split views use.
export { addBreakpoints, bindBreakpointSetter } from './breakpoints.js';

// Register custom elements (side-effect imports)
export { AdwAvatar } from './elements/adw-avatar.js';
export { AdwBanner } from './elements/adw-banner.js';
export { AdwCard } from './elements/adw-card.js';
export { AdwDataGrid } from './elements/adw-data-grid.js';
export type {
    AdwDataGridAlign,
    AdwDataGridColumn,
    AdwDataGridRow,
    AdwDataGridRowVariant,
} from './elements/adw-data-grid.js';
export { AdwClamp } from './elements/adw-clamp.js';
export { AdwSpinner } from './elements/adw-spinner.js';
export { AdwStatusPage } from './elements/adw-status-page.js';
export { AdwWindow } from './elements/adw-window.js';
export { AdwHeaderBar } from './elements/adw-header-bar.js';
export { AdwWindowTitle } from './elements/adw-window-title.js';
export { AdwButton } from './elements/adw-button.js';
export { AdwButtonContent } from './elements/adw-button-content.js';
// The ONE symbolic-icon node and the ONE toggle. Exported before the widgets
// that build them so the barrel's definition order matches theirs; each host
// ALSO imports them directly, which is what actually guarantees the tags are
// defined before a server-rendered host upgrades.
export { AdwIcon, createAdwIcon } from './elements/adw-icon.js';
export { AdwSwitch } from './elements/adw-switch.js';
// The ONE popover surface. Exported before its three hosts so the barrel's own
// definition order matches theirs; each host ALSO imports it directly, which is
// what actually guarantees `adw-popover` is defined before a server-rendered
// host upgrades and builds one.
export { AdwPopover } from './elements/adw-popover.js';
export type { AdwPopoverAlign, AdwPopoverPosition, AdwPopoverRole } from './elements/adw-popover.js';
export { AdwSplitButton } from './elements/adw-split-button.js';
export { AdwToggle, AdwToggleGroup } from './elements/adw-toggle-group.js';
export { AdwEntry } from './elements/adw-entry.js';
export { AdwPreferencesGroup } from './elements/adw-preferences-group.js';
export { AdwActionRow } from './elements/adw-action-row.js';
export { AdwEntryRow } from './elements/adw-entry-row.js';
export { AdwSwitchRow } from './elements/adw-switch-row.js';
export { AdwComboRow } from './elements/adw-combo-row.js';
export { AdwSpinRow } from './elements/adw-spin-row.js';
export { AdwButtonRow } from './elements/adw-button-row.js';
export { AdwExpanderRow } from './elements/adw-expander-row.js';
export { AdwPasswordEntryRow } from './elements/adw-password-entry-row.js';
export { AdwToastOverlay } from './elements/adw-toast-overlay.js';
export { AdwToolbarView } from './elements/adw-toolbar-view.js';
export { AdwWrapBox } from './elements/adw-wrap-box.js';
export { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';
export { AdwNavigationSplitView } from './elements/adw-navigation-split-view.js';
export { AdwCarousel, AdwCarouselIndicatorDots, AdwCarouselIndicatorLines } from './elements/adw-carousel.js';
export { AdwTabPage, AdwTabView } from './elements/adw-tab-view.js';
export { AdwViewSwitcher, AdwViewSwitcherPage } from './elements/adw-view-switcher.js';
export { AdwInlineViewSwitcher, AdwViewStackPage } from './elements/adw-inline-view-switcher.js';
export { AdwViewStack } from './elements/adw-view-stack.js';
export type { AdwViewStackPageInfo } from './elements/adw-view-stack.js';
export { AdwViewSwitcherBar } from './elements/adw-view-switcher-bar.js';
export { AdwMenuButton } from './elements/adw-menu-button.js';
export type { AdwMenuItem } from './elements/adw-menu-button.js';
export { AdwDropDown } from './elements/adw-drop-down.js';
export type { AdwDropDownOption } from './elements/adw-drop-down.js';
export { AdwNavigationPage, AdwNavigationView } from './elements/adw-navigation-view.js';
export { AdwBottomSheet, AdwBottomSheetContent, AdwBottomSheetSheet } from './elements/adw-bottom-sheet.js';
export { AdwSidebar, AdwSidebarItem, AdwSidebarSection } from './elements/adw-sidebar.js';
export { AdwAboutDialog } from './elements/adw-about-dialog.js';
export { AdwAlertDialog, AdwAlertResponse } from './elements/adw-alert-dialog.js';
export { AdwPreferencesDialog, AdwPreferencesPage } from './elements/adw-preferences-dialog.js';
export { AdwDialog } from './elements/adw-dialog.js';
export type { AdwDialogPresentationMode } from './elements/adw-dialog.js';
