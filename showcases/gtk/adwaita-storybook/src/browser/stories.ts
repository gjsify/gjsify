// Shared story list for the Adwaita storybook's browser target. Both the
// standalone entry (`main.ts`, `mountStorybook(document.body, …)`) and the
// embeddable `mount(container)` (`embed.ts`, used by the gjsify website) draw
// from this single list so the two stay in lockstep.
//
// THE ORDER OF THIS ARRAY NO LONGER DECIDES THE SIDEBAR. Categories are ordered
// by STORYBOOK_CATEGORY_ORDER in @gjsify/storybook-core, which every target's
// controller applies, so this list only decides which stories exist and how they
// sit WITHIN their category.
//
// It used to claim it mirrored the native sidebar's order. It measurably did not:
// the GTK and NativeScript storybooks took their order from a path glob
// (alphabetical by directory), so `Overview` led here and sat fifth there. One
// sentence was the only thing holding an invariant across three files, and the
// sentence was wrong — which is why the order moved somewhere a build gate can
// check it.

import type { WebStoryModule } from '@gjsify/adwaita-storybook';
import { OverviewWidgetsWebStories } from './overview/widgets.web.js';
import { AvatarWebStories } from './presentation/avatar.web.js';
import { BannerWebStories } from './presentation/banner.web.js';
import { ColumnViewWebStories } from './presentation/column-view.web.js';
import { GridViewWebStories } from './presentation/grid-view.web.js';
import { ListViewWebStories } from './presentation/list-view.web.js';
import { ShortcutLabelWebStories } from './presentation/shortcut-label.web.js';
import { SpinnerWebStories } from './presentation/spinner.web.js';
import { StatusPageWebStories } from './presentation/status-page.web.js';
import { TreeExpanderWebStories } from './presentation/tree-expander.web.js';
import { WindowTitleWebStories } from './presentation/window-title.web.js';
import { ActionRowWebStories } from './rows/action-row.web.js';
import { ButtonRowWebStories } from './rows/button-row.web.js';
import { ComboRowWebStories } from './rows/combo-row.web.js';
import { EntryRowWebStories } from './rows/entry-row.web.js';
import { ExpanderRowWebStories } from './rows/expander-row.web.js';
import { PasswordEntryRowWebStories } from './rows/password-entry-row.web.js';
import { PreferencesGroupWebStories } from './rows/preferences-group.web.js';
import { PreferencesRowWebStories } from './rows/preferences-row.web.js';
import { SpinRowWebStories } from './rows/spin-row.web.js';
import { SwitchRowWebStories } from './rows/switch-row.web.js';
import { DrawingAreaWebStories } from './drawing/drawing-area.web.js';
import { GLAreaWebStories } from './drawing/gl-area.web.js';
import { GraphicsOffloadWebStories } from './drawing/graphics-offload.web.js';
import { CheckButtonWebStories } from './controls/check-button.web.js';
import { DropDownWebStories } from './controls/drop-down.web.js';
import { EntryWebStories } from './controls/entry.web.js';
import { GtkSpinnerWebStories } from './controls/gtk-spinner.web.js';
import { LevelBarWebStories } from './controls/level-bar.web.js';
import { PasswordEntryWebStories } from './controls/password-entry.web.js';
import { ProgressBarWebStories } from './controls/progress-bar.web.js';
import { ScaleWebStories } from './controls/scale.web.js';
import { SearchEntryWebStories } from './controls/search-entry.web.js';
import { SpinButtonWebStories } from './controls/spin-button.web.js';
import { SwitchWebStories } from './controls/switch.web.js';
import { ExpanderWebStories } from './layout/expander.web.js';
import { OverlayWebStories } from './layout/overlay.web.js';
import { PanedWebStories } from './layout/paned.web.js';
import { RevealerWebStories } from './layout/revealer.web.js';
import { SeparatorWebStories } from './layout/separator.web.js';
import { BreakpointBinWebStories } from './layout/breakpoint-bin.web.js';
import { LayoutSlotWebStories } from './layout/layout-slot.web.js';
import { MultiLayoutViewWebStories } from './layout/multi-layout-view.web.js';
import { EditableLabelWebStories } from './text/editable-label.web.js';
import { SearchBarWebStories } from './text/search-bar.web.js';
import { TextViewWebStories } from './text/text-view.web.js';
import { TextWebStories } from './text/text.web.js';
import { AspectFrameWebStories } from './layout/aspect-frame.web.js';
import { CenterBoxWebStories } from './layout/center-box.web.js';
import { FixedWebStories } from './layout/fixed.web.js';
import { FrameWebStories } from './layout/frame.web.js';
import { GridWebStories } from './layout/grid.web.js';
import { ToggleButtonWebStories } from './buttons/toggle-button.web.js';
import { ColorDialogButtonWebStories } from './buttons/color-dialog-button.web.js';
import { FontDialogButtonWebStories } from './buttons/font-dialog-button.web.js';
import { LinkButtonWebStories } from './buttons/link-button.web.js';
import { ScaleButtonWebStories } from './buttons/scale-button.web.js';
import { ButtonContentWebStories } from './buttons/button-content.web.js';
import { ButtonStylesWebStories } from './buttons/button-styles.web.js';
import { MenuButtonWebStories } from './buttons/menu-button.web.js';
import { SplitButtonWebStories } from './buttons/split-button.web.js';
import { ToggleGroupWebStories } from './buttons/toggle-group.web.js';
import { BinWebStories } from './layout/bin.web.js';
import { ClampScrollableWebStories } from './layout/clamp-scrollable.web.js';
import { ClampWebStories } from './layout/clamp.web.js';
import { HeaderBarWebStories } from './layout/header-bar.web.js';
import { PopoverBinWebStories } from './layout/popover-bin.web.js';
import { PopoverMenuWebStories } from './layout/popover-menu.web.js';
import { PopoverWebStories } from './layout/popover.web.js';
import { ToolbarViewWebStories } from './layout/toolbar-view.web.js';
import { WrapBoxWebStories } from './layout/wrap-box.web.js';
import { CarouselWebStories } from './view-switching/carousel.web.js';
import { InlineViewSwitcherWebStories } from './view-switching/inline-view-switcher.web.js';
import { TabButtonWebStories } from './view-switching/tab-button.web.js';
import { TabViewWebStories } from './view-switching/tab-view.web.js';
import { ViewSwitcherWebStories } from './view-switching/view-switcher.web.js';
import { ViewSwitcherBarWebStories } from './view-switching/view-switcher-bar.web.js';
import { BottomSheetWebStories } from './navigation/bottom-sheet.web.js';
import { NavigationSplitViewWebStories } from './navigation/navigation-split-view.web.js';
import { NavigationViewWebStories } from './navigation/navigation-view.web.js';
import { OverlaySplitViewWebStories } from './navigation/overlay-split-view.web.js';
import { PopoverMenuBarWebStories } from './navigation/popover-menu-bar.web.js';
import { SidebarWebStories } from './navigation/sidebar.web.js';
import { AboutDialogWebStories } from './feedback/about-dialog.web.js';
import { AlertDialogWebStories } from './feedback/alert-dialog.web.js';
import { EmojiChooserWebStories } from './feedback/emoji-chooser.web.js';
import { GtkAboutDialogWebStories } from './feedback/gtk-about-dialog.web.js';
import { PageSetupUnixDialogWebStories } from './feedback/page-setup-unix-dialog.web.js';
import { PrintUnixDialogWebStories } from './feedback/print-unix-dialog.web.js';
import { PreferencesDialogWebStories } from './feedback/preferences-dialog.web.js';
import { ToastWebStories } from './feedback/toast.web.js';
import { ActionBarWebStories } from './windows/action-bar.web.js';
import { ApplicationWindowWebStories } from './windows/application-window.web.js';
import { GtkHeaderBarWebStories } from './windows/gtk-header-bar.web.js';
import { WindowControlsWebStories } from './windows/window-controls.web.js';
import { WindowWebStories } from './windows/window.web.js';

