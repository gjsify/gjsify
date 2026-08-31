// `@gjsify/gtk-host/style` — the style partition, L1 of ADR 0032.
//
// Framework-agnostic and React-Native-agnostic: `class="flex-1"` in a Vue template
// is the same question as `className="flex-1"` on a React element, and both are the
// same question as a `style={{…}}` object. This is the half every current and future
// binding can use, which is why it lives here rather than in the React Native
// package — and why ADR 0027 rule 1 puts it inside `gtk-host` rather than beside it.
//
// It answers a utility in one of three ways and never in a fourth: a GTK CSS
// declaration, a GTK widget property, or an INTENT that only the shadow tree can
// resolve (ADR 0032 § 6). Anything it cannot answer is a named error — an unknown
// utility, a token missing from a scale, or a combination GTK has no way to express.
// There is no silent drop, because a styling layer that ignores part of its input is
// invisible in CI and obvious on screen.

export { GTK_CSS_PROBES, GTK_CSS_PROPERTIES, NOT_GTK_CSS } from './gtk-css.js';
export { GTK_WIDGET_PROPERTIES, GTK_WIDGET_PROPERTY_PROBES, NOT_GTK_WIDGET_PROPERTIES } from './gtk-props.js';
export {
    MINIMAL_TOKENS,
    TAILWIND_DEFAULT_TOKENS,
    lookupToken,
    mergeTokens,
    requireToken,
    tailwindDefaultHint,
} from './tokens.js';
export type { Scale, StyleTokens } from './tokens.js';
export { UnknownUtilityError } from './errors.js';
export { PAINT_PROPERTIES, partitionPaint, resolvePaintUtility } from './paint.js';
export type { PaintProps } from './paint.js';
export { LAYOUT_PROPERTIES, partitionLayout, resolveLayoutUtility } from './layout.js';
export type {
    AlignValue,
    Edge,
    JustifyValue,
    LayoutIntent,
    LayoutPartition,
    LayoutProps,
    OverlayIntent,
    WrapIntent,
} from './layout.js';
export { partition, resolveUtilities, resolveUtility } from './resolve.js';
export type { Partitioned, StyleProps } from './resolve.js';

export { StyleSheet, StyleSheetError, VARIANT_PSEUDO } from './sheet.js';
export type { StyleSheetOptions } from './sheet.js';
