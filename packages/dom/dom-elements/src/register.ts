// Side-effect module: registers DOM globals on GJS and wires up the
// HTMLCanvasElement 2d context factory. Use this via
// `import '@gjsify/dom-elements/register'` before relying on
// `document`, `Image`, `new HTMLCanvasElement()`, or `canvas.getContext('2d')`.
//
// On Node.js the alias layer routes this subpath to @gjsify/empty because
// DOM elements are only meaningful in the GJS/GTK environment.

import { CanvasRenderingContext2D } from '@gjsify/canvas2d-core';
import { EventTarget as OurEventTarget } from '@gjsify/dom-events';

import { Comment } from './comment.js';
import { document } from './document.js';
import { FontFace, FontFaceSet } from './font-face.js';
import { matchMedia } from './match-media.js';
import { location } from './location-stub.js';
import { DocumentFragment } from './document-fragment.js';
import { DOMTokenList } from './dom-token-list.js';
import { HTMLCanvasElement } from './html-canvas-element.js';
import { HTMLImageElement } from './html-image-element.js';
import { Image } from './image.js';
import { IntersectionObserver } from './intersection-observer.js';
import { MutationObserver } from './mutation-observer.js';
import { ResizeObserver } from './resize-observer.js';
import { Text } from './text.js';
import { DOMMatrix, DOMMatrixReadOnly } from './dom-matrix.js';

/** Unconditionally expose a DOM class on `globalThis` (writable + configurable). */
function defineGlobal(name: string, value: unknown): void {
    Object.defineProperty(globalThis, name, {
        value,
        writable: true,
        configurable: true,
    });
}

/** Only set the global if it hasn't already been defined. */
function defineGlobalIfMissing(name: string, value: unknown): void {
    if (typeof (globalThis as any)[name] === 'undefined') {
        defineGlobal(name, value);
    }
}

defineGlobal('Text', Text);
defineGlobal('Comment', Comment);
defineGlobal('DocumentFragment', DocumentFragment);
defineGlobal('DOMTokenList', DOMTokenList);
defineGlobal('HTMLCanvasElement', HTMLCanvasElement);
defineGlobal('HTMLImageElement', HTMLImageElement);
defineGlobal('Image', Image);
defineGlobal('document', document);
defineGlobal('MutationObserver', MutationObserver);
defineGlobal('ResizeObserver', ResizeObserver);
defineGlobal('IntersectionObserver', IntersectionObserver);
defineGlobal('CanvasRenderingContext2D', CanvasRenderingContext2D);
defineGlobal('DOMMatrix', DOMMatrix);
defineGlobal('DOMMatrixReadOnly', DOMMatrixReadOnly);

// Register the '2d' context factory on HTMLCanvasElement.
// Mirrors browser behavior: canvas.getContext('2d') works without any explicit
// import. The factory is idempotent — re-registering from @gjsify/canvas2d has
// no effect.
const CANVAS2D_KEY = Symbol.for('gjsify_canvas2d_context');
HTMLCanvasElement.registerContextFactory('2d', (canvas, options) => {
    const existing = (canvas as any)[CANVAS2D_KEY];
    if (existing) return existing;
    const ctx = new CanvasRenderingContext2D(canvas as any, options);
    (canvas as any)[CANVAS2D_KEY] = ctx;
    return ctx;
});

// self — three.js checks `typeof self !== 'undefined'` for animation context
defineGlobalIfMissing('self', globalThis);

// window + Window — Excalibur's _applyDisplayMode uses `this.parent instanceof Window`
// and many other libraries reference `window` directly. We expose globalThis
// as `window`, and an empty Window class as a marker constructor so
// `instanceof Window` evaluates correctly (always false for non-window parents,
// which is what we want for canvas-embedded Excalibur).
class Window {}
defineGlobalIfMissing('Window', Window);
defineGlobalIfMissing('window', globalThis);

// window.focus() / window.blur() stubs — Excalibur's Keyboard.init() calls
// global.focus() when grabWindowFocus is set. No focus concept in GJS.
defineGlobalIfMissing('focus', () => {});
defineGlobalIfMissing('blur', () => {});

// globalThis.addEventListener / removeEventListener / dispatchEvent —
// Excalibur's Keyboard.init() attaches keydown/keyup/blur listeners to the
// global object (window). We back globalThis with a real EventTarget so these
// registrations actually work. The GTK event-bridge then dispatches keyboard
// events on BOTH the canvas element AND this global target, matching the
// browser model where keydown/keyup bubble to window.
//
// We expose the backing EventTarget as __gjsify_globalEventTarget so the
// event-bridge can dispatch on it without going through the (potentially
// already-set) globalThis.dispatchEvent which may be a native no-op.
if (typeof (globalThis as any).addEventListener !== 'function') {
    const _globalEventTarget = new OurEventTarget();
    (globalThis as any).__gjsify_globalEventTarget = _globalEventTarget;
    (globalThis as any).addEventListener = (type: string, listener: any, options?: any) =>
        _globalEventTarget.addEventListener(type, listener, options);
    (globalThis as any).removeEventListener = (type: string, listener: any, options?: any) =>
        _globalEventTarget.removeEventListener(type, listener, options);
    (globalThis as any).dispatchEvent = (event: Event) =>
        _globalEventTarget.dispatchEvent(event as any);
}

// devicePixelRatio — defaults to 1 (no HiDPI scaling in GTK GL context)
defineGlobalIfMissing('devicePixelRatio', 1);

// alert — stub redirecting to console.error (GTK dialog version can override via writable)
defineGlobalIfMissing('alert', (...args: unknown[]) => console.error('alert:', ...args));

// FontFace + document.fonts — used by Excalibur and other canvas libraries for custom fonts
defineGlobalIfMissing('FontFace', FontFace);
if (typeof (globalThis as any).FontFace === 'undefined') {
    (globalThis as any).FontFace = FontFace;
}
// Patch document.fonts stub onto the existing document object
const _doc = (globalThis as any).document;
if (_doc && typeof _doc.fonts === 'undefined') {
    Object.defineProperty(_doc, 'fonts', {
        value: new FontFaceSet(),
        configurable: true,
        writable: true,
    });
}

// matchMedia — used by Excalibur to monitor devicePixelRatio changes
defineGlobalIfMissing('matchMedia', matchMedia);

// window.location stub — provides file:// origin for GJS apps
defineGlobalIfMissing('location', location);

// window.top — prevents Excalibur's iframe detection from crashing
// Excalibur checks `window !== window.top`; setting top = globalThis avoids the iframe path.
if (typeof (globalThis as any).top === 'undefined') {
    Object.defineProperty(globalThis, 'top', {
        get: () => globalThis,
        configurable: true,
    });
}

// navigator stub — provides base navigator object for GJS
// Gamepad support (navigator.getGamepads) is provided by @gjsify/gamepad/register
if (typeof (globalThis as any).navigator === 'undefined') {
    (globalThis as any).navigator = {};
}
