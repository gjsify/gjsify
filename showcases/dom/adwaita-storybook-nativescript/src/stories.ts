// Aggregated story list for the NativeScript Adwaita storybook. Each *.ns.ts
// shares its metadata with the GTK *.story.ts + browser *.web.ts twins (via the
// GTK showcase's `@gjsify/example-gtk-adwaita-storybook/metas` barrel), so the
// three targets render the SAME stories and can be compared 1:1.
//
// Order MIRRORS the native GTK sidebar exactly: the GTK storybook discovers
// `*.story.ts` by path glob, so its category + story order is alphabetical by
// `<category-dir>/<story-file>` — Buttons, Feedback, Layout, Navigation,
// Presentation, Boxed Lists (rows/), View Switching. This array follows the same
// order so the NS sidebar lists stories identically to the GTK one.

import type { NsStoryModule } from '@gjsify/storybook-nativescript';
// Buttons
import { ButtonContentNsStories } from './buttons/button-content.ns.js';
import { ButtonStylesNsStories } from './buttons/button-styles.ns.js';
import { SplitButtonNsStories } from './buttons/split-button.ns.js';
import { ToggleGroupNsStories } from './buttons/toggle-group.ns.js';
// Feedback
import { AboutDialogNsStories } from './feedback/about-dialog.ns.js';
import { AlertDialogNsStories } from './feedback/alert-dialog.ns.js';
import { PreferencesDialogNsStories } from './feedback/preferences-dialog.ns.js';
import { ToastNsStories } from './feedback/toast.ns.js';
// Layout
import { ClampNsStories } from './layout/clamp.ns.js';
import { HeaderBarNsStories } from './layout/header-bar.ns.js';
import { ToolbarViewNsStories } from './layout/toolbar-view.ns.js';
import { WrapBoxNsStories } from './layout/wrap-box.ns.js';
// Navigation
import { BottomSheetNsStories } from './navigation/bottom-sheet.ns.js';
import { NavigationSplitViewNsStories } from './navigation/navigation-split-view.ns.js';
import { NavigationViewNsStories } from './navigation/navigation-view.ns.js';
import { OverlaySplitViewNsStories } from './navigation/overlay-split-view.ns.js';
import { SidebarNsStories } from './navigation/sidebar.ns.js';
// Presentation
import { AvatarNsStories } from './presentation/avatar.ns.js';
import { BannerNsStories } from './presentation/banner.ns.js';
import { SpinnerNsStories } from './presentation/spinner.ns.js';
import { StatusPageNsStories } from './presentation/status-page.ns.js';
import { WindowTitleNsStories } from './presentation/window-title.ns.js';
// Boxed Lists (rows/)
import { ActionRowNsStories } from './rows/action-row.ns.js';
import { ButtonRowNsStories } from './rows/button-row.ns.js';
import { ComboRowNsStories } from './rows/combo-row.ns.js';
import { EntryRowNsStories } from './rows/entry-row.ns.js';
import { ExpanderRowNsStories } from './rows/expander-row.ns.js';
import { PasswordEntryRowNsStories } from './rows/password-entry-row.ns.js';
import { PreferencesGroupNsStories } from './rows/preferences-group.ns.js';
import { SpinRowNsStories } from './rows/spin-row.ns.js';
import { SwitchRowNsStories } from './rows/switch-row.ns.js';
// View Switching
import { CarouselNsStories } from './view-switching/carousel.ns.js';
import { InlineViewSwitcherNsStories } from './view-switching/inline-view-switcher.ns.js';
import { TabViewNsStories } from './view-switching/tab-view.ns.js';
import { ViewSwitcherNsStories } from './view-switching/view-switcher.ns.js';

export const stories: NsStoryModule[] = [
    // Buttons
    ButtonContentNsStories,
    ButtonStylesNsStories,
    SplitButtonNsStories,
    ToggleGroupNsStories,
    // Feedback
    AboutDialogNsStories,
    AlertDialogNsStories,
    PreferencesDialogNsStories,
    ToastNsStories,
    // Layout
    ClampNsStories,
    HeaderBarNsStories,
    ToolbarViewNsStories,
    WrapBoxNsStories,
    // Navigation
    BottomSheetNsStories,
    NavigationSplitViewNsStories,
    NavigationViewNsStories,
    OverlaySplitViewNsStories,
    SidebarNsStories,
    // Presentation
    AvatarNsStories,
    BannerNsStories,
    SpinnerNsStories,
    StatusPageNsStories,
    WindowTitleNsStories,
    // Boxed Lists (rows/)
    ActionRowNsStories,
    ButtonRowNsStories,
    ComboRowNsStories,
    EntryRowNsStories,
    ExpanderRowNsStories,
    PasswordEntryRowNsStories,
    PreferencesGroupNsStories,
    SpinRowNsStories,
    SwitchRowNsStories,
    // View Switching
    CarouselNsStories,
    InlineViewSwitcherNsStories,
    TabViewNsStories,
    ViewSwitcherNsStories,
];
