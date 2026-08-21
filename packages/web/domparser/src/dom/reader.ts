// A TreeReader over this package's own nodes, so `canonicalize` can serialize a
// document it never has to know the classes of.

import type { ReadAttribute, TreeReader } from '../canonical.js';
import { DOMElement } from './element.js';
import { CDATA_SECTION_NODE, COMMENT_NODE, DOCUMENT_TYPE_NODE, DOMNode, ELEMENT_NODE, TEXT_NODE } from './node.js';

/** `<template>` keeps its children in a fragment, the shape the HTML spec gives it. */
interface WithContent {
    content?: DOMNode;
}

export const domTreeReader: TreeReader<DOMNode> = {
    isElement: (node) => node.nodeType === ELEMENT_NODE,
    isText: (node) => node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE,
    isComment: (node) => node.nodeType === COMMENT_NODE,
    isDoctype: (node) => node.nodeType === DOCUMENT_TYPE_NODE,
    name: (node) => (node.nodeType === ELEMENT_NODE ? (node as DOMElement).localName : node.nodeName),
    value: (node) => node.nodeValue ?? '',
    attributes: (node): ReadAttribute[] => (node.nodeType === ELEMENT_NODE ? (node as DOMElement).attributes : []),
    children: (node) => {
        const content = (node as WithContent).content;
        return content === undefined ? node.childNodes : [content];
    },
};
