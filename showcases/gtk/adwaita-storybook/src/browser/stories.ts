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
import { ShortcutLabelWebStories } from './presentation/shortcut-label.web.js';
import { SpinnerWebStories } from './presentation/spinner.web.js';
import { StatusPageWebStories } from './presentation/status-page.web.js';
import { WindowTitleWebStories } from './presentation/window-title.web.js';
import { ActionRowWebStories } from './rows/action-row.web.js';
import { ButtonRowWebStories } from './rows/button-row.web.js';
import { ComboRowWebStories } from './rows/combo-row.web.js';
import { EntryRowWebStories } from './rows/entry-row.web.js';
import { ExpanderRowWebStories } from './rows/expander-row.web.js';
import { PasswordEntryRowWebStories } from './rows/password-entry-row.web.js';
import { PreferencesGroupWebStories } from './rows/preferences-group.web.js';
import { SpinRowWebStories } from './rows/spin-row.web.js';
import { SwitchRowWebStories } from './rows/switch-row.web.js';
import { ButtonContentWebStories } from './buttons/button-content.web.js';
import { ButtonStylesWebStories } from './buttons/button-styles.web.js';
import { SplitButtonWebStories } from './buttons/split-button.web.js';
import { ToggleGroupWebStories } from './buttons/toggle-group.web.js';
import { ClampWebStories } from './layout/clamp.web.js';
import { HeaderBarWebStories } from './layout/header-bar.web.js';
import { ToolbarViewWebStories } from './layout/toolbar-view.web.js';
import { WrapBoxWebStories } from './layout/wrap-box.web.js';
import { CarouselWebStories } from './view-switching/carousel.web.js';
import { InlineViewSwitcherWebStories } from './view-switching/inline-view-switcher.web.js';
import { TabViewWebStories } from './view-switching/tab-view.web.js';
import { ViewSwitcherWebStories } from './view-switching/view-switcher.web.js';
import { BottomSheetWebStories } from './navigation/bottom-sheet.web.js';
import { NavigationSplitViewWebStories } from './navigation/navigation-split-view.web.js';
import { NavigationViewWebStories } from './navigation/navigation-view.web.js';
import { OverlaySplitViewWebStories } from './navigation/overlay-split-view.web.js';
import { SidebarWebStories } from './navigation/sidebar.web.js';
import { AboutDialogWebStories } from './feedback/about-dialog.web.js';
import { AlertDialogWebStories } from './feedback/alert-dialog.web.js';
import { PreferencesDialogWebStories } from './feedback/preferences-dialog.web.js';
import { ToastWebStories } from './feedback/toast.web.js';

export const stories: WebStoryModule[] = [
    OverviewWidgetsWebStories,
    AvatarWebStories,
    BannerWebStories,
    ShortcutLabelWebStories,
    SpinnerWebStories,
    StatusPageWebStories,
    WindowTitleWebStories,
    ActionRowWebStories,
    ButtonRowWebStories,
    ComboRowWebStories,
    EntryRowWebStories,
    ExpanderRowWebStories,
    PasswordEntryRowWebStories,
    PreferencesGroupWebStories,
    SpinRowWebStories,
    SwitchRowWebStories,
    ButtonContentWebStories,
    ButtonStylesWebStories,
    SplitButtonWebStories,
    ToggleGroupWebStories,
    ClampWebStories,
    HeaderBarWebStories,
    ToolbarViewWebStories,
    WrapBoxWebStories,
    CarouselWebStories,
    InlineViewSwitcherWebStories,
    TabViewWebStories,
    ViewSwitcherWebStories,
    BottomSheetWebStories,
    NavigationSplitViewWebStories,
    NavigationViewWebStories,
    OverlaySplitViewWebStories,
    SidebarWebStories,
    AboutDialogWebStories,
    AlertDialogWebStories,
    PreferencesDialogWebStories,
    ToastWebStories,
];
