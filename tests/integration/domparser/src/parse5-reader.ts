// A TreeReader over parse5's default tree, so `canonicalize` — the SAME function
// that serializes our tree — serializes the reference one too.
//
// Two canonicalizers would be two chances to agree on the same mistake, which is
// why this file describes parse5's node shapes and implements no formatting of
// its own (ADR 0026 § Decision 7).

import type { ReadAttribute, TreeReader } from '@gjsify/domparser';

/** The union of parse5's default-adapter node shapes, in the fields read here. */
export interface Parse5Node {
    nodeName: string;
    tagName?: string;
    name?: string;
    value?: string;
    data?: string;
    attrs?: { name: string; value: string }[];
    childNodes?: Parse5Node[];
    /** `<template>` only. */
    content?: Parse5Node;
}

export const parse5Reader: TreeReader<Parse5Node> = {
    isElement: (node) => typeof node.tagName === 'string',
    isText: (node) => node.nodeName === '#text',
    isComment: (node) => node.nodeName === '#comment',
    isDoctype: (node) => node.nodeName === '#documentType',
    name: (node) => {
        if (node.nodeName === '#documentType') return node.name ?? '';
        return typeof node.tagName === 'string' ? node.tagName : node.nodeName;
    },
    value: (node) => {
        if (node.nodeName === '#text') return node.value ?? '';
        if (node.nodeName === '#comment') return node.data ?? '';
        return '';
    },
    attributes: (node): ReadAttribute[] => (node.attrs ?? []).map((attr) => ({ name: attr.name, value: attr.value })),
    children: (node) => (node.content === undefined ? (node.childNodes ?? []) : [node.content]),
};
