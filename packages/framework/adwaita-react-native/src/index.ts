// The BASE barrel — what a tool that ignores `exports` loads through `module`/`main`.
// Everything it names refuses at first render; who reaches it is in `refuse.ts`.
//
// IT RE-EXPORTS THE BASE MODULES, NEVER A PLATFORM SIBLING: a sibling named here would
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
    AdwEntryRowProps,
    AdwExpanderRowProps,
    AdwHeaderBarProps,
    AdwRowProps,
    AdwSpinnerProps,
    AdwStatusPageProps,
    AdwSwitchRowProps,
    AdwToastOverlayHandle,
    AdwToastOverlayProps,
    AdwToolbarViewProps,
    AdwWidgetProps,
    AdwWindowTitleProps,
    AdwWrapBoxProps,
} from './props.js';

export { AdwActionRow } from './widgets/action-row.js';
export { AdwAvatar } from './widgets/avatar.js';
export { AdwBanner } from './widgets/banner.js';
export { AdwBin } from './widgets/bin.js';
export { AdwButtonContent } from './widgets/button-content.js';
export { AdwButtonRow } from './widgets/button-row.js';
export { AdwClamp } from './widgets/clamp.js';
export { AdwEntryRow } from './widgets/entry-row.js';
export { AdwExpanderRow } from './widgets/expander-row.js';
export { AdwHeaderBar } from './widgets/header-bar.js';
export { AdwSpinner } from './widgets/spinner.js';
export { AdwStatusPage } from './widgets/status-page.js';
export { AdwSwitchRow } from './widgets/switch-row.js';
export { AdwToastOverlay } from './widgets/toast-overlay.js';
export { AdwToolbarView } from './widgets/toolbar-view.js';
export { AdwWindowTitle } from './widgets/window-title.js';
export { AdwWrapBox } from './widgets/wrap-box.js';

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

import { AdwActionRow as ActionRow } from './widgets/action-row.js';
import { AdwAvatar as Avatar } from './widgets/avatar.js';
import { AdwBanner as Banner } from './widgets/banner.js';
import { AdwBin as Bin } from './widgets/bin.js';
import { AdwButtonContent as ButtonContent } from './widgets/button-content.js';
import { AdwButtonRow as ButtonRow } from './widgets/button-row.js';
import { AdwClamp as Clamp } from './widgets/clamp.js';
import { AdwEntryRow as EntryRow } from './widgets/entry-row.js';
import { AdwExpanderRow as ExpanderRow } from './widgets/expander-row.js';
import { AdwHeaderBar as HeaderBar } from './widgets/header-bar.js';
import { AdwSpinner as Spinner } from './widgets/spinner.js';
import { AdwStatusPage as StatusPage } from './widgets/status-page.js';
import { AdwSwitchRow as SwitchRow } from './widgets/switch-row.js';
import { AdwToastOverlay as ToastOverlay } from './widgets/toast-overlay.js';
import { AdwToolbarView as ToolbarView } from './widgets/toolbar-view.js';
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
    EntryRow,
    ExpanderRow,
    HeaderBar,
    Spinner,
    StatusPage,
    SwitchRow,
    ToastOverlay,
    ToolbarView,
    WindowTitle,
    WrapBox,
};
