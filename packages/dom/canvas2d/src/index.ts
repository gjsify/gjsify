// Canvas 2D rendering context for GJS, backed by Cairo
// Reimplemented for GJS using Cairo (built-in) and GdkPixbuf for pixel I/O.
// Reference: refs/node-canvas (Cairo + Pango Canvas 2D for Node.js)

export { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';
export { CanvasGradient } from './canvas-gradient.js';
export { CanvasPattern } from './canvas-pattern.js';
export { Path2D } from './canvas-path.js';
export { OurImageData as ImageData } from './image-data.js';
export { parseColor } from './color.js';

// Side-effect: register the '2d' context factory on HTMLCanvasElement.
// Same pattern as @gjsify/dom-elements registering globals on import.
import { HTMLCanvasElement as GjsifyHTMLCanvasElement } from '@gjsify/dom-elements';
import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';

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
import { OurImageData } from './image-data.js';
import { Path2D } from './canvas-path.js';

Object.defineProperty(globalThis, 'CanvasRenderingContext2D', {
    value: CanvasRenderingContext2D,
    writable: true,
    configurable: true,
});

Object.defineProperty(globalThis, 'ImageData', {
    value: OurImageData,
    writable: true,
    configurable: true,
});

Object.defineProperty(globalThis, 'Path2D', {
    value: Path2D,
    writable: true,
    configurable: true,
});
