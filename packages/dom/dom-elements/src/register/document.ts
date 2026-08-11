import { Comment } from '../comment.js';
import { document } from '../document.js';
import { DocumentFragment } from '../document-fragment.js';
import { DOMTokenList } from '../dom-token-list.js';
import { Text } from '../text.js';
import { defineGlobal, defineGlobalIfMissing } from './helpers.js';
import { installWindowEventBus, type WindowEventBusHost } from './window-event-bus.js';

defineGlobal('Text', Text);
defineGlobal('Comment', Comment);
defineGlobal('DocumentFragment', DocumentFragment);
defineGlobal('DOMTokenList', DOMTokenList);
defineGlobal('document', document);

// self — three.js checks `typeof self !== 'undefined'` for animation context
defineGlobalIfMissing('self', globalThis);

// window + Window exist to satisfy consumers branching on `x instanceof Window` (Excalibur's
// `_applyDisplayMode`). `window` is `globalThis`, so a plain empty class fails that check and the
// consumer falls into its element branch instead — for Excalibur, `ResizeObserver.observe(window)`
// then hits `e._onResize is not a function` in the `ex.Engine` constructor under the DEFAULT
// `DisplayMode.Fixed`. `Symbol.hasInstance` answers true for exactly the object registered as the
// window, without re-parenting `globalThis`'s prototype chain.
class Window {
    static [Symbol.hasInstance](value: unknown): boolean {
        return value === globalThis;
    }
}
defineGlobalIfMissing('Window', Window);
defineGlobalIfMissing('window', globalThis);

defineGlobalIfMissing('focus', () => {});
defineGlobalIfMissing('blur', () => {});

// Unconditional (idempotent) on purpose: the window-scope bus must be the gjsify singleton the
// GTK→DOM event bridge dispatches on. Bun/Deno ship a native `globalThis.addEventListener`, and an
// install-only-when-missing guard split the bus there — window listeners on the native target, the
// bridge dispatching into a never-installed one, keyboard dead. Rationale: ./window-event-bus.ts.
installWindowEventBus(globalThis as WindowEventBusHost);

// A widget-less default of 1, not a claim about the display: the ratio belongs to the surface a
// widget sits on and changes when a window moves between monitors. It is NOT 1 because GTK skips
// HiDPI scaling — GtkGLArea's framebuffer is allocation × scale-factor, and assuming otherwise
// made a scale-factor-3 phone render every WebGL showcase into the bottom-left ninth of its
// widget. `WebGLBridge.installGlobals()` overwrites this with a live accessor over the widget's
// `get_scale_factor()`; it uses `defineProperty`, so the bridge wins whichever runs first.
defineGlobalIfMissing('devicePixelRatio', 1);

// Always 0 in a GTK widget (no page scrolling), but they must exist: Excalibur's getPosition()
// does `rect.x + window.scrollX`, and `undefined` there NaNs every pointer coordinate.
defineGlobalIfMissing('scrollX', 0);
defineGlobalIfMissing('scrollY', 0);
defineGlobalIfMissing('pageXOffset', 0);
defineGlobalIfMissing('pageYOffset', 0);

defineGlobalIfMissing('alert', (...args: unknown[]) => console.error('alert:', ...args));

// `top` keeps Excalibur's iframe detection from crashing.
if (typeof (globalThis as unknown as { top?: unknown }).top === 'undefined') {
    Object.defineProperty(globalThis, 'top', {
        get: () => globalThis,
        configurable: true,
    });
}
