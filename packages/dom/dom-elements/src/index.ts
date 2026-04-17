// DOM element hierarchy for GJS — original implementation adapted from happy-dom
// Copyright (c) David Ortner (capricorn86). MIT license.
//
// Note: This module has no side effects. Importing it gives you the DOM
// classes as named exports but does NOT register `document`, `Image`,
// `HTMLCanvasElement` etc. on globalThis, and does NOT wire up the 2d
// canvas context factory.
//
// If you need the globals (or `canvas.getContext('2d')` to work), import
// `@gjsify/dom-elements/register` explicitly — or let the gjsify esbuild
// plugin auto-inject it based on references in your code.

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
export { HTMLMediaElement } from './html-media-element.js';
export { HTMLVideoElement } from './html-video-element.js';
export { Image } from './image.js';
export { Document, document } from './document.js';
export { MutationObserver } from './mutation-observer.js';
export { ResizeObserver } from './resize-observer.js';
export { IntersectionObserver } from './intersection-observer.js';
export { NodeType } from './node-type.js';
export { NamespaceURI } from './namespace-uri.js';
export * as PropertySymbol from './property-symbol.js';
export { FontFace, FontFaceSet } from './font-face.js';
export { MediaQueryList, matchMedia } from './match-media.js';
export { location } from './location-stub.js';
export { DOMMatrix, DOMMatrixReadOnly } from './dom-matrix.js';
