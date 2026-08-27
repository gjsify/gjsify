// The four P1 APIs, and the framework-free half of the fifth.
//
// `useColorScheme` is the only one of them that is a React hook, so its GTK half
// lives here as two plain functions (`currentColorScheme`, `onColorSchemeChange`)
// and the hook itself lives in `hooks.ts` with the rest of L3. That split is the
// same one L2 has: what needs GTK is testable without React, and what needs React
// is three lines over it.

export { currentColorScheme, onColorSchemeChange } from './color-scheme.js';
export type { ColorSchemeName } from './color-scheme.js';
export { Linking } from './linking.js';
export { Platform, resetPlatformCache } from './platform.js';
export type { PlatformOS, PlatformSelectSpec } from './platform.js';
export { Share } from './share.js';
export type { ShareAction, ShareContent } from './share.js';
