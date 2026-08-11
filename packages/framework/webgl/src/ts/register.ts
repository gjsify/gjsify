// Side-effect module installing the WebGL globals `@gjsify/webgl` owns on GJS,
// reached by `--globals auto` (via `GJS_GLOBALS_MAP`) or by importing it directly.
//
// A FRAMEWORK package owns this registration per
// docs/adr/0012-framework-register-ownership.md rule 2: the only implementation of
// these two DOM-spec classes is the `gwebgl` Vala bridge driving a `Gtk.GLArea`
// context, so there is no headless counterpart the way `@gjsify/canvas2d-core` is
// one — and hosting them in `@gjsify/dom-elements` would make GTK 4 plus the
// `Gwebgl` typelib a hard dependency of every `document` / `Image` consumer.
//
// The `'webgl'` / `'webgl2'` context FACTORIES are not registered here: unlike the
// `'2d'` factory they come from this package's own `HTMLCanvasElement` subclass
// override in `html-canvas-element.ts`, reached through `WebGLBridge`.

import { WebGLRenderingContext } from './webgl-rendering-context.js';
import { WebGL2RenderingContext } from './webgl2-rendering-context.js';

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

defineGlobalIfMissing('WebGLRenderingContext', WebGLRenderingContext);
defineGlobalIfMissing('WebGL2RenderingContext', WebGL2RenderingContext);
