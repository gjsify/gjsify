// Browser entry — mounts the Adwaita storybook as a web app built from
// @gjsify/adwaita-web custom elements, mirroring the native GTK storybook
// (launched via `gjsify storybook`). Each *.web.ts story shares its metadata
// with the GTK *.story.ts twin, so the two targets expose identical controls
// and can be compared 1:1 via screenshots.

import { mountStorybook, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { AvatarWebStories } from './presentation/avatar.web.js';
import { BannerWebStories } from './presentation/banner.web.js';
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

// Order mirrors the native sidebar's category order (Presentation, Boxed
// Lists, Buttons, …).
const stories: WebStoryModule[] = [
    AvatarWebStories,
    BannerWebStories,
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

mountStorybook(document.body, { title: 'Adwaita Storybook', stories });
