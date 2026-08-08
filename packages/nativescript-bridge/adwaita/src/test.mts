import { run } from '@gjsify/unit';

import adwaitaNativescriptTestSuite from './index.spec.js';
import svgPathTestSuite from './svg-path.spec.js';
import { AdwBottomSheetNsTest } from './bottom-sheet.spec.js';
import { AdwCarouselNsTest } from './carousel.spec.js';
import chromeTestSuite from './chrome.spec.js';
import preferencesTestSuite from './preferences.spec.js';
import tabViewTestSuite from './tab-view.spec.js';
import { AdwViewSwitcherNsTest } from './view-switcher.spec.js';
import splitViewWidthTestSuite from './split-view-width.spec.js';
import viewStackNsTestSuite from './view-stack.spec.js';
import navigationViewNsTestSuite from './navigation-view.spec.js';
import { AdwSidebarNsTest } from './sidebar.spec.js';
import { AdwEntryRowsNsTest } from './entry-rows.spec.js';
import { AdwSplitButtonNsTest } from './split-button.spec.js';

run({
    adwaitaNativescriptTestSuite,
    svgPathTestSuite,
    splitViewWidthTestSuite,
    viewStackNsTestSuite,
    navigationViewNsTestSuite,
    AdwSidebarNsTest,
    AdwEntryRowsNsTest,
    AdwSplitButtonNsTest,
    AdwBottomSheetNsTest,
    AdwCarouselNsTest,
    chromeTestSuite,
    preferencesTestSuite,
    tabViewTestSuite,
    AdwViewSwitcherNsTest,
});
