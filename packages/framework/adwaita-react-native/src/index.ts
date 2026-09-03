// The BASE barrel — what a tool that ignores `exports` loads through `module`/`main`.
// Everything it names refuses at first render; who reaches it is in `refuse.ts`.
//
// IT NAMES THE BASE MODULES, NEVER A PLATFORM SIBLING: a sibling named here would
// RUN on the wrong half as a working worse copy of the widget, which is why
// `scripts/check-adwaita-rn-platform-split.mjs` rule 3 refuses one.
//
// It is also the package's TYPE authority — `exports["."].types` names the declarations
// generated from here, so one declaration describes both platform builds. `parity.spec.ts`
// is what makes both halves satisfy it.

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
// A run of `export { AdwBin } from './widgets/bin.js'` lines used to sit above this
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

import { AdwActionRow as ActionRow } from './widgets/action-row.js';
import { AdwAvatar as Avatar } from './widgets/avatar.js';
import { AdwBanner as Banner } from './widgets/banner.js';
import { AdwBin as Bin } from './widgets/bin.js';
import { AdwButtonContent as ButtonContent } from './widgets/button-content.js';
import { AdwButtonRow as ButtonRow } from './widgets/button-row.js';
import { AdwClamp as Clamp } from './widgets/clamp.js';
import { AdwComboRow as ComboRow } from './widgets/combo-row.js';
import { AdwEntryRow as EntryRow } from './widgets/entry-row.js';
import { AdwExpanderRow as ExpanderRow } from './widgets/expander-row.js';
import { AdwHeaderBar as HeaderBar } from './widgets/header-bar.js';
import { AdwNavigationPage as NavigationPage } from './widgets/navigation-page.js';
import { AdwNavigationSplitView as NavigationSplitView } from './widgets/navigation-split-view.js';
import { AdwNavigationView as NavigationView } from './widgets/navigation-view.js';
import { AdwOverlaySplitView as OverlaySplitView } from './widgets/overlay-split-view.js';
import { AdwPasswordEntryRow as PasswordEntryRow } from './widgets/password-entry-row.js';
import { AdwPreferencesGroup as PreferencesGroup } from './widgets/preferences-group.js';
import { AdwPreferencesPage as PreferencesPage } from './widgets/preferences-page.js';
import { AdwSpinRow as SpinRow } from './widgets/spin-row.js';
import { AdwSpinner as Spinner } from './widgets/spinner.js';
import { AdwStatusPage as StatusPage } from './widgets/status-page.js';
import { AdwSwitchRow as SwitchRow } from './widgets/switch-row.js';
import { AdwToastOverlay as ToastOverlay } from './widgets/toast-overlay.js';
import { AdwToolbarView as ToolbarView } from './widgets/toolbar-view.js';
import { AdwViewStack as ViewStack } from './widgets/view-stack.js';
import { AdwViewSwitcher as ViewSwitcher } from './widgets/view-switcher.js';
import { AdwWindowTitle as WindowTitle } from './widgets/window-title.js';
import { AdwWrapBox as WrapBox } from './widgets/wrap-box.js';

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
