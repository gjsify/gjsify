// @gjsify/adwaita-core — headless Adwaita widget behavior (ADR 0004).
//
// Renderer-agnostic logic shared by the Adwaita design-identity renderers
// (`@gjsify/adwaita-web`, `@gjsify/adwaita-nativescript`; GTK stays native
// Libadwaita). Pure TS: NO platform imports (no `gi://`, no `@girs/*`, no
// `@nativescript/core`, no DOM assumptions), no `/register` subpath, no
// `globalThis` writes — pure named exports only. Follows the
// `@gjsify/storybook-core` seam pattern: behavior lives here once, renderers
// stay thin adapters.
//
// Seed modules (implementation step 1): breakpoint condition grammar/parser/
// evaluator + the transition-only `AdwBreakpoint` apply/unapply state machine,
// and the light/dark color-scheme observable. Toast queue, dialog response
// model and row state machines follow in later PRs.

// --- Responsive breakpoints (Adw.Breakpoint / Adw.BreakpointCondition) ---
export {
    AdwBreakpoint,
    evaluateBreakpointCondition,
    parseBreakpointCondition,
} from './breakpoint.js';
export type {
    AdwBreakpointHandlers,
    BreakpointBound,
    BreakpointConditionGroup,
    BreakpointConditionLeaf,
    BreakpointConditionNode,
    BreakpointDimension,
    BreakpointSize,
} from './breakpoint.js';

// --- Color scheme (light/dark) ---
export {
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    adwaitaColorScheme,
    isThemeIconColor,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    themeIconColor,
    toggleAdwaitaColorScheme,
} from './color-scheme.js';
export type { AdwColorScheme } from './color-scheme.js';