export const stories: WebStoryModule[] = [
    OverviewWidgetsWebStories,
    AvatarWebStories,
    BannerWebStories,
    ColumnViewWebStories,
    GridViewWebStories,
    ListViewWebStories,
    ShortcutLabelWebStories,
    SpinnerWebStories,
    StatusPageWebStories,
    TreeExpanderWebStories,
    WindowTitleWebStories,
    ActionRowWebStories,
    ButtonRowWebStories,
    ComboRowWebStories,
    EntryRowWebStories,
    ExpanderRowWebStories,
    PasswordEntryRowWebStories,
    PreferencesGroupWebStories,
    PreferencesRowWebStories,
    SpinRowWebStories,
    SwitchRowWebStories,
    EntryWebStories,
    DropDownWebStories,
    ScaleWebStories,
    SpinButtonWebStories,
    PasswordEntryWebStories,
    SearchEntryWebStories,
    CheckButtonWebStories,
    SwitchWebStories,
    ProgressBarWebStories,
    LevelBarWebStories,
    GtkSpinnerWebStories,
    DrawingAreaWebStories,
    GLAreaWebStories,
    GraphicsOffloadWebStories,
    ButtonContentWebStories,
    ButtonStylesWebStories,
    MenuButtonWebStories,
    SplitButtonWebStories,
    ToggleButtonWebStories,
    ColorDialogButtonWebStories,
    FontDialogButtonWebStories,
    LinkButtonWebStories,
    ScaleButtonWebStories,
    ToggleGroupWebStories,
    BinWebStories,
    ClampScrollableWebStories,
    ClampWebStories,
    HeaderBarWebStories,
    ExpanderWebStories,
    OverlayWebStories,
    PanedWebStories,
    PopoverWebStories,
    PopoverMenuWebStories,
    PopoverBinWebStories,
    RevealerWebStories,
    SeparatorWebStories,
    BreakpointBinWebStories,
    LayoutSlotWebStories,
    MultiLayoutViewWebStories,
    EditableLabelWebStories,
    TextWebStories,
    TextViewWebStories,
    SearchBarWebStories,
    FrameWebStories,
    AspectFrameWebStories,
    CenterBoxWebStories,
    GridWebStories,
    FixedWebStories,
    ToolbarViewWebStories,
    WrapBoxWebStories,
    CarouselWebStories,
    InlineViewSwitcherWebStories,
    TabButtonWebStories,
    TabViewWebStories,
    ViewSwitcherWebStories,
    ViewSwitcherBarWebStories,
    BottomSheetWebStories,
    NavigationSplitViewWebStories,
    NavigationViewWebStories,
    OverlaySplitViewWebStories,
    PopoverMenuBarWebStories,
    SidebarWebStories,
    AboutDialogWebStories,
    AlertDialogWebStories,
    EmojiChooserWebStories,
    GtkAboutDialogWebStories,
    PageSetupUnixDialogWebStories,
    PreferencesDialogWebStories,
    PrintUnixDialogWebStories,
    ToastWebStories,
    GtkHeaderBarWebStories,
    WindowControlsWebStories,
    ActionBarWebStories,
    WindowWebStories,
    ApplicationWindowWebStories,
];
