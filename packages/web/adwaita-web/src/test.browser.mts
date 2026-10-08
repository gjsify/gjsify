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
import { AdwBreakpointBinTest } from './adw-breakpoint-bin.spec.js';
import { AdwMultiLayoutViewTest } from './adw-multi-layout-view.spec.js';
import { AdwDataGridTest } from './adw-data-grid.spec.js';
import { AdwDialogTest } from './adw-dialog.spec.js';
import { AdwWindowTest } from './adw-window.spec.js';
import { AdwShortcutsTest } from './adw-shortcuts.spec.js';
import { AdwApplicationWindowTest } from './adw-application-window.spec.js';
import { AdwAlertDialogTest } from './adw-alert-dialog.spec.js';
import { GtkDropDownTest } from './gtk-drop-down.spec.js';
import { GtkDragIconTest } from './gtk-drag-icon.spec.js';
import { GtkDrawingAreaTest } from './gtk-drawing-area.spec.js';
import { GtkGLAreaTest } from './gtk-gl-area.spec.js';
import { GtkGraphicsOffloadTest } from './gtk-graphics-offload.spec.js';
import { AdwRowStateTest } from './adw-row-state.spec.js';
import { AdwRowTooltipTest } from './row-tooltip.spec.js';
import { AdwTabViewTest } from './adw-tab-view.spec.js';
import { AdwToastOverlayTest } from './adw-toast-overlay.spec.js';
import { AdwViewSwitcherBarTest } from './adw-view-switcher-bar.spec.js';
import { AdwStyleIsolationTest } from './style-isolation.spec.js';
import { AdwWrapBoxTest } from './adw-wrap-box.spec.js';
import { AdwHeaderBarTest } from './adw-header-bar.spec.js';
import { GtkEntryTest } from './gtk-entry.spec.js';
import { GtkMenuButtonTest } from './gtk-menu-button.spec.js';
import { GtkPopoverTest } from './gtk-popover.spec.js';
import { GtkPopoverRoleTest } from './gtk-popover-role.spec.js';
import { GtkPopoverBinTest } from './gtk-popover-bin.spec.js';
import { GtkPopoverMenuTest } from './gtk-popover-menu.spec.js';
import { GtkPopoverMenuBarTest } from './gtk-popover-menu-bar.spec.js';
import { GioMenuTest } from './gio-menu.spec.js';
import { GtkValueDoorsTest } from './gtk-value-doors.spec.js';
import { GtkButtonTest } from './gtk-button.spec.js';
import { GtkAboutDialogTest } from './gtk-about-dialog.spec.js';
import { GtkEmojiChooserTest } from './gtk-emoji-chooser.spec.js';
import { GtkPrintDialogsTest } from './gtk-print-dialogs.spec.js';
import { AdwBannerTest } from './adw-banner.spec.js';
import { AdwButtonContentTest } from './adw-button-content.spec.js';
import { GtkImageTest } from './gtk-image.spec.js';
import { AdwIconRegistryTest } from './icon-registry.spec.js';
import { GtkSwitchTest } from './gtk-switch.spec.js';
import { AdwChecksTest } from './checks.spec.js';
import { GtkProgressBarTest } from './gtk-progress-bar.spec.js';
import { GtkLevelBarTest } from './gtk-level-bar.spec.js';
import { GtkSpinnerTest } from './gtk-spinner.spec.js';
import { GtkNotebookTest } from './gtk-notebook.spec.js';
import { GtkStackTest } from './gtk-stack.spec.js';
import { GtkStackSidebarTest } from './gtk-stack-sidebar.spec.js';
import { GtkStackSwitcherTest } from './gtk-stack-switcher.spec.js';
import { GtkColumnViewTest } from './gtk-column-view.spec.js';
import { GtkGridViewTest } from './gtk-grid-view.spec.js';
import { GtkListViewTest } from './gtk-list-view.spec.js';
import { GtkHeaderBarTest } from './gtk-header-bar.spec.js';
import { GtkWindowControlsTest } from './gtk-window-controls.spec.js';
import { GtkWindowTest } from './gtk-window.spec.js';
import { GtkApplicationWindowTest } from './gtk-application-window.spec.js';
import { GtkActionBarTest } from './gtk-action-bar.spec.js';
import { GtkSeparatorTest } from './gtk-separator.spec.js';
import { GtkCalendarTest } from './gtk-calendar.spec.js';
import { GtkFlowBoxTest } from './gtk-flow-box.spec.js';
import { GtkListBoxTest } from './gtk-list-box.spec.js';
import { GtkTreeExpanderTest } from './gtk-tree-expander.spec.js';
import { GtkToggleButtonTest } from './gtk-toggle-button.spec.js';
import { GtkExpanderTest } from './gtk-expander.spec.js';
import { GtkOverlayTest } from './gtk-overlay.spec.js';
import { GtkPanedTest } from './gtk-paned.spec.js';
import { GtkRevealerTest } from './gtk-revealer.spec.js';
import { GtkScaleTest } from './gtk-scale.spec.js';
import { GtkSpinButtonTest } from './gtk-spin-button.spec.js';
import { GtkPasswordEntryTest } from './gtk-password-entry.spec.js';
import { GtkSearchEntryTest } from './gtk-search-entry.spec.js';
import { GtkLinkButtonTest } from './gtk-link-button.spec.js';
import { GtkScaleButtonTest } from './gtk-scale-button.spec.js';
import { GtkColorDialogButtonTest } from './gtk-color-dialog-button.spec.js';
import { GtkFontDialogButtonTest } from './gtk-font-dialog-button.spec.js';
import { AdwBinTest } from './adw-bin.spec.js';
import { AdwClampScrollableTest } from './adw-clamp-scrollable.spec.js';
import { AdwPreferencesRowTest } from './adw-preferences-row.spec.js';
import { AdwTabBarTest } from './adw-tab-bar.spec.js';
import { AdwTabButtonTest } from './adw-tab-button.spec.js';
import { AdwTabOverviewTest } from './adw-tab-overview.spec.js';
import { AdwViewSwitcherSidebarTest } from './adw-view-switcher-sidebar.spec.js';
import { GtkEditableLabelTest } from './gtk-editable-label.spec.js';
import { GtkSearchBarTest } from './gtk-search-bar.spec.js';
import { GtkTextTest } from './gtk-text.spec.js';
import { GtkTextViewTest } from './gtk-text-view.spec.js';
import { GtkFrameTest } from './gtk-frame.spec.js';
import { GtkAspectFrameTest } from './gtk-aspect-frame.spec.js';
import { GtkCenterBoxTest } from './gtk-center-box.spec.js';
import { GtkGridTest } from './gtk-grid.spec.js';
import { GtkFixedTest } from './gtk-fixed.spec.js';
import { GtkScrolledWindowTest } from './gtk-scrolled-window.spec.js';
import { GtkScrollbarTest } from './gtk-scrollbar.spec.js';
import { GtkViewportTest } from './gtk-viewport.spec.js';
import { GtkWindowHandleTest } from './gtk-window-handle.spec.js';
import { GtkBoxTest } from './gtk-box.spec.js';
import { GtkLabelTest } from './gtk-label.spec.js';
// The media group, after `GtkLabelTest` because `<gtk-media-controls>` adopts its stream from
// the nearest ancestor `<gtk-video>` and `<gtk-inscription>` asserts the `.numeric`-shaped
// label rules `GtkLabelTest` established — neither is order-dependent, but grouping the four
// here is what makes the block findable.
import { GtkPictureTest } from './gtk-picture.spec.js';
import { GtkInscriptionTest } from './gtk-inscription.spec.js';
import { GtkVideoTest } from './gtk-video.spec.js';
import { GtkMediaControlsTest } from './gtk-media-controls.spec.js';
import { AdwAboutDialogTest } from './adw-about-dialog.spec.js';
import { AdwStatusPageTest } from './adw-status-page.spec.js';
import { AdwStyleClassesTest } from './style-classes.spec.js';
import { AdwAccentTest } from './adw-accent.spec.js';
import { AdwAppearanceTest } from './adw-appearance.spec.js';
import { AdwShortcutLabelTest } from './adw-shortcut-label.spec.js';
import { AdwConnectLifecycleTest } from './connect-lifecycle.spec.js';
import { AdwEmptySectionsTest } from './empty-sections.spec.js';
import { AdwSlottedChildrenTest } from './slotted-children.spec.js';
import { AdwKeyboardOperableTest } from './keyboard-operable.spec.js';
import { AdwFontsTest } from './adw-fonts.spec.js';
import { AdwConstructVectorsTest } from './construct-vectors.spec.js';
import { GObjectDoorTest } from './gobject-door.spec.js';
import { ApplicationTest } from './application.spec.js';
import { GLibTest } from './glib.spec.js';
import { AdwSharedTreesTest } from './shared-trees.spec.js';
import { AdwBlueprintTreeTest } from './blueprint-tree.spec.js';
import { AdwValueListsTest } from './value-lists.spec.js';
import { AdwBlueprintLayoutTest } from './blueprint-layout.spec.js';
import { AdwWidgetSizeTest } from './widget-size.spec.js';
import { AdwSharedTreeMountTest } from './shared-tree-mount.spec.js';
import { AdwBlueprintMarkupTest } from './blueprint-markup.spec.js';
import { AdwTagsTest } from './tags.spec.js';
import { AdwFontStackTest } from './font-stack.spec.js';

