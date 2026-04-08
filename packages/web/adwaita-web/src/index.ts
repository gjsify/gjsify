// @gjsify/adwaita-web — Adwaita/Libadwaita web components for browser targets.
// Importing this module registers all custom elements. The accompanying
// stylesheet must be imported separately as `@gjsify/adwaita-web/style.css`
// (or via SCSS partials at `@gjsify/adwaita-web/scss/...`).
// Reference: refs/libadwaita (colors/sizing), refs/adwaita-web (component patterns).

import '@gjsify/adwaita-fonts';  // Registers @font-face (fontsource pattern)

// Register custom elements (side-effect imports)
export { AdwCard } from './elements/adw-card.js';
export { AdwWindow } from './elements/adw-window.js';
export { AdwHeaderBar } from './elements/adw-header-bar.js';
export { AdwPreferencesGroup } from './elements/adw-preferences-group.js';
export { AdwSwitchRow } from './elements/adw-switch-row.js';
export { AdwComboRow } from './elements/adw-combo-row.js';
export { AdwSpinRow } from './elements/adw-spin-row.js';
export { AdwToastOverlay } from './elements/adw-toast-overlay.js';
export { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';
