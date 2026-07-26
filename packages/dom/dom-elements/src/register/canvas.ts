// Registers: HTMLCanvasElement, CanvasRenderingContext2D, DOMMatrix,
// DOMMatrixReadOnly + the '2d' context factory.

import { CanvasRenderingContext2D } from '@gjsify/canvas2d-core';
// `@gjsify/canvas2d-core`'s root entry is HEADLESS by contract (no GTK), so it
// ships the Cairo⇄pixel-buffer interop that `getImageData` / `putImageData` /
// `drawImage` / `createPattern` need behind an injected seam. This subpath is
// the GDK-backed implementation; importing it registers the bridge. We wire it
// here — in the module that registers the '2d' factory — because a canvas
// created through the DOM pillar is by definition running in a GTK process,
// and because `@gjsify/dom-elements` cannot reach `@gjsify/canvas2d` (that
// edge is the cycle `@gjsify/canvas2d-core` was extracted to break).
import '@gjsify/canvas2d-core/gdk';

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
    const ctx = new CanvasRenderingContext2D(
        canvas as unknown as ConstructorParameters<typeof CanvasRenderingContext2D>[0],
        // TS 6 infers the factory's `options` param as `unknown`; cast to the
        // ctor's optional second parameter (the same boundary-cast shape as
        // `canvas` above).
        options as ConstructorParameters<typeof CanvasRenderingContext2D>[1],
    );
    slot[CANVAS2D_KEY] = ctx;
    return ctx;
});
