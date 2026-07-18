// Browser test entry for @gjsify/adwaita-web. Importing the package root
// registers every custom element AND self-applies the stylesheet, so the specs
// only have to create + drive the elements. Discovered + run by the
// tests/browser Playwright harness (see AGENTS.md → Browser tests).
import { run } from '@gjsify/unit';

// Registers the custom elements (side-effect) + injects the compiled CSS.
import '@gjsify/adwaita-web';

import { AdwDataGridTest } from './adw-data-grid.spec.js';
import { AdwDialogTest } from './adw-dialog.spec.js';
import { AdwDropDownTest } from './adw-drop-down.spec.js';
import { AdwTabViewTest } from './adw-tab-view.spec.js';

run({ AdwDataGridTest, AdwDialogTest, AdwDropDownTest, AdwTabViewTest });
