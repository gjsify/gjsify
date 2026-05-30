/**
 * Re-exports native Canvas 2D globals for browser builds.
 *
 * On any browser these classes are part of the global Canvas API. The
 * resolver routes `@gjsify/canvas2d-core` here on `--app browser` because
 * `package.json#gjsify.runtimes.browser === "native"`.
 *
 * NOT used on Node (`runtimes.node` is `"none"` — node-canvas is out of
 * scope for the polyfill axis).
 */

export const CanvasRenderingContext2D = globalThis.CanvasRenderingContext2D;
export const CanvasGradient = globalThis.CanvasGradient;
export const CanvasPattern = globalThis.CanvasPattern;
export const Path2D = globalThis.Path2D;
export const ImageData = globalThis.ImageData;