run({
    AdwSharedTreesTest,
    AdwConstructVectorsTest,
    GObjectDoorTest,
    ApplicationTest,
    GLibTest,
    AdwBlueprintTreeTest,
    AdwValueListsTest,
    AdwBlueprintLayoutTest,
    AdwWidgetSizeTest,
    AdwSharedTreeMountTest,
    AdwBlueprintMarkupTest,
    AdwTagsTest,
    AdwKeyboardOperableTest,
    AdwConnectLifecycleTest,
    AdwEmptySectionsTest,
    AdwSlottedChildrenTest,
    AdwStatusPageTest,
    AdwStyleClassesTest,
    AdwAccentTest,
    AdwAppearanceTest,
    AdwShortcutLabelTest,
    AdwAboutDialogTest,
    AdwAlertDialogTest,
    AdwBannerTest,
    AdwButtonContentTest,
    GtkImageTest,
    AdwIconRegistryTest,
    GtkSwitchTest,
    AdwChecksTest,
    GtkProgressBarTest,
    GtkLevelBarTest,
    GtkSpinnerTest,
    GtkStackTest,
    GtkStackSwitcherTest,
    GtkStackSidebarTest,
    GtkNotebookTest,
    GtkColumnViewTest,
    GtkGridViewTest,
    GtkListViewTest,
    GtkHeaderBarTest,
    GtkWindowControlsTest,
    GtkWindowTest,
    GtkApplicationWindowTest,
    GtkActionBarTest,
    GtkSeparatorTest,
    GtkCalendarTest,
    GtkFlowBoxTest,
    GtkListBoxTest,
    GtkTreeExpanderTest,
    GtkDrawingAreaTest,
    GtkDragIconTest,
    GtkGLAreaTest,
    GtkGraphicsOffloadTest,
    GtkToggleButtonTest,
    GtkExpanderTest,
    GtkOverlayTest,
    GtkPanedTest,
    GtkRevealerTest,
    GtkScaleTest,
    GtkSpinButtonTest,
    GtkPasswordEntryTest,
    GtkSearchEntryTest,
    GtkLinkButtonTest,
    GtkScaleButtonTest,
    GtkColorDialogButtonTest,
    GtkFontDialogButtonTest,
    AdwBinTest,
    AdwClampScrollableTest,
    AdwPreferencesRowTest,
    AdwTabBarTest,
    AdwTabButtonTest,
    AdwTabOverviewTest,
    AdwViewSwitcherSidebarTest,
    GtkEditableLabelTest,
    GtkTextTest,
    GtkTextViewTest,
    GtkSearchBarTest,
    GtkFrameTest,
    GtkAspectFrameTest,
    GtkCenterBoxTest,
    GtkGridTest,
    GtkFixedTest,
    GtkScrolledWindowTest,
    GtkScrollbarTest,
    GtkViewportTest,
    GtkWindowHandleTest,
    GtkBoxTest,
    GtkLabelTest,
    GtkPictureTest,
    GtkInscriptionTest,
    GtkVideoTest,
    GtkMediaControlsTest,
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
    AdwBreakpointBinTest,
    AdwMultiLayoutViewTest,
    AdwDataGridTest,
    AdwDialogTest,
    AdwWindowTest,
    AdwShortcutsTest,
    AdwApplicationWindowTest,
    GtkDropDownTest,
    AdwRowStateTest,
    AdwRowTooltipTest,
    AdwTabViewTest,
    AdwToastOverlayTest,
    AdwViewSwitcherBarTest,
    AdwStyleIsolationTest,
    AdwWrapBoxTest,
    AdwHeaderBarTest,
    GtkEntryTest,
    GtkMenuButtonTest,
    GtkPopoverTest,
    GtkPopoverRoleTest,
    GtkPopoverBinTest,
    GtkPopoverMenuTest,
    GtkPopoverMenuBarTest,
    GioMenuTest,
    GtkValueDoorsTest,
    GtkButtonTest,
    GtkAboutDialogTest,
    GtkEmojiChooserTest,
    GtkPrintDialogsTest,
    AdwViewStackTest,
    AdwNavigationViewTest,
    AdwSidebarTest,
    AdwEntryRowsTest,
    AdwSplitButtonTest,
    // Last, because it registers real webfaces in `document.fonts` and that
    // changes text metrics for the whole document. Defence in depth only: the
    // suite removes them in a `finally`, so appending a suite after this line
    // cannot break it — see `adw-fonts.spec.ts`.
    AdwFontsTest,
    // Reads the injected stylesheet's `:root` custom properties. After the font
    // suite for the same reason: a host with the Adwaita faces installed must not
    // change what it sees, and a suite that re-registered a webface would.
    AdwFontStackTest,
});
