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

// THE WIDGETS ARE REACHABLE ONLY AS `Adw.<Name>` (ADR 0034 clause 2 + § Amendment 8).
// A run of `export { AdwBin } from './widgets/bin.native.js'` lines used to sit above this
// and duplicate every member below one for one. They are gone, and with them the second
// spelling: `Adw.Bin` is the name this package root has for the widget.
//
// THE COMPONENTS KEEP THEIR `AdwBin` IDENTIFIER, and that is not the spelling that was
// removed. `widgets/bin.ts` declares it, `exports['./widgets/bin']` publishes it, and
// `refuseBaseModule` prints it — at that entry point it is the widget's ONLY name, the
// same reason `@gjsify/adwaita-web` kept `class GtkEntry` while dropping the flat export
// (§ Amendment 6). What a bare `Bin` would gain in a consumer's file is nothing; what it
// would cost is the module-name coupling three readers derive through `widgetClass`.
//
// THE IMPORT LINES BELOW ARE NOW THE SINGLE MENTION of each widget, so they carry the
// coupling the removed exports used to: `adwaitaReactNativeWidgets` derives this
// package's widget set from them and refuses a line whose binding, alias and module name
// disagree, and rule 8 of `check-adwaita-rn-platform-split.mjs` holds the members of
// `Adw` against the widgets on disk in both directions. Rule 10 is what stops the flat
// spelling from growing back beside them.
//
// AN OBJECT LITERAL, not `export * as Adw from './namespace/adw.js'` — the shape
// `@gjsify/adwaita-web` had to take. A module namespace buys the TYPE meaning of its
// members, which that surface needs because its classes are annotated (`as Adw.Window`).
// These are function components, annotated through the `Adw…Props` types above, so value
// position is the whole requirement here. And a namespace module per barrel would move
// the platform fork one hop away from the file that rules 3 and 5 read.

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
