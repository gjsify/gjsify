// iOS has no `Canvas2DBridge` driver yet: this variant refuses on purpose, so the platform split
// is a decision and not a silent fallback to `native-canvas.ts`. The message names Android.
// A declaration, not an alias re-export, for the reason `native-canvas.ts` gives.

import { createUnsupportedCanvasDriver, type NativeCanvasDriver } from './native-driver.js';

export type { NativeCanvasDriver } from './native-driver.js';

export function createNativeCanvasDriver(): NativeCanvasDriver {
    return createUnsupportedCanvasDriver();
}
