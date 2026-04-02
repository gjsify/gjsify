// DOM element hierarchy for GJS — original implementation adapted from happy-dom
// Copyright (c) David Ortner (capricorn86). MIT license.

export { Attr } from './attr.js';
export { NamedNodeMap } from './named-node-map.js';
export { NodeList } from './node-list.js';
export { Node } from './node.js';
export { CharacterData } from './character-data.js';
export { Text } from './text.js';
export { Comment } from './comment.js';
export { DocumentFragment } from './document-fragment.js';
export { DOMTokenList } from './dom-token-list.js';
export { Element } from './element.js';
export { HTMLElement, CSSStyleDeclaration } from './html-element.js';
export { HTMLCanvasElement } from './html-canvas-element.js';
export { HTMLImageElement } from './html-image-element.js';
export { Image } from './image.js';
export { Document, document } from './document.js';
export { MutationObserver } from './mutation-observer.js';
export { ResizeObserver } from './resize-observer.js';
export { IntersectionObserver } from './intersection-observer.js';
export { NodeType } from './node-type.js';
export { NamespaceURI } from './namespace-uri.js';
export * as PropertySymbol from './property-symbol.js';

// Side-effect: register DOM globals on import.
// Same pattern as @gjsify/node-globals (packages/node/globals/src/index.ts)
// and @gjsify/web-globals (packages/web/web-globals/src/index.ts).
import '@gjsify/abort-controller'; // registers globalThis.AbortController + AbortSignal
import '@gjsify/fetch'; // registers globalThis.fetch, Request, Response, Headers
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
