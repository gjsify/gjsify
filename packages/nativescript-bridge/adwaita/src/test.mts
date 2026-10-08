import { run } from '@gjsify/unit';

import adwaitaNativescriptTestSuite from './index.spec.js';
import svgPathTestSuite from './svg-path.spec.js';
import actionsTestSuite from './actions.spec.js';
import iconThemeTestSuite from './icon-theme.spec.js';
import { AdwBottomSheetNsTest } from './bottom-sheet.spec.js';
import bottomSheetDragTestSuite from './bottom-sheet-drag.spec.js';
import bottomSheetInsetsTestSuite from './bottom-sheet-insets.spec.js';
import headerBarBalanceTestSuite from './header-bar-balance.spec.js';
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
import { AdwEntryNsTest } from './entry.spec.js';
import { AdwDropDownNsTest } from './drop-down.spec.js';
import { AdwDataGridNsTest } from './data-grid.spec.js';
import { AdwSplitButtonNsTest } from './split-button.spec.js';
import wrapBoxNsTestSuite from './wrap-box.spec.js';
import statusPageNsTestSuite from './status-page.spec.js';
import bannerNsTestSuite from './banner.spec.js';
import buttonContentNsTestSuite from './button-content.spec.js';
import shortcutLabelNsTestSuite from './shortcut-label.spec.js';
import accentThemeNsTestSuite from './accent-theme.spec.js';
import windowInsetsTestSuite from './window-insets.spec.js';
import systemBarsTestSuite from './system-bars.spec.js';
import styleClassesTestSuite from './style-classes.spec.js';
import boxLayoutTestSuite from './box-layout.spec.js';
import buttonSlotTestSuite from './button-slot.spec.js';
import avatarNsTestSuite from './avatar.spec.js';
import constructPropsTestSuite from './construct-props.spec.js';
import signalsTestSuite from './signals.spec.js';
import iconSizeTestSuite from './icon-size.spec.js';
import gioMenuTestSuite from './gio-menu.spec.js';
import glibTestSuite from './glib.spec.js';
import transitionTypeTestSuite from './transition-type.spec.js';
import scrolledWindowPolicyTestSuite from './scrolled-window-policy.spec.js';
import revealerStateTestSuite from './revealer-state.spec.js';
import windowStateTestSuite from './window-state.spec.js';
import gridStateTestSuite from './grid-state.spec.js';
import listBoxStateTestSuite from './list-box-state.spec.js';
import nsLengthTestSuite from './ns-length.spec.js';

run({
    bottomSheetDragTestSuite,
    bottomSheetInsetsTestSuite,
    headerBarBalanceTestSuite,
    constructPropsTestSuite,
    signalsTestSuite,
    iconSizeTestSuite,
    gioMenuTestSuite,
    glibTestSuite,
    transitionTypeTestSuite,
    scrolledWindowPolicyTestSuite,
    revealerStateTestSuite,
    windowStateTestSuite,
    gridStateTestSuite,
    listBoxStateTestSuite,
    nsLengthTestSuite,
    bannerNsTestSuite,
    buttonContentNsTestSuite,
    shortcutLabelNsTestSuite,
    accentThemeNsTestSuite,
    windowInsetsTestSuite,
    systemBarsTestSuite,
    styleClassesTestSuite,
    boxLayoutTestSuite,
    buttonSlotTestSuite,
    adwaitaNativescriptTestSuite,
    svgPathTestSuite,
    iconThemeTestSuite,
    actionsTestSuite,
    splitViewWidthTestSuite,
    splitViewStateTestSuite,
    rowStateTestSuite,
    viewStackNsTestSuite,
    navigationViewNsTestSuite,
    AdwSidebarNsTest,
    AdwEntryRowsNsTest,
    AdwEntryNsTest,
    AdwDropDownNsTest,
    AdwDataGridNsTest,
    AdwSplitButtonNsTest,
    AdwBottomSheetNsTest,
    AdwCarouselNsTest,
    chromeTestSuite,
    preferencesTestSuite,
    tabViewTestSuite,
    AdwViewSwitcherNsTest,
    wrapBoxNsTestSuite,
    statusPageNsTestSuite,
    avatarNsTestSuite,
});
