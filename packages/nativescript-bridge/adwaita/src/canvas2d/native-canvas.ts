// The native surface behind `Canvas2DBridge`, off Android.
//
// `native-canvas.android.ts` replaces this file on Android (`platformResolvePlugin` resolves the
// platform file first). Everywhere else there is no surface, and creating one says so.
// `native-canvas.ios.ts` exists because `nativescriptPlatforms` declares iOS and the build would
// otherwise fall back here without anyone having chosen to.
//
// A DECLARATION, NOT AN ALIAS RE-EXPORT. The library build resolves `export { a as b } from`
// through to `a`'s own module, so the bridge imported `native-driver.js` directly and kept this
// file only as a bare side-effect import: a consumer bundle then had no platform file to swap in
// and shipped the refusal on Android.

import { createUnsupportedCanvasDriver, type NativeCanvasDriver } from './native-driver.js';

export type { NativeCanvasDriver } from './native-driver.js';

export function createNativeCanvasDriver(): NativeCanvasDriver {
    return createUnsupportedCanvasDriver();
}
