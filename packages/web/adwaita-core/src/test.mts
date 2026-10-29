import { run } from '@gjsify/unit';

import sharedTreesTestSuite from './shared-trees.spec.js';
import constructsTestSuite from './constructs.spec.js';
import viewStackTestSuite from './view-stack.spec.js';
import navigationViewTestSuite from './navigation-view.spec.js';
import sidebarTestSuite from './sidebar.spec.js';
import defaultTranslateTestSuite from './default-translate.spec.js';
import entryRowTestSuite from './entry-row.spec.js';
import splitViewTestSuite from './split-view.spec.js';
import splitButtonTestSuite from './split-button.spec.js';
import menuTestSuite from './menu.spec.js';
import popupMenuPlanTestSuite from './popup-menu-plan.spec.js';
import menuActionsTestSuite from './menu-actions.spec.js';
import menuActionsOracleTestSuite from './menu-actions.gjs.spec.js';
import menuTreeTestSuite from './menu-tree.spec.js';
import viewSwitcherTestSuite from './view-switcher.spec.js';
import gridNavigationTestSuite from './grid-navigation.spec.js';
import tabViewTestSuite from './tab-view.spec.js';
import carouselTestSuite from './carousel.spec.js';
import preferencesTestSuite from './preferences.spec.js';
import pangoMarkupTestSuite from './pango-markup.spec.js';
import chromeTestSuite from './chrome.spec.js';
import headerBarTestSuite from './header-bar.spec.js';
import dataGridTestSuite from './data-grid.spec.js';
import avatarTestSuite from './avatar.spec.js';
import actionRowTestSuite from './action-row.spec.js';
import breakpointTestSuite from './breakpoint.spec.js';
import breakpointBinTestSuite from './breakpoint-bin.spec.js';
import breakpointDriverTestSuite from './breakpoint-driver.spec.js';
import accentTestSuite from './accent.spec.js';
import appleAccentTestSuite from './apple-accent.spec.js';
import colorSchemeTestSuite from './color-scheme.spec.js';
import appearanceTestSuite from './appearance.spec.js';
import dialogTestSuite from './dialog.spec.js';
import listTestSuite from './list.spec.js';
import listViewTestSuite from './list-view.spec.js';
import treeExpanderTestSuite from './tree-expander.spec.js';
import boxSelectionTestSuite from './box-selection.spec.js';
import calendarTestSuite from './calendar.spec.js';
import adjustmentTestSuite from './adjustment.spec.js';
import gtkAdjustmentTestSuite from './gtk-adjustment.spec.js';
import gtkStringListTestSuite from './gtk-string-list.spec.js';
import optionListTestSuite from './option-list.spec.js';
import rowsTestSuite from './rows.spec.js';
import toastTestSuite from './toast.spec.js';
import toastObjectTestSuite from './toast-object.spec.js';
import popoverTestSuite from './popover.spec.js';
import bannerTestSuite from './banner.spec.js';
import buttonContentTestSuite from './button-content.spec.js';
import buttonTestSuite from './button.spec.js';
import aboutDialogTestSuite from './about-dialog.spec.js';
import checksTestSuite from './checks.spec.js';
import checkGroupTestSuite from './check-group.spec.js';
import checkGroupOracleTestSuite from './check-group.gjs.spec.js';
import wrapBoxTestSuite from './wrap-box.spec.js';
import boxTestSuite from './box.spec.js';
import labelTestSuite from './label.spec.js';
import spinnerTestSuite from './spinner.spec.js';
import shortcutLabelTestSuite from './shortcut-label.spec.js';
import shortcutFormatTestSuite from './shortcut-format.spec.js';
import scrollingTestSuite from './scrolling.spec.js';
import swipeTestSuite from './swipe.spec.js';
import markupTestSuite from './markup.spec.js';
import tagsTestSuite from './tags.spec.js';
import sourceTestSuite from './source.spec.js';
import gobjectTestSuite from './gobject.spec.js';
import engineSlotTestSuite from './engine-slot.spec.js';
import gobjectOracleTestSuite from './gobject.gjs.spec.js';
import applicationTestSuite from './application.spec.js';
import applicationOracleTestSuite from './application.gjs.spec.js';
import windowMembersTestSuite from './window-members.spec.js';
import windowOracleTestSuite from './window.gjs.spec.js';
import widgetMapOracleTestSuite from './widget-map.gjs.spec.js';
import acceleratorsTestSuite from './accelerators.spec.js';
import glibTimersTestSuite from './glib-timers.spec.js';
import glibTimersOracleTestSuite from './glib-timers.gjs.spec.js';
import gdkTestSuite from './gdk.spec.js';
import gdkOracleTestSuite from './gdk.gjs.spec.js';
import grapheneTestSuite from './graphene.spec.js';
import gtkPlatformTestSuite from './gtk-platform.spec.js';
import gtkCssOracleTestSuite from './gtk-css.gjs.spec.js';
import glibPathsTestSuite from './glib-paths.spec.js';
import glibPathsOracleTestSuite from './glib-paths.gjs.spec.js';
import glibUriTestSuite from './glib-uri.spec.js';
import glibUriOracleTestSuite from './glib-uri.gjs.spec.js';
import glibLanguageTestSuite from './glib-language.spec.js';
import glibLanguageOracleTestSuite from './glib-language.gjs.spec.js';
import glibVariantTestSuite from './glib-variant.spec.js';
import glibVariantOracleTestSuite from './glib-variant.gjs.spec.js';
import rgbaTestSuite from './rgba.spec.js';
import rgbaOracleTestSuite from './rgba.gjs.spec.js';
import glibUnicharTestSuite from './glib-unichar.spec.js';
import glibUnicharOracleTestSuite from './glib-unichar.gjs.spec.js';
import gioAppInfoTestSuite from './gio-app-info.spec.js';
import gioAppInfoOracleTestSuite from './gio-app-info.gjs.spec.js';
import carouselDoorsOracleTestSuite from './carousel-doors.gjs.spec.js';
import releaseNotesTestSuite from './release-notes.spec.js';
import aboutDialogDoorsOracleTestSuite from './about-dialog-doors.gjs.spec.js';
import styleManagerTestSuite from './style-manager.spec.js';
import styleManagerOracleTestSuite from './style-manager.gjs.spec.js';
import rowAccessorsOracleTestSuite from './row-accessors.gjs.spec.js';
import simpleActionGroupTestSuite from './simple-action-group.spec.js';
import simpleActionGroupOracleTestSuite from './simple-action-group.gjs.spec.js';
import fileChooserTestSuite from './file-chooser.spec.js';
import fileChooserOracleTestSuite from './file-chooser.gjs.spec.js';
import gioResourceTestSuite from './gio-resource.spec.js';
import gioResourceOracleTestSuite from './gio-resource.gjs.spec.js';
import iconThemeResourcesTestSuite from './icon-theme-resources.spec.js';
import iconThemeResourcesOracleTestSuite from './icon-theme-resources.gjs.spec.js';

