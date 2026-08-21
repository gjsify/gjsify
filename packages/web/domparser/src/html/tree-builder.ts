// The HTML tree builder: the sink half of the parser.
//
// It implements the insertion modes a real page depends on — implicit
// html/head/body, the implied-end-tag table, the void set, table sections,
// `<template>` content, EOF auto-close — and deliberately NOT the adoption agency
// algorithm, the active formatting elements list or foster parenting (ADR 0026
// § 6). The differential suite in tests/integration/domparser measures where that
// boundary actually lies against parse5 instead of leaving it a claim.
//
// https://html.spec.whatwg.org/multipage/parsing.html#tree-construction

import { DOMComment } from '../dom/comment.js';
import { DOMDocument } from '../dom/document.js';
import { DOMDocumentType } from '../dom/doctype.js';
import { DOMElement } from '../dom/element.js';
import { DOMDocumentFragment } from '../dom/fragment.js';
import type { DOMNode } from '../dom/node.js';
import { TEXT_NODE } from '../dom/node.js';
import { DOMText } from '../dom/text.js';
import {
    BUTTON_SCOPE,
    CLOSES_PARAGRAPH,
    DEFAULT_SCOPE,
    HEAD_ELEMENTS,
    HEADINGS,
    IN_HEAD_NOSCRIPT,
    IMPLIED_END_TAGS,
    LIST_ITEM_SCOPE,
    SPECIAL_ELEMENTS,
    TABLE_CELLS,
    TABLE_SCOPE,
    TABLE_SECTIONS,
} from './implied-end-tags.js';
import { RAWTEXT_ELEMENTS, RCDATA_ELEMENTS, tokenize } from './tokenizer.js';
import type { DoctypeToken, TokenAttribute, TreeSink } from './tree-sink.js';
import { VOID_ELEMENTS } from './void-elements.js';

const MODE_INITIAL = 0;
const MODE_BEFORE_HTML = 1;
const MODE_BEFORE_HEAD = 2;
const MODE_IN_HEAD = 3;
const MODE_AFTER_HEAD = 4;
const MODE_IN_BODY = 5;
const MODE_AFTER_BODY = 6;
const MODE_AFTER_AFTER_BODY = 7;

// Computed, never written as a literal: a U+0000 escape in a source file becomes
// a RAW NUL through the GJS minifier, which reads it as the end of the script.
const NUL = String.fromCharCode(0);

/** Where a table structure element may be inserted, per the mode it belongs to. */
const TABLE_CONTEXT: ReadonlySet<string> = new Set(['table', 'template', 'html']);
const TABLE_BODY_CONTEXT: ReadonlySet<string> = new Set(['tbody', 'tfoot', 'thead', 'table', 'template', 'html']);
const TABLE_ROW_CONTEXT: ReadonlySet<string> = new Set(['tr', 'tbody', 'tfoot', 'thead', 'table', 'template', 'html']);

/**
 * Table structure start tags. Outside a table they are IGNORED rather than
 * inserted — the spec's "in body" rule, and the difference between a stray
 * `<td>` disappearing (what a browser does) and it becoming a sibling of the
 * paragraph it was written in.
 */
const TABLE_STRUCTURE: ReadonlySet<string> = new Set([
    'caption',
    'col',
    'colgroup',
    'frame',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
]);

/**
 * End tags closed by scope rather than by the generic "any other end tag" walk.
 * The two disagree, and the disagreement is observable: `<ul><li><div>x</li>` has
 * a `div` between the `</li>` and its `li`, so the generic walk — which stops at
 * the first special element — would drop the end tag on the floor.
 */
const SCOPED_END_TAGS: ReadonlySet<string> = new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'button',
    'caption',
    'center',
    'colgroup',
    'dd',
    'details',
    'dialog',
    'dir',
    'div',
    'dl',
    'dt',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'header',
    'hgroup',
    'li',
    'listing',
    'main',
    'menu',
    'nav',
    'ol',
    'pre',
    'search',
    'section',
    'summary',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
]);

/** The subset of SCOPED_END_TAGS whose scope is the TABLE one. */
const SCOPED_TABLE_END_TAGS: ReadonlySet<string> = new Set([
    'caption',
    'colgroup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
]);

/** Elements that swallow a line feed immediately after their start tag. */
const SKIPS_LEADING_NEWLINE: ReadonlySet<string> = new Set(['listing', 'pre', 'textarea']);

