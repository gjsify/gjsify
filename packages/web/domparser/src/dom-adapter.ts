// The `Adapter` for this package's own nodes — one of the two the engine serves
// (ADR 0026 § Decision 2); `@gjsify/dom-elements` supplies the other over its
// own `Element`.

import type { DOMElement } from './dom/element.js';
import type { DOMNode } from './dom/node.js';
import { ELEMENT_NODE } from './dom/node.js';
import type { Adapter } from './selectors/index.js';

function adapterFor(caseSensitive: boolean): Adapter<DOMNode> {
    return {
        caseSensitive,
        isTag: (node) => node.nodeType === ELEMENT_NODE,
        getName: (node) => (node as DOMElement).localName,
        getParent: (node) => node.parentNode,
        // A `<template>` keeps its children in `content`, never in `childNodes`,
        // which is the whole reason a selector does not reach into one.
        getChildren: (node) => node.childNodes,
        getSiblings: (node) => (node.parentNode === null ? [node] : node.parentNode.childNodes),
        getAttributeValue: (node, name) =>
            node.nodeType === ELEMENT_NODE ? (node as DOMElement).getAttribute(name) : null,
        getText: (node) => node.textContent,
    };
}

/** HTML folds type and attribute names to lowercase; XML does not. */
export const HTML_ADAPTER: Adapter<DOMNode> = adapterFor(false);
export const XML_ADAPTER: Adapter<DOMNode> = adapterFor(true);
