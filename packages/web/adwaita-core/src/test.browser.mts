// Browser test entry. The core specs are pure TS — only relative imports of the package's
// own modules, no platform imports and no DOM/Node globals — so the SAME spec files run
// unchanged here. `dist/test.browser.mjs` is auto-discovered by the `tests/browser/`
// Playwright suite (`scripts/discover-bundles.mjs` scans `packages/web/*`).

import { run } from '@gjsify/unit';

import viewStackTestSuite from './view-stack.spec.js';
import navigationViewTestSuite from './navigation-view.spec.js';
import sidebarTestSuite from './sidebar.spec.js';
import entryRowTestSuite from './entry-row.spec.js';
import splitViewTestSuite from './split-view.spec.js';
import splitButtonTestSuite from './split-button.spec.js';
import viewSwitcherTestSuite from './view-switcher.spec.js';
import tabViewTestSuite from './tab-view.spec.js';
import carouselTestSuite from './carousel.spec.js';
import swipeTestSuite from './swipe.spec.js';
import preferencesTestSuite from './preferences.spec.js';
import chromeTestSuite from './chrome.spec.js';
import dataGridTestSuite from './data-grid.spec.js';
import avatarTestSuite from './avatar.spec.js';
import actionRowTestSuite from './action-row.spec.js';
import breakpointTestSuite from './breakpoint.spec.js';
import colorSchemeTestSuite from './color-scheme.spec.js';
import dialogTestSuite from './dialog.spec.js';
import rowsTestSuite from './rows.spec.js';
import toastTestSuite from './toast.spec.js';
import popoverTestSuite from './popover.spec.js';
import bannerTestSuite from './banner.spec.js';
import buttonContentTestSuite from './button-content.spec.js';
import aboutDialogTestSuite from './about-dialog.spec.js';
import checksTestSuite from './checks.spec.js';
import wrapBoxTestSuite from './wrap-box.spec.js';
import spinnerTestSuite from './spinner.spec.js';
import shortcutLabelTestSuite from './shortcut-label.spec.js';

run({
    aboutDialogTestSuite,
    bannerTestSuite,
    buttonContentTestSuite,
    checksTestSuite,
    breakpointTestSuite,
    colorSchemeTestSuite,
    toastTestSuite,
    dialogTestSuite,
    rowsTestSuite,
    popoverTestSuite,
    avatarTestSuite,
    actionRowTestSuite,
    viewStackTestSuite,
    navigationViewTestSuite,
    sidebarTestSuite,
    entryRowTestSuite,
    splitViewTestSuite,
    splitButtonTestSuite,
    viewSwitcherTestSuite,
    tabViewTestSuite,
    carouselTestSuite,
    swipeTestSuite,
    preferencesTestSuite,
    chromeTestSuite,
    dataGridTestSuite,
    wrapBoxTestSuite,
    spinnerTestSuite,
    shortcutLabelTestSuite,
});
