import { DOCUMENT_FRAGMENT_NODE, DOMNode } from './node.js';

/**
 * A parentless container. Its only use today is `<template>`: the spec puts a
 * template's children in a fragment held by `content`, NOT in `childNodes`, which
 * is exactly why `querySelectorAll` does not reach into a template.
 */
export class DOMDocumentFragment extends DOMNode {
    constructor() {
        super(DOCUMENT_FRAGMENT_NODE, '#document-fragment');
    }
}
