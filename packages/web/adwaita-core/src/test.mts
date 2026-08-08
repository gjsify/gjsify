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
import preferencesTestSuite from './preferences.spec.js';
import chromeTestSuite from './chrome.spec.js';
import avatarTestSuite from './avatar.spec.js';
import breakpointTestSuite from './breakpoint.spec.js';
import colorSchemeTestSuite from './color-scheme.spec.js';
import dialogTestSuite from './dialog.spec.js';
import rowsTestSuite from './rows.spec.js';
import toastTestSuite from './toast.spec.js';

run({
    breakpointTestSuite,
    colorSchemeTestSuite,
    toastTestSuite,
    dialogTestSuite,
    rowsTestSuite,
    avatarTestSuite,
    viewStackTestSuite,
    navigationViewTestSuite,
    sidebarTestSuite,
    entryRowTestSuite,
    splitViewTestSuite,
    splitButtonTestSuite,
    viewSwitcherTestSuite,
    tabViewTestSuite,
    carouselTestSuite,
    preferencesTestSuite,
    chromeTestSuite,
});
