// Side-effect module installing the Canvas 2D globals `@gjsify/canvas2d` owns on GJS,
// reached by `--globals auto` (via `GJS_GLOBALS_MAP`) or by importing it directly.
//
// Ownership split per docs/adr/0012-framework-register-ownership.md: the canvas
// element, its 2D context, the DOMMatrix classes and the `'2d'` factory belong to
// the DOM pillar, so this module IMPORTS `@gjsify/dom-elements/register/canvas`
// rather than re-registering them — a second `registerContextFactory('2d', …)`
// would silently replace the pillar's factory with a byte-identical copy.
// `ImageData` and `Path2D` have no pillar register (`@gjsify/canvas2d-core` is
// `browser: "native"` and never writes to `globalThis`), so this GJS-only
// distribution hosts them.

import '@gjsify/dom-elements/register/canvas';

import { ImageData, Path2D } from '@gjsify/canvas2d-core';

/**
 * Install a class on `globalThis` unless the host already provides it. Idempotent by
 * construction, so evaluating this module twice neither throws nor clobbers what another
 * register installed; `configurable` keeps the slot replaceable by a later
 * `installGlobals()` or a test.
 */
function defineGlobalIfMissing(name: string, value: unknown): void {
    if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
        Object.defineProperty(globalThis, name, {
            value,
            writable: true,
            configurable: true,
        });
    }
}

defineGlobalIfMissing('ImageData', ImageData);
defineGlobalIfMissing('Path2D', Path2D);
