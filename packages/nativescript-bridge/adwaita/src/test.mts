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
import splitViewStateTestSuite from './split-view-state.spec.js';
import rowStateTestSuite from './row-state.spec.js';
import viewStackNsTestSuite from './view-stack.spec.js';
import navigationViewNsTestSuite from './navigation-view.spec.js';
import { AdwSidebarNsTest } from './sidebar.spec.js';
import { AdwEntryRowsNsTest } from './entry-rows.spec.js';
import { AdwSplitButtonNsTest } from './split-button.spec.js';
import wrapBoxNsTestSuite from './wrap-box.spec.js';
import statusPageNsTestSuite from './status-page.spec.js';
import bannerNsTestSuite from './banner.spec.js';
import buttonContentNsTestSuite from './button-content.spec.js';

run({
    bannerNsTestSuite,
    buttonContentNsTestSuite,
    adwaitaNativescriptTestSuite,
    svgPathTestSuite,
    splitViewWidthTestSuite,
    splitViewStateTestSuite,
    rowStateTestSuite,
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
    wrapBoxNsTestSuite,
    statusPageNsTestSuite,
});
