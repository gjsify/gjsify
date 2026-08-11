import { CanvasRenderingContext2D } from '@gjsify/canvas2d-core';
// Side-effect import: canvas2d-core's root entry is headless by contract, so its pixel operations
// (`getImageData` / `putImageData` / `drawImage` / `createPattern`) run through an injected seam
// and this subpath is the GDK implementation that fills it. Wired here because a canvas created
// through the DOM pillar is by definition in a GTK process, and because dom-elements cannot reach
// `@gjsify/canvas2d` — that edge is the cycle canvas2d-core exists to break.
import '@gjsify/canvas2d-core/gdk';

import { HTMLCanvasElement } from '../html-canvas-element.js';
import { DOMMatrix, DOMMatrixReadOnly } from '../dom-matrix.js';
import { defineGlobal } from './helpers.js';

defineGlobal('HTMLCanvasElement', HTMLCanvasElement);
defineGlobal('CanvasRenderingContext2D', CanvasRenderingContext2D);
defineGlobal('DOMMatrix', DOMMatrix);
defineGlobal('DOMMatrixReadOnly', DOMMatrixReadOnly);

// The context is cached per canvas because the spec requires `canvas.getContext('2d')` to return
// the same object on every call.
const CANVAS2D_KEY = Symbol.for('gjsify_canvas2d_context');
type _CanvasWithCachedCtx = { [CANVAS2D_KEY]?: CanvasRenderingContext2D };

HTMLCanvasElement.registerContextFactory('2d', (canvas, options) => {
    const slot = canvas as unknown as _CanvasWithCachedCtx;
    const existing = slot[CANVAS2D_KEY];
    if (existing) return existing;
    // Boundary casts: the ctor declares its own structural canvas shape (which this
    // HTMLCanvasElement matches at runtime), and TS 6 infers the factory's `options` as `unknown`.
    const ctx = new CanvasRenderingContext2D(
        canvas as unknown as ConstructorParameters<typeof CanvasRenderingContext2D>[0],
        options as ConstructorParameters<typeof CanvasRenderingContext2D>[1],
    );
    slot[CANVAS2D_KEY] = ctx;
    return ctx;
});
