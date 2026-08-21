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
    private _attrs: Map<string, string> = new Map();

    constructor(tagName: string, html = false) {
        const localName = tagName.toLowerCase();
        super(ELEMENT_NODE, html ? localName.toUpperCase() : tagName.toUpperCase());
        this.localName = localName;
        this.tagName = html ? localName.toUpperCase() : localName;
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

    querySelector(selector: string): DOMElement | null {
        const parts = selector.trim().split(/\s*>\s*/);
        if (parts.length > 1) return this._queryChildChain(parts);
        const parts2 = selector.trim().split(/\s+/);
        if (parts2.length > 1) return this._queryDescendantChain(parts2);
        return this._find(selector.trim().toLowerCase()) ?? null;
    }

    querySelectorAll(selector: string): DOMElement[] {
        const tag = selector.trim().toLowerCase();
        const results: DOMElement[] = [];
        this._findAll(tag, results);
        return results;
    }

    _find(tag: string): DOMElement | undefined {
        for (const child of this.children) {
            if (child.localName === tag) return child;
            const found = child._find(tag);
            if (found) return found;
        }
        return undefined;
    }

    _findAll(tag: string, results: DOMElement[]): void {
        for (const child of this.children) {
            if (child.localName === tag) results.push(child);
            child._findAll(tag, results);
        }
    }

    private _queryChildChain(parts: string[]): DOMElement | null {
        const [first, ...rest] = parts;
        const matching = this.children.filter((c) => c.localName === first.trim().toLowerCase());
        if (rest.length === 0) return matching[0] ?? null;
        for (const el of matching) {
            const found = el._queryChildChain(rest);
            if (found) return found;
        }
        return null;
    }

    private _queryDescendantChain(parts: string[]): DOMElement | null {
        const [first, ...rest] = parts;
        const candidates: DOMElement[] = [];
        this._findAll(first.trim().toLowerCase(), candidates);
        if (rest.length === 0) return candidates[0] ?? null;
        for (const el of candidates) {
            const found = el._queryDescendantChain(rest);
            if (found) return found;
        }
        return null;
    }
}
