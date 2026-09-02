// The React Native barrel — `exports["."]`'s `react-native` condition.
//
// A stock React Native 0.87 application reaches this file with NO configuration. Which
// package supplies which half of that, measured through the real resolver rather than
// read off a changelog, is in `scripts/check-adwaita-rn-platform-split.mjs`; so is the
// literal-naming rule the barrel below follows.

export type {
    AdwActionRowProps,
    AdwAvatarProps,
    AdwBannerProps,
    AdwBinProps,
    AdwButtonContentProps,
    AdwButtonRowProps,
    AdwClampProps,
    AdwComboRowProps,
    AdwEntryRowProps,
    AdwExpanderRowProps,
    AdwHeaderBarProps,
    AdwNavigationPageProps,
    AdwNavigationSplitViewProps,
    AdwNavigationViewHandle,
    AdwNavigationViewProps,
    AdwOverlaySplitViewProps,
    AdwPasswordEntryRowProps,
    AdwPreferencesGroupProps,
    AdwPreferencesPageProps,
    AdwRowProps,
    AdwSidebarWidthProps,
    AdwSpinRowProps,
    AdwSpinnerProps,
    AdwStatusPageProps,
    AdwSwitchRowProps,
    AdwToastOverlayHandle,
    AdwToastOverlayProps,
    AdwToolbarViewProps,
    AdwViewStackPageProps,
    AdwViewStackProps,
    AdwViewSwitcherProps,
    AdwWidgetProps,
    AdwWindowTitleProps,
    AdwWrapBoxProps,
} from './props.js';

export { AdwActionRow } from './widgets/action-row.native.js';
export { AdwAvatar } from './widgets/avatar.native.js';
export { AdwBanner } from './widgets/banner.native.js';
export { AdwBin } from './widgets/bin.native.js';
export { AdwButtonContent } from './widgets/button-content.native.js';
export { AdwButtonRow } from './widgets/button-row.native.js';
export { AdwClamp } from './widgets/clamp.native.js';
export { AdwComboRow } from './widgets/combo-row.native.js';
export { AdwEntryRow } from './widgets/entry-row.native.js';
export { AdwExpanderRow } from './widgets/expander-row.native.js';
export { AdwHeaderBar } from './widgets/header-bar.native.js';
export { AdwNavigationPage } from './widgets/navigation-page.native.js';
export { AdwNavigationSplitView } from './widgets/navigation-split-view.native.js';
export { AdwNavigationView } from './widgets/navigation-view.native.js';
export { AdwOverlaySplitView } from './widgets/overlay-split-view.native.js';
export { AdwPasswordEntryRow } from './widgets/password-entry-row.native.js';
export { AdwPreferencesGroup } from './widgets/preferences-group.native.js';
export { AdwPreferencesPage } from './widgets/preferences-page.native.js';
export { AdwSpinRow } from './widgets/spin-row.native.js';
export { AdwSpinner } from './widgets/spinner.native.js';
export { AdwStatusPage } from './widgets/status-page.native.js';
export { AdwSwitchRow } from './widgets/switch-row.native.js';
export { AdwToastOverlay } from './widgets/toast-overlay.native.js';
export { AdwToolbarView } from './widgets/toolbar-view.native.js';
export { AdwViewStack } from './widgets/view-stack.native.js';
export { AdwViewSwitcher } from './widgets/view-switcher.native.js';
export { AdwWindowTitle } from './widgets/window-title.native.js';
export { AdwWrapBox } from './widgets/wrap-box.native.js';

// ADR 0034 clause 2 — the vocabulary is also reachable as a NAMESPACE, not only as
// prefixed classes. Additive: `AdwBin` keeps working and nothing published moves.
//
// The members are imported a second time rather than built from the re-exports above,
// because those `export … from` lines are load-bearing for two readers:
// `adwaitaReactNativeWidgets` derives this package's widget set from them, and it
// refuses a line whose exported name and module name disagree. Collapsing them into
// `import` + `export {}` would take that coupling away. What keeps the second mention
// from drifting is rule 8 of `check-adwaita-rn-platform-split.mjs`, which holds the
// members of `Adw` against the widgets on disk in both directions.

import { AdwActionRow as ActionRow } from './widgets/action-row.native.js';
import { AdwAvatar as Avatar } from './widgets/avatar.native.js';
import { AdwBanner as Banner } from './widgets/banner.native.js';
import { AdwBin as Bin } from './widgets/bin.native.js';
import { AdwButtonContent as ButtonContent } from './widgets/button-content.native.js';
import { AdwButtonRow as ButtonRow } from './widgets/button-row.native.js';
import { AdwClamp as Clamp } from './widgets/clamp.native.js';
import { AdwComboRow as ComboRow } from './widgets/combo-row.native.js';
import { AdwEntryRow as EntryRow } from './widgets/entry-row.native.js';
import { AdwExpanderRow as ExpanderRow } from './widgets/expander-row.native.js';
import { AdwHeaderBar as HeaderBar } from './widgets/header-bar.native.js';
import { AdwNavigationPage as NavigationPage } from './widgets/navigation-page.native.js';
import { AdwNavigationSplitView as NavigationSplitView } from './widgets/navigation-split-view.native.js';
import { AdwNavigationView as NavigationView } from './widgets/navigation-view.native.js';
import { AdwOverlaySplitView as OverlaySplitView } from './widgets/overlay-split-view.native.js';
import { AdwPasswordEntryRow as PasswordEntryRow } from './widgets/password-entry-row.native.js';
import { AdwPreferencesGroup as PreferencesGroup } from './widgets/preferences-group.native.js';
import { AdwPreferencesPage as PreferencesPage } from './widgets/preferences-page.native.js';
import { AdwSpinRow as SpinRow } from './widgets/spin-row.native.js';
import { AdwSpinner as Spinner } from './widgets/spinner.native.js';
import { AdwStatusPage as StatusPage } from './widgets/status-page.native.js';
import { AdwSwitchRow as SwitchRow } from './widgets/switch-row.native.js';
import { AdwToastOverlay as ToastOverlay } from './widgets/toast-overlay.native.js';
import { AdwToolbarView as ToolbarView } from './widgets/toolbar-view.native.js';
import { AdwViewStack as ViewStack } from './widgets/view-stack.native.js';
import { AdwViewSwitcher as ViewSwitcher } from './widgets/view-switcher.native.js';
import { AdwWindowTitle as WindowTitle } from './widgets/window-title.native.js';
import { AdwWrapBox as WrapBox } from './widgets/wrap-box.native.js';

export const Adw = {
    ActionRow,
    Avatar,
    Banner,
    Bin,
    ButtonContent,
    ButtonRow,
    Clamp,
    ComboRow,
    EntryRow,
    ExpanderRow,
    HeaderBar,
    NavigationPage,
    NavigationSplitView,
    NavigationView,
    OverlaySplitView,
    PasswordEntryRow,
    PreferencesGroup,
    PreferencesPage,
    SpinRow,
    Spinner,
    StatusPage,
    SwitchRow,
    ToastOverlay,
    ToolbarView,
    ViewStack,
    ViewSwitcher,
    WindowTitle,
    WrapBox,
};
