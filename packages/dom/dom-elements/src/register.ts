// Side-effect module: registers DOM globals on GJS and wires up the
// HTMLCanvasElement 2d context factory. Use this via
// `import '@gjsify/dom-elements/register'` before relying on
// `document`, `Image`, `new HTMLCanvasElement()`, or `canvas.getContext('2d')`.
//
// On Node.js the alias layer routes this subpath to @gjsify/empty because
// DOM elements are only meaningful in the GJS/GTK environment.

import { CanvasRenderingContext2D } from '@gjsify/canvas2d-core';

import { Comment } from './comment.js';
import { document } from './document.js';
import { DocumentFragment } from './document-fragment.js';
import { DOMTokenList } from './dom-token-list.js';
import { HTMLCanvasElement } from './html-canvas-element.js';
import { HTMLImageElement } from './html-image-element.js';
import { Image } from './image.js';
import { IntersectionObserver } from './intersection-observer.js';
import { MutationObserver } from './mutation-observer.js';
import { ResizeObserver } from './resize-observer.js';
import { Text } from './text.js';

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

// devicePixelRatio — defaults to 1 (no HiDPI scaling in GTK GL context)
defineGlobalIfMissing('devicePixelRatio', 1);

// alert — stub redirecting to console.error (GTK dialog version can override via writable)
defineGlobalIfMissing('alert', (...args: unknown[]) => console.error('alert:', ...args));