function isWhitespace(c: string): boolean {
    return c === ' ' || c === '\n' || c === '\t' || c === '\f' || c === '\r';
}

function leadingWhitespaceLength(text: string): number {
    let i = 0;
    while (i < text.length && isWhitespace(text[i])) i++;
    return i;
}

class TreeBuilder implements TreeSink {
    readonly document = new DOMDocument(true);
    /** Quirks mode. Its only observable here is whether `<table>` closes an open
     *  `<p>`, which is exactly the spec's rule. */
    private quirks = false;
    private readonly open: DOMElement[] = [];
    private mode = MODE_INITIAL;
    private htmlElement: DOMElement | null = null;
    private headElement: DOMElement | null = null;
    private bodyElement: DOMElement | null = null;
    private skipLineFeed = false;
    /**
     * The spec's "text" insertion mode. A raw-text or RCDATA element takes the
     * character tokens that follow it WHATEVER mode we were in — without this,
     * `<style>` inserted in the head has its own body pushed into `<body>`,
     * because the in-head rules read the first non-whitespace character as the
     * end of the head.
     */
    private textElement: DOMElement | null = null;

    // --- insertion -------------------------------------------------------

    private get current(): DOMNode {
        const top = this.open[this.open.length - 1];
        if (top === undefined) return this.document;
        return top.content ?? top;
    }

    /**
     * The spec's "in template" insertion mode, in the only form this parser needs:
     * while a template is open, its content is built as if we were in the body,
     * whatever mode the document itself is in. Without it a `<template>` in the
     * head ends the head at its first child and the content lands in `<body>`.
     */
    private get inTemplate(): boolean {
        for (let i = this.open.length - 1; i >= 0; i--) {
            if (this.open[i].localName === 'template') return true;
        }
        return false;
    }

    private currentName(): string {
        const top = this.open[this.open.length - 1];
        return top === undefined ? '' : top.localName;
    }

    private append(parent: DOMNode, node: DOMNode): void {
        node.parentNode = parent;
        parent.childNodes.push(node);
    }

    /** Adjacent character runs are ONE text node. The tokenizer ends a run at
     *  every markup boundary it rejects, and a tree with two adjacent text nodes
     *  where a browser has one is a different tree. */
    private insertText(text: string): void {
        if (text === '') return;
        const parent = this.current;
        const last = parent.childNodes[parent.childNodes.length - 1];
        if (last !== undefined && last.nodeType === TEXT_NODE) {
            last.nodeValue = (last.nodeValue ?? '') + text;
            return;
        }
        this.append(parent, new DOMText(text));
    }

    private createElement(name: string, attrs: TokenAttribute[]): DOMElement {
        const el = new DOMElement(name, true);
        for (const attr of attrs) el.setAttribute(attr.name, attr.value);
        return el;
    }

    /** Insert and leave open. */
    private insertElement(name: string, attrs: TokenAttribute[]): DOMElement {
        const el = this.createElement(name, attrs);
        this.append(this.current, el);
        // A template's children live in `content`, never in `childNodes` — which
        // is precisely why `querySelectorAll` does not reach into one.
        if (name === 'template') el.content = new DOMDocumentFragment();
        this.open.push(el);
        if (SKIPS_LEADING_NEWLINE.has(name)) this.skipLineFeed = true;
        if (RAWTEXT_ELEMENTS.has(name) || RCDATA_ELEMENTS.has(name)) this.textElement = el;
        return el;
    }

    /** Insert and close immediately: a void element has no content to hold. */
    private insertVoid(name: string, attrs: TokenAttribute[]): void {
        this.append(this.current, this.createElement(name, attrs));
    }

    private insertGeneric(name: string, attrs: TokenAttribute[]): void {
        if (VOID_ELEMENTS.has(name)) this.insertVoid(name, attrs);
        else this.insertElement(name, attrs);
    }

    /** A repeated `<html>` or `<body>` contributes only the attributes the element
     *  does not already have. */
    private mergeAttributes(el: DOMElement | null, attrs: TokenAttribute[]): void {
        if (el === null) return;
        for (const attr of attrs) {
            if (!el.hasAttribute(attr.name)) el.setAttribute(attr.name, attr.value);
        }
    }

    // --- the stack -------------------------------------------------------

