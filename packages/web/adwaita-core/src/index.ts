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
// and the light/dark color-scheme observable. Step 2: the toast queue
// (one-at-a-time + auto-dismiss lifecycle) and the alert-dialog response model.
// Step 3: the row interaction state machines — expander disclosure, combo
// selection, spin clamp/step, toggle-group selection. Step 4: pure derivations
// ported straight from the libadwaita C source and held to per-input vectors
// that BOTH renderers assert against — see `@gjsify/adwaita-core/conformance`.

// --- Avatar derivation (Adw.Avatar initials + colour) ---
export {
    AVATAR_COLOR_COUNT,
    AVATAR_COLORS,
    avatarColor,
    avatarColorClass,
    avatarFontSize,
    avatarInitials,
    avatarMaxFontSize,
    avatarMode,
    flattenAvatarGradient,
    glibClamp,
    gStrHash,
    randomAvatarColorClass,
} from './avatar.js';
export type { AdwAvatarColor, AdwAvatarMode } from './avatar.js';

// --- Responsive breakpoints (Adw.Breakpoint / Adw.BreakpointCondition) ---
export { AdwBreakpoint, evaluateBreakpointCondition, parseBreakpointCondition } from './breakpoint.js';
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

// --- Toast queue (Adw.ToastOverlay / Adw.Toast) ---
export { AdwToast, AdwToastQueue, DEFAULT_TOAST_TIMEOUT } from './toast.js';
export type {
    AdwToastOptions,
    AdwToastQueueHandlers,
    AdwToastQueueOptions,
    ToastScheduler,
    ToastTimerHandle,
} from './toast.js';

// --- Alert-dialog response model (Adw.AlertDialog) ---
export { AdwAlertResponses } from './dialog.js';
export type { AdwAlertResponse, AdwResponseAppearance, AdwResponseOptions, OrderedConfirmResponses } from './dialog.js';

// --- Row interaction state machines (Adw.ExpanderRow/ComboRow/SpinRow/ToggleGroup) ---
export { ComboState, ExpanderState, SpinState, ToggleGroupState } from './rows.js';
export type {
    AdwComboOption,
    ComboStateChange,
    ComboStateListener,
    ExpanderStateListener,
    SpinStateChange,
    SpinStateListener,
    ToggleGroupStateChange,
    ToggleGroupStateListener,
} from './rows.js';
