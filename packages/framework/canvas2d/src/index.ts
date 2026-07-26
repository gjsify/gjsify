// Canvas 2D rendering context for GJS, backed by Cairo
// Core classes live in @gjsify/canvas2d-core; this package adds Canvas2DBridge (GTK).
// Reimplemented for GJS using Cairo (built-in) and GdkPixbuf for pixel I/O.
//
// Barrel — named exports only, ZERO top-level side effects. The `globalThis`
// writes and the `'2d'` context-factory hookup live in `./register.ts`
// (`@gjsify/canvas2d/register`), injected automatically by `--globals auto`.

export {
    CanvasRenderingContext2D,
    CanvasGradient,
    CanvasPattern,
    Path2D,
    ImageData,
    parseColor,
} from '@gjsify/canvas2d-core';
export { Canvas2DBridge } from './canvas2d-bridge.js';
