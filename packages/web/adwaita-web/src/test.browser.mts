// Browser test entry for @gjsify/adwaita-web. Importing the package root
// registers every custom element AND self-applies the stylesheet, so the specs
// only have to create + drive the elements. Discovered + run by the
// tests/browser Playwright harness (see AGENTS.md → Browser tests).
import { run } from '@gjsify/unit';

// Registers the custom elements (side-effect) + injects the compiled CSS.
import '@gjsify/adwaita-web';

import { AdwViewStackTest } from './view-stack.spec.js';
import { AdwNavigationViewTest } from './navigation-view.spec.js';
import { AdwSidebarTest } from './adw-sidebar.spec.js';
import { AdwEntryRowsTest } from './entry-rows.spec.js';
import { AdwSplitButtonTest } from './split-button.spec.js';
import { AdwAvatarTest } from './adw-avatar.spec.js';
import { AdwSplitViewsTest } from './split-views.spec.js';
import { AdwButtonRowTest } from './adw-button-row.spec.js';
import { AdwBreakpointsTest } from './breakpoints.spec.js';
import { AdwDataGridTest } from './adw-data-grid.spec.js';
import { AdwDialogTest } from './adw-dialog.spec.js';
import { AdwDropDownTest } from './adw-drop-down.spec.js';
import { AdwRowStateTest } from './adw-row-state.spec.js';
import { AdwTabViewTest } from './adw-tab-view.spec.js';
import { AdwToastOverlayTest } from './adw-toast-overlay.spec.js';
import { AdwViewSwitcherBarTest } from './adw-view-switcher-bar.spec.js';
import { AdwStyleIsolationTest } from './style-isolation.spec.js';

run({
    AdwAvatarTest,
    AdwSplitViewsTest,
    AdwButtonRowTest,
    AdwBreakpointsTest,
    AdwDataGridTest,
    AdwDialogTest,
    AdwDropDownTest,
    AdwRowStateTest,
    AdwTabViewTest,
    AdwToastOverlayTest,
    AdwViewSwitcherBarTest,
    AdwStyleIsolationTest,
    AdwViewStackTest,
    AdwNavigationViewTest,
    AdwSidebarTest,
    AdwEntryRowsTest,
    AdwSplitButtonTest,
});
