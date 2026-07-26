// Side-effect module: installs the WebGL globals `@gjsify/webgl` owns on GJS.
// Imported by `--globals auto` (via `GJS_GLOBALS_MAP`) or explicitly:
//
//     import '@gjsify/webgl/register';
//
// Why a framework package owns this registration (see
// docs/adr/0012-framework-register-ownership.md, decision rule 2 — "a framework
// package MAY ship a `/register` for globals whose implementation it owns […]
// and which no Web/DOM pillar package can host without taking a GTK dependency
// the pillar must not have"):
//
//   - `WebGLRenderingContext` and `WebGL2RenderingContext` are DOM-spec classes,
//     but their only implementation here is the `gwebgl` Vala bridge
//     (`gi://Gwebgl?version=0.1`) driving a `Gtk.GLArea` GL context. There is no
//     headless counterpart to `@gjsify/canvas2d-core` — the GL context does not
//     exist without a realised GTK widget.
//   - Hosting them (or merely their registration) in `@gjsify/dom-elements` would
//     make GTK 4 + the `Gwebgl` typelib a hard dependency of every `document` /
//     `Image` / canvas consumer, which the DOM pillar must not have. Same
//     reasoning as `@gjsify/iframe`'s WebKit dependency.
//   - `@gjsify/webgl` is the only GJS-slot distribution of these classes
//     (`node` / `browser` / `nativescript`: `"none"`), so a `globalThis` write
//     here is unambiguously correct.
//
// Installing it here (rather than at barrel-import time, as before) makes the
// registration tree-shakeable, opt-out-able, and — because both identifiers are
// now mapped in `GJS_GLOBALS_MAP` — reachable by `--globals auto`.
//
// NOTE: the `'webgl'` / `'webgl2'` context factories are NOT registered here.
// Unlike the `'2d'` factory (a `HTMLCanvasElement.registerContextFactory` entry),
// they are provided by this package's own `HTMLCanvasElement` subclass override
// in `html-canvas-element.ts`, which a consumer reaches through `WebGLBridge`.

import { WebGLRenderingContext } from './webgl-rendering-context.js';
import { WebGL2RenderingContext } from './webgl2-rendering-context.js';

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

defineGlobalIfMissing('WebGLRenderingContext', WebGLRenderingContext);
defineGlobalIfMissing('WebGL2RenderingContext', WebGL2RenderingContext);