    private hasInScope(name: string, scope: ReadonlySet<string>): boolean {
        for (let i = this.open.length - 1; i >= 0; i--) {
            const node = this.open[i].localName;
            if (node === name) return true;
            if (scope.has(node)) return false;
        }
        return false;
    }

    private generateImpliedEndTags(exclude?: string): void {
        while (this.open.length > 0) {
            const name = this.currentName();
            if (name === exclude || !IMPLIED_END_TAGS.has(name)) break;
            this.open.pop();
        }
    }

    private popUntil(name: string): void {
        while (this.open.length > 0) {
            if (this.open.pop()?.localName === name) break;
        }
    }

    private clearBackTo(stops: ReadonlySet<string>): void {
        while (this.open.length > 0 && !stops.has(this.currentName())) this.open.pop();
    }

    private closeParagraph(): void {
        if (!this.hasInScope('p', BUTTON_SCOPE)) return;
        this.generateImpliedEndTags('p');
        this.popUntil('p');
    }

    // --- implicit structure ----------------------------------------------

    private leaveInitial(): void {
        // No doctype reached us, so the document is in quirks mode — the spec's
        // "anything else" branch of the initial insertion mode.
        if (this.mode === MODE_INITIAL) this.quirks = true;
    }

    private ensureHtml(attrs: TokenAttribute[]): void {
        this.leaveInitial();
        if (this.htmlElement !== null) {
            this.mergeAttributes(this.htmlElement, attrs);
            return;
        }
        const el = this.createElement('html', attrs);
        this.append(this.document, el);
        this.document.documentElement = el;
        this.htmlElement = el;
        this.open.push(el);
        this.mode = MODE_BEFORE_HEAD;
    }

    private openHead(attrs: TokenAttribute[]): void {
        this.ensureHtml([]);
        const el = this.createElement('head', attrs);
        this.append(this.current, el);
        this.headElement = el;
        this.open.push(el);
        this.mode = MODE_IN_HEAD;
    }

    private popHead(): void {
        const head = this.headElement;
        if (head !== null) {
            const index = this.open.indexOf(head);
            if (index !== -1) this.open.splice(index, 1);
        }
        this.mode = MODE_AFTER_HEAD;
    }

    private openBody(attrs: TokenAttribute[]): void {
        const el = this.createElement('body', attrs);
        this.append(this.htmlElement ?? this.document, el);
        this.bodyElement = el;
        this.open.push(el);
        this.mode = MODE_IN_BODY;
    }

    // --- tokens ----------------------------------------------------------

    onDoctype(doctype: DoctypeToken): void {
        if (this.mode !== MODE_INITIAL) return;
        const name = doctype.name ?? '';
        this.quirks = doctype.forceQuirks || name !== 'html';
        this.append(this.document, new DOMDocumentType(name, doctype.publicId ?? '', doctype.systemId ?? ''));
        this.mode = MODE_BEFORE_HTML;
    }

    onComment(data: string): void {
        this.skipLineFeed = false;
        if (this.mode === MODE_INITIAL || this.mode === MODE_BEFORE_HTML || this.mode === MODE_AFTER_AFTER_BODY) {
            this.append(this.document, new DOMComment(data));
            return;
        }
        if (this.mode === MODE_AFTER_BODY) {
            this.append(this.htmlElement ?? this.document, new DOMComment(data));
            return;
        }
        this.append(this.current, new DOMComment(data));
    }