run({
    sharedTreesTestSuite,
    constructsTestSuite,
    aboutDialogTestSuite,
    adjustmentTestSuite,
    gtkAdjustmentTestSuite,
    gtkStringListTestSuite,
    optionListTestSuite,
    bannerTestSuite,
    buttonContentTestSuite,
    buttonTestSuite,
    checksTestSuite,
    checkGroupTestSuite,
    checkGroupOracleTestSuite,
    breakpointTestSuite,
    breakpointBinTestSuite,
    breakpointDriverTestSuite,
    accentTestSuite,
    appleAccentTestSuite,
    colorSchemeTestSuite,
    appearanceTestSuite,
    toastTestSuite,
    toastObjectTestSuite,
    dialogTestSuite,
    listTestSuite,
    listViewTestSuite,
    treeExpanderTestSuite,
    boxSelectionTestSuite,
    calendarTestSuite,
    rowsTestSuite,
    popoverTestSuite,
    avatarTestSuite,
    actionRowTestSuite,
    viewStackTestSuite,
    navigationViewTestSuite,
    sidebarTestSuite,
    defaultTranslateTestSuite,
    entryRowTestSuite,
    splitViewTestSuite,
    splitButtonTestSuite,
    menuTestSuite,
    popupMenuPlanTestSuite,
    menuActionsTestSuite,
    menuActionsOracleTestSuite,
    menuTreeTestSuite,
    viewSwitcherTestSuite,
    gridNavigationTestSuite,
    tabViewTestSuite,
    carouselTestSuite,
    swipeTestSuite,
    preferencesTestSuite,
    pangoMarkupTestSuite,
    chromeTestSuite,
    headerBarTestSuite,
    dataGridTestSuite,
    wrapBoxTestSuite,
    boxTestSuite,
    labelTestSuite,
    spinnerTestSuite,
    shortcutLabelTestSuite,
    shortcutFormatTestSuite,
    scrollingTestSuite,
    markupTestSuite,
    tagsTestSuite,
    sourceTestSuite,
    gobjectTestSuite,
    engineSlotTestSuite,
    gobjectOracleTestSuite,
    applicationTestSuite,
    applicationOracleTestSuite,
    windowMembersTestSuite,
    windowOracleTestSuite,
    widgetMapOracleTestSuite,
    acceleratorsTestSuite,
    glibTimersTestSuite,
    glibTimersOracleTestSuite,
    gdkTestSuite,
    gdkOracleTestSuite,
    grapheneTestSuite,
    gtkPlatformTestSuite,
    gtkCssOracleTestSuite,
    glibPathsTestSuite,
    glibPathsOracleTestSuite,
    glibUriTestSuite,
    glibUriOracleTestSuite,
    glibLanguageTestSuite,
    glibLanguageOracleTestSuite,
    glibVariantTestSuite,
    glibVariantOracleTestSuite,
    rgbaTestSuite,
    rgbaOracleTestSuite,
    glibUnicharTestSuite,
    glibUnicharOracleTestSuite,
    gioAppInfoTestSuite,
    gioAppInfoOracleTestSuite,
    carouselDoorsOracleTestSuite,
    releaseNotesTestSuite,
    aboutDialogDoorsOracleTestSuite,
    styleManagerTestSuite,
    styleManagerOracleTestSuite,
    rowAccessorsOracleTestSuite,
    simpleActionGroupTestSuite,
    simpleActionGroupOracleTestSuite,
    fileChooserTestSuite,
    fileChooserOracleTestSuite,
    gioResourceTestSuite,
    gioResourceOracleTestSuite,
    iconThemeResourcesTestSuite,
    iconThemeResourcesOracleTestSuite,
});
