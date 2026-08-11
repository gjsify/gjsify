/**
 * Native Canvas 2D globals for browser builds: the resolver routes
 * `@gjsify/canvas2d-core` here on `--app browser` because
 * `package.json#gjsify.runtimes.browser` is `"native"`. There is no Node counterpart —
 * `runtimes.node` is `"none"`, node-canvas being out of scope for the polyfill axis.
 */

export const CanvasRenderingContext2D = globalThis.CanvasRenderingContext2D;
export const CanvasGradient = globalThis.CanvasGradient;
export const CanvasPattern = globalThis.CanvasPattern;
export const Path2D = globalThis.Path2D;
export const ImageData = globalThis.ImageData;
