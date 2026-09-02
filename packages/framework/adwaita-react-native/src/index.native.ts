// The React Native barrel — `exports["."]`'s `react-native` condition.
//
// A stock React Native 0.87 application reaches this file with NO configuration. Which
// package supplies which half of that, measured through the real resolver rather than
// read off a changelog, is in `scripts/check-adwaita-rn-platform-split.mjs`; so is the
// literal-naming rule the barrel below follows.

export type {
    AdwBinProps,
    AdwClampProps,
    AdwHeaderBarProps,
    AdwStatusPageProps,
    AdwToolbarViewProps,
    AdwWidgetProps,
    AdwWindowTitleProps,
    AdwWrapBoxProps,
} from './props.js';

export { AdwBin } from './widgets/bin.native.js';
export { AdwClamp } from './widgets/clamp.native.js';
export { AdwHeaderBar } from './widgets/header-bar.native.js';
export { AdwStatusPage } from './widgets/status-page.native.js';
export { AdwToolbarView } from './widgets/toolbar-view.native.js';
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

import { AdwBin as Bin } from './widgets/bin.native.js';
import { AdwClamp as Clamp } from './widgets/clamp.native.js';
import { AdwHeaderBar as HeaderBar } from './widgets/header-bar.native.js';
import { AdwStatusPage as StatusPage } from './widgets/status-page.native.js';
import { AdwToolbarView as ToolbarView } from './widgets/toolbar-view.native.js';
import { AdwWindowTitle as WindowTitle } from './widgets/window-title.native.js';
import { AdwWrapBox as WrapBox } from './widgets/wrap-box.native.js';

export const Adw = { Bin, Clamp, HeaderBar, StatusPage, ToolbarView, WindowTitle, WrapBox };
