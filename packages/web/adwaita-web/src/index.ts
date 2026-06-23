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

// Register custom elements (side-effect imports)
export { AdwAvatar } from './elements/adw-avatar.js';
export { AdwBanner } from './elements/adw-banner.js';
export { AdwCard } from './elements/adw-card.js';
export { AdwClamp } from './elements/adw-clamp.js';
export { AdwSpinner } from './elements/adw-spinner.js';
export { AdwStatusPage } from './elements/adw-status-page.js';
export { AdwWindow } from './elements/adw-window.js';
export { AdwHeaderBar } from './elements/adw-header-bar.js';
export { AdwWindowTitle } from './elements/adw-window-title.js';
export { AdwButton } from './elements/adw-button.js';
export { AdwButtonContent } from './elements/adw-button-content.js';
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
export { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';
export { AdwNavigationSplitView } from './elements/adw-navigation-split-view.js';
