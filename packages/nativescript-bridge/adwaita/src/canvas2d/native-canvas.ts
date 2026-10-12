// The native surface behind `Canvas2DBridge`, off Android.
//
// `native-canvas.android.ts` replaces this file on Android (`platformResolvePlugin` resolves the
// platform file first). Everywhere else there is no surface, and creating one says so.
// `native-canvas.ios.ts` exists because `nativescriptPlatforms` declares iOS and the build would
// otherwise fall back here without anyone having chosen to.

export type { NativeCanvasDriver } from './native-driver.js';
export { createUnsupportedCanvasDriver as createNativeCanvasDriver } from './native-driver.js';
