// Registers: HTMLCanvasElement, CanvasRenderingContext2D, DOMMatrix,
// DOMMatrixReadOnly + the '2d' context factory.

import { CanvasRenderingContext2D } from '@gjsify/canvas2d-core';

import { HTMLCanvasElement } from '../html-canvas-element.js';
import { DOMMatrix, DOMMatrixReadOnly } from '../dom-matrix.js';
import { defineGlobal } from './helpers.js';

defineGlobal('HTMLCanvasElement', HTMLCanvasElement);
defineGlobal('CanvasRenderingContext2D', CanvasRenderingContext2D);
defineGlobal('DOMMatrix', DOMMatrix);
defineGlobal('DOMMatrixReadOnly', DOMMatrixReadOnly);

// Register the '2d' context factory on HTMLCanvasElement.
//
// The factory caches the per-canvas context via a `Symbol.for` key so that
// `canvas.getContext('2d')` is idempotent per the spec. We hide the
// symbol-keyed slot behind a structural type instead of `as any`.
const CANVAS2D_KEY = Symbol.for('gjsify_canvas2d_context');
type _CanvasWithCachedCtx = { [CANVAS2D_KEY]?: CanvasRenderingContext2D };

HTMLCanvasElement.registerContextFactory('2d', (canvas, options) => {
    const slot = canvas as unknown as _CanvasWithCachedCtx;
    const existing = slot[CANVAS2D_KEY];
    if (existing) return existing;
    // CanvasRenderingContext2D's ctor accepts `HTMLCanvasElement` (its own
    // structural shape, which the GJS dom HTMLCanvasElement matches at
    // runtime). One `as unknown as` boundary cast — better than `as any`.
    const ctx = new CanvasRenderingContext2D(canvas as unknown as ConstructorParameters<typeof CanvasRenderingContext2D>[0], options);
    slot[CANVAS2D_KEY] = ctx;
    return ctx;
});
