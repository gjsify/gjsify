// Aggregated story list for the NativeScript Adwaita storybook. Each *.ns.ts
// shares its metadata with the GTK *.story.ts + browser *.web.ts twins (via the
// GTK showcase's `@gjsify/example-gtk-adwaita-storybook/metas` barrel), so the
// three targets render the SAME stories and can be compared 1:1.
//
// Order mirrors the native GTK sidebar's category order.

import type { NsStoryModule } from '@gjsify/storybook-nativescript';
import { AvatarNsStories } from './presentation/avatar.ns.js';
import { BannerNsStories } from './presentation/banner.ns.js';
import { SpinnerNsStories } from './presentation/spinner.ns.js';
import { StatusPageNsStories } from './presentation/status-page.ns.js';
import { WindowTitleNsStories } from './presentation/window-title.ns.js';
import { ActionRowNsStories } from './rows/action-row.ns.js';
import { ButtonRowNsStories } from './rows/button-row.ns.js';
import { ComboRowNsStories } from './rows/combo-row.ns.js';
import { EntryRowNsStories } from './rows/entry-row.ns.js';
import { ExpanderRowNsStories } from './rows/expander-row.ns.js';
import { PasswordEntryRowNsStories } from './rows/password-entry-row.ns.js';
import { PreferencesGroupNsStories } from './rows/preferences-group.ns.js';
import { SpinRowNsStories } from './rows/spin-row.ns.js';
import { SwitchRowNsStories } from './rows/switch-row.ns.js';
import { ButtonContentNsStories } from './buttons/button-content.ns.js';
import { ButtonStylesNsStories } from './buttons/button-styles.ns.js';
import { SplitButtonNsStories } from './buttons/split-button.ns.js';
import { ToggleGroupNsStories } from './buttons/toggle-group.ns.js';
import { ClampNsStories } from './layout/clamp.ns.js';
import { HeaderBarNsStories } from './layout/header-bar.ns.js';
import { ToolbarViewNsStories } from './layout/toolbar-view.ns.js';
import { WrapBoxNsStories } from './layout/wrap-box.ns.js';
import { CarouselNsStories } from './view-switching/carousel.ns.js';
import { InlineViewSwitcherNsStories } from './view-switching/inline-view-switcher.ns.js';
import { TabViewNsStories } from './view-switching/tab-view.ns.js';
import { ViewSwitcherNsStories } from './view-switching/view-switcher.ns.js';
import { BottomSheetNsStories } from './navigation/bottom-sheet.ns.js';
import { NavigationSplitViewNsStories } from './navigation/navigation-split-view.ns.js';
import { NavigationViewNsStories } from './navigation/navigation-view.ns.js';
import { OverlaySplitViewNsStories } from './navigation/overlay-split-view.ns.js';
import { SidebarNsStories } from './navigation/sidebar.ns.js';
import { AboutDialogNsStories } from './feedback/about-dialog.ns.js';
import { AlertDialogNsStories } from './feedback/alert-dialog.ns.js';
import { PreferencesDialogNsStories } from './feedback/preferences-dialog.ns.js';
import { ToastNsStories } from './feedback/toast.ns.js';

export const stories: NsStoryModule[] = [
    AvatarNsStories,
    BannerNsStories,
    SpinnerNsStories,
    StatusPageNsStories,
    WindowTitleNsStories,
    ActionRowNsStories,
    ButtonRowNsStories,
    ComboRowNsStories,
    EntryRowNsStories,
    ExpanderRowNsStories,
    PasswordEntryRowNsStories,
    PreferencesGroupNsStories,
    SpinRowNsStories,
    SwitchRowNsStories,
    ButtonContentNsStories,
    ButtonStylesNsStories,
    SplitButtonNsStories,
    ToggleGroupNsStories,
    ClampNsStories,
    HeaderBarNsStories,
    ToolbarViewNsStories,
    WrapBoxNsStories,
    CarouselNsStories,
    InlineViewSwitcherNsStories,
    TabViewNsStories,
    ViewSwitcherNsStories,
    BottomSheetNsStories,
    NavigationSplitViewNsStories,
    NavigationViewNsStories,
    OverlaySplitViewNsStories,
    SidebarNsStories,
    AboutDialogNsStories,
    AlertDialogNsStories,
    PreferencesDialogNsStories,
    ToastNsStories,
];
