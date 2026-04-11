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
const CANVAS2D_KEY = Symbol.for('gjsify_canvas2d_context');
HTMLCanvasElement.registerContextFactory('2d', (canvas, options) => {
    const existing = (canvas as any)[CANVAS2D_KEY];
    if (existing) return existing;
    const ctx = new CanvasRenderingContext2D(canvas as any, options);
    (canvas as any)[CANVAS2D_KEY] = ctx;
    return ctx;
});
