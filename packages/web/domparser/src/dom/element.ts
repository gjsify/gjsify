import { HTML_ADAPTER, XML_ADAPTER } from '../dom-adapter.js';
import type { Adapter } from '../selectors/index.js';
import { closestSelector, matchesSelector, quoteSelectorString, selectAll, selectOne } from '../selectors/index.js';
import type { DOMDocumentFragment } from './fragment.js';
import { CDATA_SECTION_NODE, DOMNode, ELEMENT_NODE, TEXT_NODE } from './node.js';

export class DOMElement extends DOMNode {
    /**
     * UPPERCASE in HTML documents, lowercase in XML ones. The XML spelling is
     * wrong by the XML spec and frozen anyway — the one measured consumer
     * switches on lowercase literals at 24 sites (ADR 0026 § Decision 4), and
     * `src/xml-shape.spec.ts` fails if it moves.
     */
    tagName: string;
    localName: string;
    /** `<template>` holds its children here, never in `childNodes`. */
    content?: DOMDocumentFragment;
    /**
     * Which document this node belongs to, in the only terms selectors need:
     * HTML folds type and attribute names to lowercase, XML does not. There is
     * no `ownerDocument` to ask — one node model is § Deferred in ADR 0026.
     */
    protected readonly _html: boolean;
    private _attrs: Map<string, string> = new Map();

    constructor(tagName: string, html = false) {
        const localName = tagName.toLowerCase();
        super(ELEMENT_NODE, html ? localName.toUpperCase() : tagName.toUpperCase());
        this.localName = localName;
        this.tagName = html ? localName.toUpperCase() : localName;
        this._html = html;
    }

    get id(): string {
        return this._attrs.get('id') ?? '';
    }

    get className(): string {
        return this._attrs.get('class') ?? '';
    }

    get parentElement(): DOMElement | null {
        const parent = this.parentNode;
        return parent !== null && parent.nodeType === ELEMENT_NODE ? (parent as DOMElement) : null;
    }

    get firstElementChild(): DOMElement | null {
        return this.children[0] ?? null;
    }

    get lastElementChild(): DOMElement | null {
        const kids = this.children;
        return kids[kids.length - 1] ?? null;
    }

    get nextElementSibling(): DOMElement | null {
        return this._sibling(1);
    }

    get previousElementSibling(): DOMElement | null {
        return this._sibling(-1);
    }

    private _sibling(step: number): DOMElement | null {
        const parent = this.parentNode;
        if (parent === null) return null;
        const siblings = parent.childNodes;
        for (let i = siblings.indexOf(this) + step; i >= 0 && i < siblings.length; i += step) {
            if (siblings[i].nodeType === ELEMENT_NODE) return siblings[i] as DOMElement;
        }
        return null;
    }

    get children(): DOMElement[] {
        return this.childNodes.filter((n): n is DOMElement => n.nodeType === ELEMENT_NODE);
    }

    getAttribute(name: string): string | null {
        return this._attrs.has(name) ? (this._attrs.get(name) ?? null) : null;
    }

    setAttribute(name: string, value: string): void {
        this._attrs.set(name, value);
    }

    hasAttribute(name: string): boolean {
        return this._attrs.has(name);
    }

    get attributes(): { name: string; value: string }[] {
        return Array.from(this._attrs.entries()).map(([name, value]) => ({ name, value }));
    }

    get innerHTML(): string {
        return this.childNodes
            .map((n) => {
                if (n.nodeType === ELEMENT_NODE) return (n as DOMElement).outerHTML;
                if (n.nodeType === TEXT_NODE) return n.nodeValue ?? '';
                if (n.nodeType === CDATA_SECTION_NODE) return '<![CDATA[' + (n.nodeValue ?? '') + ']]>';
                return '';
            })
            .join('');
    }

    get outerHTML(): string {
        const attrs = Array.from(this._attrs.entries())
            .map(([k, v]) => ' ' + k + '="' + v.replace(/"/g, '&quot;') + '"')
            .join('');
        if (this.childNodes.length === 0) return '<' + this.localName + attrs + '/>';
        return '<' + this.localName + attrs + '>' + this.innerHTML + '</' + this.localName + '>';
    }

    protected _adapter(): Adapter<DOMNode> {
        return this._html ? HTML_ADAPTER : XML_ADAPTER;
    }

    querySelector(selector: string): DOMElement | null {
        return selectOne<DOMNode>(selector, this, this._adapter()) as DOMElement | null;
    }

    querySelectorAll(selector: string): DOMElement[] {
        return selectAll<DOMNode>(selector, this, this._adapter()) as DOMElement[];
    }

    matches(selector: string): boolean {
        return matchesSelector<DOMNode>(selector, this, this._adapter());
    }

    closest(selector: string): DOMElement | null {
        return closestSelector<DOMNode>(selector, this, this._adapter()) as DOMElement | null;
    }

    /** A space-separated list, and EVERY name in it has to be present. */
    getElementsByClassName(names: string): DOMElement[] {
        const wanted = names
            .trim()
            .split(/\s+/)
            .filter((name) => name !== '');
        if (wanted.length === 0) return [];
        return this.querySelectorAll(wanted.map((name) => '[class~=' + quoteSelectorString(name) + ']').join(''));
    }
}
