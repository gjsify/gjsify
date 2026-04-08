// Side-effect module: registers DOM globals on GJS and wires up the
// HTMLCanvasElement 2d context factory. Use this via
// `import '@gjsify/dom-elements/register'` before relying on
// `document`, `Image`, `new HTMLCanvasElement()`, or `canvas.getContext('2d')`.
//
// On Node.js the alias layer routes this subpath to @gjsify/empty because
// DOM elements are only meaningful in the GJS/GTK environment.

import { Text } from './text.js';
import { Comment } from './comment.js';
import { DocumentFragment } from './document-fragment.js';
import { DOMTokenList } from './dom-token-list.js';
import { HTMLCanvasElement } from './html-canvas-element.js';
import { HTMLImageElement } from './html-image-element.js';
import { Image } from './image.js';
import { document } from './document.js';
import { MutationObserver } from './mutation-observer.js';
import { ResizeObserver } from './resize-observer.js';
import { IntersectionObserver } from './intersection-observer.js';

Object.defineProperty(globalThis, 'Text', {
    value: Text,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'Comment', {
    value: Comment,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'DocumentFragment', {
    value: DocumentFragment,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'DOMTokenList', {
    value: DOMTokenList,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'HTMLCanvasElement', {
    value: HTMLCanvasElement,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'HTMLImageElement', {
    value: HTMLImageElement,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'Image', {
    value: Image,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'document', {
    value: document,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'MutationObserver', {
    value: MutationObserver,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserver,
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: IntersectionObserver,
    writable: true,
    configurable: true,
});

// Auto-register the '2d' context factory on HTMLCanvasElement.
// Mirrors browser behavior: canvas.getContext('2d') works without any explicit import.
// The factory is idempotent — re-registering from @gjsify/canvas2d has no effect.
import { CanvasRenderingContext2D } from '@gjsify/canvas2d-core';

const CANVAS2D_KEY = Symbol.for('gjsify_canvas2d_context');
HTMLCanvasElement.registerContextFactory('2d', (canvas, options) => {
    const existing = (canvas as any)[CANVAS2D_KEY];
    if (existing) return existing;
    const ctx = new CanvasRenderingContext2D(canvas as any, options);
    (canvas as any)[CANVAS2D_KEY] = ctx;
    return ctx;
});

Object.defineProperty(globalThis, 'CanvasRenderingContext2D', {
    value: CanvasRenderingContext2D,
    writable: true,
    configurable: true,
});

// self — three.js checks `typeof self !== 'undefined'` for animation context
if (typeof (globalThis as any).self === 'undefined') {
    Object.defineProperty(globalThis, 'self', { value: globalThis, writable: true, configurable: true });
}

// devicePixelRatio — defaults to 1 (no HiDPI scaling in GTK GL context)
if (typeof (globalThis as any).devicePixelRatio === 'undefined') {
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, writable: true, configurable: true });
}

// alert — stub redirecting to console.error (GTK dialog version can override via writable)
if (typeof (globalThis as any).alert === 'undefined') {
    Object.defineProperty(globalThis, 'alert', {
        value: (...args: any[]) => console.error('alert:', ...args),
        writable: true,
        configurable: true,
    });
}