    onText(raw: string): void {
        // A NUL in the data state is a parse error and is dropped; the raw-text
        // and markup states already replaced theirs with U+FFFD in the tokenizer.
        let text = raw.indexOf(NUL) === -1 ? raw : raw.split(NUL).join('');
        if (this.skipLineFeed) {
            this.skipLineFeed = false;
            if (text.startsWith('\n')) text = text.slice(1);
        }
        if (text === '') return;
        if (this.textElement !== null || this.inTemplate) {
            this.insertText(text);
            return;
        }

        switch (this.mode) {
            case MODE_INITIAL:
            case MODE_BEFORE_HTML:
            case MODE_BEFORE_HEAD: {
                // Whitespace before the document starts is dropped, not inserted.
                const rest = text.slice(leadingWhitespaceLength(text));
                if (rest === '') return;
                this.openHead([]);
                this.onText(rest);
                return;
            }
            case MODE_IN_HEAD:
            case MODE_AFTER_HEAD: {
                const ws = leadingWhitespaceLength(text);
                if (ws > 0) this.insertText(text.slice(0, ws));
                const rest = text.slice(ws);
                if (rest === '') return;
                // Content leaves an in-head `<noscript>` before it leaves the head.
                // Skipping this puts the right nodes in the right places anyway —
                // insertion reads the TOP of the stack — but leaves the noscript on
                // it under everything that follows, where a later scope walk finds
                // an element that is not an ancestor.
                if (this.mode === MODE_IN_HEAD && this.currentName() === 'noscript') {
                    this.open.pop();
                    this.onText(rest);
                    return;
                }
                if (this.mode === MODE_IN_HEAD) this.popHead();
                else this.openBody([]);
                this.onText(rest);
                return;
            }
            case MODE_AFTER_BODY:
            case MODE_AFTER_AFTER_BODY: {
                const ws = leadingWhitespaceLength(text);
                if (ws > 0) this.insertText(text.slice(0, ws));
                const rest = text.slice(ws);
                if (rest === '') return;
                this.mode = MODE_IN_BODY;
                this.onText(rest);
                return;
            }
            default:
                this.insertText(text);
        }
    }

    onOpenTag(name: string, attrs: TokenAttribute[], _selfClosing: boolean): void {
        // A start tag inside raw text cannot happen — the tokenizer only leaves
        // that state at the matching end tag — but an unterminated one reaches EOF
        // with the element still marked, so clear it here rather than assume.
        this.textElement = null;
        // The self-closing flag is deliberately unread: on an HTML element it is a
        // parse error the spec ignores, so `<div/>` OPENS a div. Only the void set
        // decides what closes immediately.
        this.skipLineFeed = false;
        // The spec's one tag-name rewrite.
        const tag = name === 'image' ? 'img' : name;

        if (this.inTemplate) {
            this.inBodyStartTag(tag, attrs);
            return;
        }

        switch (this.mode) {
            case MODE_INITIAL:
            case MODE_BEFORE_HTML:
                this.ensureHtml(tag === 'html' ? attrs : []);
                if (tag === 'html') return;
                this.onOpenTag(tag, attrs, _selfClosing);
                return;
            case MODE_BEFORE_HEAD:
                if (tag === 'html') {
                    this.mergeAttributes(this.htmlElement, attrs);
                    return;
                }
                if (tag === 'head') {
                    this.openHead(attrs);
                    return;
                }
                this.openHead([]);
                this.onOpenTag(tag, attrs, _selfClosing);
                return;
            case MODE_IN_HEAD:
                if (tag === 'html') {
                    this.mergeAttributes(this.htmlElement, attrs);
                    return;
                }
                if (tag === 'head') return;
                if (this.currentName() === 'noscript') {
                    if (IN_HEAD_NOSCRIPT.has(tag)) {
                        this.insertGeneric(tag, attrs);
                        return;
                    }
                    this.open.pop();
                    this.onOpenTag(tag, attrs, _selfClosing);
                    return;
                }
                if (HEAD_ELEMENTS.has(tag) || tag === 'noscript') {
                    this.insertGeneric(tag, attrs);
                    return;
                }
                this.popHead();
                this.onOpenTag(tag, attrs, _selfClosing);
                return;
            case MODE_AFTER_HEAD:
                if (tag === 'html') {
                    this.mergeAttributes(this.htmlElement, attrs);
                    return;
                }
                if (tag === 'head') return;
                if (tag === 'body') {
                    this.openBody(attrs);
                    return;
                }
                if (HEAD_ELEMENTS.has(tag) && this.headElement !== null) {
                    // The spec puts head back on the stack, processes with the
                    // in-head rules, and removes it again — so a stray `<link>`
                    // after `</head>` still lands in the head it belongs to.
                    this.open.push(this.headElement);
                    this.insertGeneric(tag, attrs);
                    const index = this.open.indexOf(this.headElement);
                    if (index !== -1) this.open.splice(index, 1);
                    return;
                }
                this.openBody([]);
                this.onOpenTag(tag, attrs, _selfClosing);
                return;
            case MODE_AFTER_BODY:
            case MODE_AFTER_AFTER_BODY:
                this.mode = MODE_IN_BODY;
                this.onOpenTag(tag, attrs, _selfClosing);
                return;
            default:
                this.inBodyStartTag(tag, attrs);
        }
    }

