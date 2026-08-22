// Tree back to markup — the inverse of the parser, and the half that decided to
// decode character references cannot be shipped without.
//
// Before HTML mode existed nothing was decoded: a text node held the source bytes
// `x &lt; y`, so echoing them back produced well-formed markup by accident.
// Decoding turned that node into `x < y`, and an echo then produced
// `<data>x < y</data>` — markup that reparses into a DIFFERENT tree, silently.
// Measured against `origin/main` on the frozen XML path, which
// `@excaliburjs/plugin-tiled` reads through `innerHTML` at four sites.
//
// https://html.spec.whatwg.org/multipage/parsing.html#serialising-html-fragments

import { RAWTEXT_ELEMENTS } from '../html/text-elements.js';
import { VOID_ELEMENTS } from '../html/void-elements.js';
import type { DOMElement } from './element.js';
import type { DOMNode } from './node.js';
import { CDATA_SECTION_NODE, COMMENT_NODE, DOCUMENT_TYPE_NODE, ELEMENT_NODE, TEXT_NODE } from './node.js';

// Spelled as an escape: a literal no-break space in source is invisible to review.
const NBSP = '\u00a0';

/**
 * The three characters that can forge markup, plus the no-break space HTML writes
 * as a named reference so it survives a transport that eats it.
 *
 * XML gets no `&nbsp;`: it is not one of the five predefined names, so emitting it
 * would produce a document no XML parser can read.
 */
function escapeText(value: string, html: boolean): string {
    const escaped = value.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
    return html ? escaped.split(NBSP).join('&nbsp;') : escaped;
}

/**
 * An attribute value is delimited by `"`, so `<` cannot end it and HTML leaves it
 * alone. XML escapes it anyway — and has to, because that is what the frozen XML
 * output did before decoding landed (`a="x&lt;y"` in, `a="x&lt;y"` out).
 */
function escapeAttribute(value: string, html: boolean): string {
    const escaped = value.split('&').join('&amp;').split('"').join('&quot;');
    return html ? escaped.split(NBSP).join('&nbsp;') : escaped.split('<').join('&lt;').split('>').join('&gt;');
}

function openTag(element: DOMElement, html: boolean): string {
    let out = '<' + element.localName;
    for (const attr of element.attributes) out += ' ' + attr.name + '="' + escapeAttribute(attr.value, html) + '"';
    return out;
}

/** A `<template>` serializes its CONTENT, which is where its children live. */
function childrenOf(node: DOMNode): DOMNode[] {
    const content = (node as { content?: DOMNode }).content;
    return content === undefined ? node.childNodes : content.childNodes;
}

/** True where the HTML serializer writes character data verbatim. */
function holdsRawText(node: DOMNode, html: boolean): boolean {
    return html && node.nodeType === ELEMENT_NODE && RAWTEXT_ELEMENTS.has((node as DOMElement).localName);
}

function serializeNode(node: DOMNode, html: boolean, rawText: boolean, out: string[]): void {
    switch (node.nodeType) {
        case TEXT_NODE:
            // Inside `<script>`/`<style>` the content is not markup, and escaping it
            // would change what a consumer reads back — `a < b` is an operator there.
            out.push(rawText ? (node.nodeValue ?? '') : escapeText(node.nodeValue ?? '', html));
            return;
        case CDATA_SECTION_NODE:
            out.push('<![CDATA[' + (node.nodeValue ?? '') + ']]>');
            return;
        case COMMENT_NODE:
            out.push('<!--' + (node.nodeValue ?? '') + '-->');
            return;
        case DOCUMENT_TYPE_NODE:
            out.push('<!DOCTYPE ' + node.nodeName + '>');
            return;
        case ELEMENT_NODE:
            break;
        default:
            // A document or a fragment: no tag of its own, only its children.
            serializeChildren(node, html, out);
            return;
    }

    const element = node as DOMElement;
    const name = element.localName;
    const kids = childrenOf(element);

    if (!html && kids.length === 0) {
        // The XML shape is FROZEN (ADR 0026 § Decision 4): an empty element was
        // `<name/>` before this file existed and stays `<name/>`.
        out.push(openTag(element, html) + '/>');
        return;
    }
    out.push(openTag(element, html) + '>');
    // `<br/>` is XHTML. In HTML the slash is ignored, so writing it says nothing
    // and reads as a mistake; the element simply has no end tag and no children.
    if (html && VOID_ELEMENTS.has(name)) return;

    const raw = holdsRawText(element, html);
    for (const child of kids) serializeNode(child, html, raw, out);
    out.push('</' + name + '>');
}

function serializeChildren(node: DOMNode, html: boolean, out: string[]): void {
    const raw = holdsRawText(node, html);
    for (const child of childrenOf(node)) serializeNode(child, html, raw, out);
}

/** `Element.innerHTML` — the children, not the element itself. */
export function serializeInner(node: DOMNode, html: boolean): string {
    const out: string[] = [];
    serializeChildren(node, html, out);
    return out.join('');
}

/** `Element.outerHTML` — the element and everything under it. */
export function serializeOuter(node: DOMNode, html: boolean): string {
    const out: string[] = [];
    serializeNode(node, html, false, out);
    return out.join('');
}
