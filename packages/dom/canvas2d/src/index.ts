// Canvas 2D rendering context for GJS, backed by Cairo
// Core classes live in @gjsify/canvas2d-core; this package adds Canvas2DBridge (GTK).
// Reimplemented for GJS using Cairo (built-in) and GdkPixbuf for pixel I/O.

export { CanvasRenderingContext2D, CanvasGradient, CanvasPattern, Path2D, ImageData, parseColor } from '@gjsify/canvas2d-core';
export { Canvas2DBridge } from './canvas2d-bridge.js';

// Side-effect: register the '2d' context factory on HTMLCanvasElement.
// This is idempotent — @gjsify/dom-elements also registers it via canvas2d-core.
// Kept here so that importing @gjsify/canvas2d directly also works (backward compat).
import { HTMLCanvasElement as GjsifyHTMLCanvasElement } from '@gjsify/dom-elements';
import { CanvasRenderingContext2D, ImageData, Path2D } from '@gjsify/canvas2d-core';

const CONTEXT_KEY = Symbol.for('gjsify_canvas2d_context');

GjsifyHTMLCanvasElement.registerContextFactory('2d', (canvas: any, options?: any) => {
    // Per spec: once a context type is obtained, subsequent calls return the same instance
    const existing = (canvas as any)[CONTEXT_KEY];
    if (existing) return existing;
    const ctx = new CanvasRenderingContext2D(canvas, options);
    (canvas as any)[CONTEXT_KEY] = ctx;
    return ctx;
});

// Register globals
Object.defineProperty(globalThis, 'CanvasRenderingContext2D', {
    value: CanvasRenderingContext2D,
    writable: true,
    configurable: true,
});

Object.defineProperty(globalThis, 'ImageData', {
    value: ImageData,
    writable: true,
    configurable: true,
});

Object.defineProperty(globalThis, 'Path2D', {
    value: Path2D,
    writable: true,
    configurable: true,
});
