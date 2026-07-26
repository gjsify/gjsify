// Side-effect module: installs the Canvas 2D globals `@gjsify/canvas2d` owns
// on GJS. Imported by `--globals auto` (via `GJS_GLOBALS_MAP`) or explicitly:
//
//     import '@gjsify/canvas2d/register';
//
// Ownership split (see docs/adr/0012-framework-register-ownership.md):
//
//   - `HTMLCanvasElement`, `CanvasRenderingContext2D`, `DOMMatrix`,
//     `DOMMatrixReadOnly` and the `'2d'` context factory belong to the DOM
//     pillar and are installed by `@gjsify/dom-elements/register/canvas`. This
//     module IMPORTS that register instead of re-implementing it — a second
//     `HTMLCanvasElement.registerContextFactory('2d', …)` call would silently
//     replace the pillar's factory with a byte-identical copy (the duplicate
//     this module removes).
//   - `ImageData` and `Path2D` have no pillar register: `@gjsify/canvas2d-core`
//     declares `runtimes.browser: "native"` and ships a `globals.mjs`
//     re-export, so by design it never writes to `globalThis`. `@gjsify/canvas2d`
//     is the GJS-only distribution of those classes (`node`/`browser`/
//     `nativescript`: `"none"`) and therefore hosts their registration.

import '@gjsify/dom-elements/register/canvas';

import { ImageData, Path2D } from '@gjsify/canvas2d-core';

/**
 * Install a class on `globalThis` unless the host already provides it.
 *
 * Idempotent by construction — evaluating this module twice must not throw and
 * must not clobber a value another register already installed. `configurable`
 * keeps the slot replaceable (tests, a later explicit `installGlobals()`).
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
