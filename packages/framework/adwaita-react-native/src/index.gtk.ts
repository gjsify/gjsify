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
