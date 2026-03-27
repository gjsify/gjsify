// DOM element hierarchy for GJS — original implementation adapted from happy-dom
// Copyright (c) David Ortner (capricorn86). MIT license.

export { Attr } from './attr.js';
export { NamedNodeMap } from './named-node-map.js';
export { NodeList } from './node-list.js';
export { Node } from './node.js';
export { Element } from './element.js';
export { HTMLElement, CSSStyleDeclaration } from './html-element.js';
export { HTMLCanvasElement } from './html-canvas-element.js';
export { HTMLImageElement } from './html-image-element.js';
export { Image } from './image.js';
export { NodeType } from './node-type.js';
export { NamespaceURI } from './namespace-uri.js';
export * as PropertySymbol from './property-symbol.js';

// Side-effect: register DOM globals on import.
// Same pattern as @gjsify/node-globals (packages/node/globals/src/index.ts)
// and @gjsify/web-globals (packages/web/web-globals/src/index.ts).
import { HTMLCanvasElement } from './html-canvas-element.js';
import { HTMLImageElement } from './html-image-element.js';
import { Image } from './image.js';

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
