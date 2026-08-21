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
import { AdwCarouselTest } from './adw-carousel.spec.js';
import { AdwBottomSheetTest } from './bottom-sheet.spec.js';
import { AdwChromeTest } from './chrome.spec.js';
import { AdwPreferencesTest } from './preferences.spec.js';
import { AdwTabViewConformanceTest } from './tab-view.spec.js';
import { AdwViewSwitcherTest } from './view-switcher.spec.js';
import { AdwAvatarTest } from './adw-avatar.spec.js';
import { AdwSplitViewsTest } from './split-views.spec.js';
import { AdwButtonRowTest } from './adw-button-row.spec.js';
import { AdwActionRowsTest } from './adw-action-rows.spec.js';
import { AdwBreakpointsTest } from './breakpoints.spec.js';
import { AdwDataGridTest } from './adw-data-grid.spec.js';
import { AdwDialogTest } from './adw-dialog.spec.js';
import { AdwDropDownTest } from './adw-drop-down.spec.js';
import { AdwRowStateTest } from './adw-row-state.spec.js';
import { AdwTabViewTest } from './adw-tab-view.spec.js';
import { AdwToastOverlayTest } from './adw-toast-overlay.spec.js';
import { AdwViewSwitcherBarTest } from './adw-view-switcher-bar.spec.js';
import { AdwStyleIsolationTest } from './style-isolation.spec.js';
import { AdwWrapBoxTest } from './adw-wrap-box.spec.js';
import { AdwHeaderBarTest } from './adw-header-bar.spec.js';
import { AdwEntryTest } from './adw-entry.spec.js';
import { AdwMenuButtonTest } from './adw-menu-button.spec.js';
import { AdwButtonTest } from './adw-button.spec.js';
import { AdwBannerTest } from './adw-banner.spec.js';
import { AdwButtonContentTest } from './adw-button-content.spec.js';
import { AdwIconTest } from './adw-icon.spec.js';
import { AdwSwitchTest } from './adw-switch.spec.js';
import { AdwChecksTest } from './adw-checks.spec.js';
import { AdwProgressBarTest } from './adw-progress-bar.spec.js';
import { AdwAboutDialogTest } from './adw-about-dialog.spec.js';
import { AdwStyleClassesTest } from './style-classes.spec.js';
import { AdwAccentTest } from './adw-accent.spec.js';
import { AdwShortcutLabelTest } from './adw-shortcut-label.spec.js';
import { AdwConnectLifecycleTest } from './connect-lifecycle.spec.js';
import { AdwEmptySectionsTest } from './empty-sections.spec.js';
import { AdwFontsTest } from './adw-fonts.spec.js';

run({
    AdwConnectLifecycleTest,
    AdwEmptySectionsTest,
    AdwStyleClassesTest,
    AdwAccentTest,
    AdwShortcutLabelTest,
    AdwAboutDialogTest,
    AdwBannerTest,
    AdwButtonContentTest,
    AdwIconTest,
    AdwSwitchTest,
    AdwChecksTest,
    AdwProgressBarTest,
    AdwAvatarTest,
    AdwCarouselTest,
    AdwBottomSheetTest,
    AdwChromeTest,
    AdwPreferencesTest,
    AdwTabViewConformanceTest,
    AdwViewSwitcherTest,

    AdwSplitViewsTest,
    AdwButtonRowTest,
    AdwActionRowsTest,
    AdwBreakpointsTest,
    AdwDataGridTest,
    AdwDialogTest,
    AdwDropDownTest,
    AdwRowStateTest,
    AdwTabViewTest,
    AdwToastOverlayTest,
    AdwViewSwitcherBarTest,
    AdwStyleIsolationTest,
    AdwWrapBoxTest,
    AdwHeaderBarTest,
    AdwEntryTest,
    AdwMenuButtonTest,
    AdwButtonTest,
    AdwViewStackTest,
    AdwNavigationViewTest,
    AdwSidebarTest,
    AdwEntryRowsTest,
    AdwSplitButtonTest,
    // LAST on purpose: it registers real webfaces in `document.fonts`, which
    // changes text metrics for the whole document. Nothing that measures text may
    // run while they swap in — see `adw-fonts.spec.ts` § "leaves the document as
    // it found it".
    AdwFontsTest,
});
