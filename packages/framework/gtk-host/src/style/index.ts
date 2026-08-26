// `@gjsify/gtk-host/style` — the style partition, L1 of ADR 0032.
//
// Framework-agnostic and React-Native-agnostic: `class="flex-1"` in a Vue template
// is the same question as `className="flex-1"` on a React element, and both are the
// same question as a `style={{…}}` object. This is the half every current and future
// binding can use, which is why it lives here rather than in the React Native
// package — and why ADR 0027 rule 1 puts it inside `gtk-host` rather than beside it.
//
// Today it answers the PAINT half. The layout half — widget selection, `hexpand`,
// alignment, spacing — is the next milestone, and reaching one of its utilities is a
// named error rather than a silent drop.

export { GTK_CSS_PROBES, GTK_CSS_PROPERTIES, NOT_GTK_CSS } from './gtk-css.js';
export { MINIMAL_TOKENS } from './tokens.js';
export type { Scale, StyleTokens } from './tokens.js';
export { UnknownUtilityError, partition, resolveUtilities, resolveUtility } from './paint.js';
export type { PaintProps, Partitioned } from './paint.js';
