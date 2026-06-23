// @gjsify/adwaita-web — Adwaita/Libadwaita web components for browser targets.
// Importing this module registers all custom elements. The accompanying
// stylesheet must be imported separately as `@gjsify/adwaita-web/style.css`
// (or via SCSS partials at `@gjsify/adwaita-web/scss/...`).
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
export { AdwCard } from './elements/adw-card.js';
export { AdwWindow } from './elements/adw-window.js';
export { AdwHeaderBar } from './elements/adw-header-bar.js';
export { AdwButton } from './elements/adw-button.js';
export { AdwEntry } from './elements/adw-entry.js';
export { AdwPreferencesGroup } from './elements/adw-preferences-group.js';
export { AdwSwitchRow } from './elements/adw-switch-row.js';
export { AdwComboRow } from './elements/adw-combo-row.js';
export { AdwSpinRow } from './elements/adw-spin-row.js';
export { AdwToastOverlay } from './elements/adw-toast-overlay.js';
export { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';