    private inBodyStartTag(tag: string, attrs: TokenAttribute[]): void {
        if (tag === 'html') {
            this.mergeAttributes(this.htmlElement, attrs);
            return;
        }
        if (tag === 'body') {
            this.mergeAttributes(this.bodyElement, attrs);
            return;
        }
        if (tag === 'head') return;

        if (TABLE_STRUCTURE.has(tag)) {
            if (!this.openTableStructure(tag)) return;
            this.insertGeneric(tag, attrs);
            return;
        }

        if (CLOSES_PARAGRAPH.has(tag) && (tag !== 'table' || !this.quirks)) this.closeParagraph();

        if (HEADINGS.has(tag)) {
            if (HEADINGS.has(this.currentName())) this.open.pop();
        } else if (tag === 'li' || tag === 'dd' || tag === 'dt') {
            this.closeListItem(tag);
            this.closeParagraph();
        } else if (tag === 'option') {
            if (this.currentName() === 'option') this.open.pop();
        } else if (tag === 'optgroup') {
            if (this.currentName() === 'option') this.open.pop();
            if (this.currentName() === 'optgroup') this.open.pop();
        } else if (tag === 'button') {
            if (this.hasInScope('button', DEFAULT_SCOPE)) {
                this.generateImpliedEndTags();
                this.popUntil('button');
            }
        } else if (tag === 'rb' || tag === 'rtc') {
            if (this.hasInScope('ruby', DEFAULT_SCOPE)) this.generateImpliedEndTags();
        } else if (tag === 'rp' || tag === 'rt') {
            if (this.hasInScope('ruby', DEFAULT_SCOPE)) this.generateImpliedEndTags('rtc');
        }

        this.insertGeneric(tag, attrs);
    }

    /** The `li`/`dd`/`dt` walk: find a sibling item, but give up at the first
     *  special element that is not `address`, `div` or `p`. */
    private closeListItem(tag: string): void {
        const isSibling = tag === 'li' ? (n: string) => n === 'li' : (n: string) => n === 'dd' || n === 'dt';
        for (let i = this.open.length - 1; i >= 0; i--) {
            const name = this.open[i].localName;
            if (isSibling(name)) {
                this.generateImpliedEndTags(name);
                this.popUntil(name);
                return;
            }
            if (SPECIAL_ELEMENTS.has(name) && name !== 'address' && name !== 'div' && name !== 'p') return;
        }
    }

    /**
     * Put the stack where a table structure element can be inserted, creating the
     * implicit `tbody`/`tr` a browser creates. Returns false when there is no open
     * table, in which case the token is dropped — the spec's rule, and the reason
     * a stray `</table>`-less `<td>` does not become a sibling of the paragraph.
     */
    private openTableStructure(tag: string): boolean {
        if (!this.hasInScope('table', TABLE_SCOPE)) return false;

        if (TABLE_CELLS.has(tag)) {
            if (this.hasInScope('td', TABLE_SCOPE) || this.hasInScope('th', TABLE_SCOPE)) {
                this.generateImpliedEndTags();
                while (this.open.length > 0) {
                    if (TABLE_CELLS.has(this.open.pop()?.localName ?? '')) break;
                }
            }
            this.clearBackTo(TABLE_ROW_CONTEXT);
            if (this.currentName() !== 'tr') {
                if (this.currentName() === 'table') this.insertElement('tbody', []);
                this.insertElement('tr', []);
            }
            return true;
        }

        if (tag === 'tr') {
            this.clearBackTo(TABLE_BODY_CONTEXT);
            if (this.currentName() === 'table') this.insertElement('tbody', []);
            return true;
        }

        if (tag === 'col') {
            if (this.currentName() !== 'colgroup') {
                this.clearBackTo(TABLE_CONTEXT);
                this.insertElement('colgroup', []);
            }
            return true;
        }

        if (TABLE_SECTIONS.has(tag) || tag === 'caption' || tag === 'colgroup') {
            this.clearBackTo(TABLE_CONTEXT);
            return true;
        }

        // `frame` outside a frameset.
        return false;
    }

