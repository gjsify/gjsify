// @gjsify/adwaita-web — Adwaita/Libadwaita web components for browser targets.
// Importing this module registers all custom elements and injects the Adwaita CSS.
// Reference: refs/libadwaita (colors/sizing), refs/adwaita-web (component patterns).

import '@gjsify/adwaita-fonts';  // Registers @font-face (fontsource pattern)
import { adwaitaCSS } from './adwaita-css.js';

// Register custom elements (side-effect imports)
export { AdwWindow } from './elements/adw-window.js';
export { AdwHeaderBar } from './elements/adw-header-bar.js';
export { AdwPreferencesGroup } from './elements/adw-preferences-group.js';
export { AdwSwitchRow } from './elements/adw-switch-row.js';
export { AdwComboRow } from './elements/adw-combo-row.js';
export { AdwSpinRow } from './elements/adw-spin-row.js';

// Inject Adwaita CSS into the document
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = adwaitaCSS;
    document.head.appendChild(style);
}
