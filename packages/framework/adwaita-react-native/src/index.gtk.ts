// The GTK barrel — `exports["."]`'s `default` condition.
//
// EVERY PLATFORM FILE IS NAMED EXPLICITLY. The halves fork once, at the package boundary,
// through `exports` conditions; inside the package every import is unconditional and
// literal. Resolving them by FILE NAME instead — gjsify's `.gtk` chain, Metro's `.native`
// step — does not work for a published library; the measurement against
// `metro-resolver@0.87.0` that settles it lives with the gate that enforces the
// replacement, `scripts/check-adwaita-rn-platform-split.mjs`.

export type { AdwBinProps, AdwClampProps, AdwWidgetProps } from './props.js';

export { AdwBin } from './widgets/bin.gtk.js';
export { AdwClamp } from './widgets/clamp.gtk.js';

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

import { AdwBin as Bin } from './widgets/bin.gtk.js';
import { AdwClamp as Clamp } from './widgets/clamp.gtk.js';

export const Adw = { Bin, Clamp };
