// iOS has no `Canvas2DBridge` driver yet: this variant refuses on purpose, so the platform split
// is a decision and not a silent fallback to `native-canvas.ts`. The message names Android.

export type { NativeCanvasDriver } from './native-driver.js';
export { createUnsupportedCanvasDriver as createNativeCanvasDriver } from './native-driver.js';
