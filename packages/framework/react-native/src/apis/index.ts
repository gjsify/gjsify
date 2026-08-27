// The imperative APIs, and the framework-free half of the two that are hooks.
//
// `useColorScheme` and `useWindowDimensions` are the two React hooks in the surface,
// so their GTK halves live here as plain functions (`currentColorScheme` /
// `onColorSchemeChange`, `windowMetrics` / `onWindowMetricsChange`) and the hooks
// themselves live in `hooks.ts` with the rest of L3. That split is the same one L2
// has: what needs GTK is testable without React, and what needs React is three lines
// over it — and it is what lets `Appearance` and `Dimensions`, the imperative
// siblings of those two hooks, share the reader rather than open a second one.

export { Alert } from './alert.js';
export type { AlertButton, AlertOptions } from './alert.js';
export { Appearance } from './appearance.js';
export type { AppearancePreferences } from './appearance.js';
export {
    currentColorScheme,
    onColorSchemeChange,
    requestedColorScheme,
    setColorSchemePreference,
} from './color-scheme.js';
export type { ColorSchemeName } from './color-scheme.js';
export { Dimensions } from './dimensions.js';
export type { DimensionKey, DimensionsPayload } from './dimensions.js';
export {
    hairlineWidth,
    onWindowMetricsChange,
    resetWindowMetricsCache,
    screenMetrics,
    windowMetrics,
    windowMetricsSnapshot,
} from './display.js';
export type { DisplayMetrics } from './display.js';
export { Keyboard } from './keyboard.js';
export { Linking } from './linking.js';
export { Platform, resetPlatformCache } from './platform.js';
export type { PlatformOS, PlatformSelectSpec } from './platform.js';
export { Share } from './share.js';
export type { ShareAction, ShareContent } from './share.js';