    onCloseTag(name: string): void {
        this.skipLineFeed = false;
        if (this.textElement !== null && this.textElement.localName === name) this.textElement = null;
        if (this.inTemplate) {
            this.inBodyEndTag(name);
            return;
        }
        switch (this.mode) {
            case MODE_INITIAL:
            case MODE_BEFORE_HTML:
            case MODE_BEFORE_HEAD:
                if (name === 'head' || name === 'body' || name === 'html' || name === 'br') {
                    this.openHead([]);
                    this.onCloseTag(name);
                }
                return;
            case MODE_IN_HEAD:
                if (HEAD_ELEMENTS.has(name) || name === 'noscript') {
                    this.closeElement(name);
                    return;
                }
                if (this.currentName() === 'noscript') {
                    this.open.pop();
                    this.onCloseTag(name);
                    return;
                }
                if (name === 'head') {
                    this.popHead();
                    return;
                }
                if (name === 'body' || name === 'html' || name === 'br') {
                    this.popHead();
                    this.onCloseTag(name);
                }
                return;
            case MODE_AFTER_HEAD:
                if (name === 'body' || name === 'html' || name === 'br') {
                    this.openBody([]);
                    this.onCloseTag(name);
                }
                return;
            case MODE_AFTER_BODY:
                if (name === 'html') {
                    this.mode = MODE_AFTER_AFTER_BODY;
                    return;
                }
                this.mode = MODE_IN_BODY;
                this.onCloseTag(name);
                return;
            case MODE_AFTER_AFTER_BODY:
                this.mode = MODE_IN_BODY;
                this.onCloseTag(name);
                return;
            default:
                this.inBodyEndTag(name);
        }
    }

    private inBodyEndTag(name: string): void {
        if (name === 'body' || name === 'html') {
            // Neither pops: only the insertion mode moves, which is why text after
            // `</body>` still lands inside the body.
            if (this.hasInScope('body', DEFAULT_SCOPE)) {
                this.mode = MODE_AFTER_BODY;
                if (name === 'html') this.onCloseTag('html');
            }
            return;
        }

        if (name === 'p') {
            // `</p>` with nothing open inserts an EMPTY paragraph, which is what a
            // browser produces and what a naive parser silently drops.
            if (!this.hasInScope('p', BUTTON_SCOPE)) this.insertElement('p', []);
            this.generateImpliedEndTags('p');
            this.popUntil('p');
            return;
        }

        this.closeElement(name);
    }

    private closeElement(name: string): void {
        if (HEADINGS.has(name)) {
            if (!this.hasAnyHeadingInScope()) return;
            this.generateImpliedEndTags(name);
            while (this.open.length > 0) {
                if (HEADINGS.has(this.open.pop()?.localName ?? '')) break;
            }
            return;
        }

        if (SCOPED_END_TAGS.has(name)) {
            const scope =
                name === 'li' ? LIST_ITEM_SCOPE : SCOPED_TABLE_END_TAGS.has(name) ? TABLE_SCOPE : DEFAULT_SCOPE;
            if (!this.hasInScope(name, scope)) return;
            this.generateImpliedEndTags(name);
            this.popUntil(name);
            return;
        }

        // "Any other end tag": walk up, but a special element between here and the
        // match means the end tag was misnested — the spec drops it.
        for (let i = this.open.length - 1; i >= 0; i--) {
            const node = this.open[i].localName;
            if (node === name) {
                this.generateImpliedEndTags(name);
                while (this.open.length > i) this.open.pop();
                return;
            }
            if (SPECIAL_ELEMENTS.has(node)) return;
        }
    }

    private hasAnyHeadingInScope(): boolean {
        for (let i = this.open.length - 1; i >= 0; i--) {
            const node = this.open[i].localName;
            if (HEADINGS.has(node)) return true;
            if (DEFAULT_SCOPE.has(node)) return false;
        }
        return false;
    }

    /** EOF drives the same transitions a token would, so a document holding only a
     *  comment still gets the html/head/body a browser gives it. */
    finish(): void {
        if (this.mode === MODE_INITIAL || this.mode === MODE_BEFORE_HTML) this.ensureHtml([]);
        if (this.mode === MODE_BEFORE_HEAD) this.openHead([]);
        if (this.mode === MODE_IN_HEAD) this.popHead();
        if (this.mode === MODE_AFTER_HEAD) this.openBody([]);
    }
}

/** Parse `source` as an HTML document. Never throws on malformed input: HTML has
 *  no fatal parse errors, and a scraper that gets an exception instead of a tree
 *  has to guess what the page was. */
export function parseHtml(source: string): DOMDocument {
    const builder = new TreeBuilder();
    tokenize(source, builder);
    builder.finish();
    return builder.document;
}
