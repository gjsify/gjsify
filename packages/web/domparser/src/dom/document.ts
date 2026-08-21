import type { DOMDocumentType } from './doctype.js';
import { DOMElement } from './element.js';
import { DOCUMENT_NODE, DOCUMENT_TYPE_NODE, ELEMENT_NODE } from './node.js';

export class DOMDocument extends DOMElement {
    documentElement: DOMElement | null = null;

    constructor() {
        super('#document');
        this.nodeType = DOCUMENT_NODE;
        this.nodeName = '#document';
    }

    /** Computed rather than stored, so a document assembled by hand answers too. */
    get doctype(): DOMDocumentType | null {
        for (const child of this.childNodes) {
            if (child.nodeType === DOCUMENT_TYPE_NODE) return child as DOMDocumentType;
        }
        return null;
    }

    get head(): DOMElement | null {
        return this._documentChild('head');
    }

    get body(): DOMElement | null {
        return this._documentChild('body');
    }

    private _documentChild(name: string): DOMElement | null {
        const root = this.documentElement;
        if (root === null) return null;
        for (const child of root.childNodes) {
            if (child.nodeType === ELEMENT_NODE && (child as DOMElement).localName === name) {
                return child as DOMElement;
            }
        }
        return null;
    }

    querySelector(selector: string): DOMElement | null {
        if (this.documentElement) {
            const tag = selector.trim().toLowerCase();
            if (this.documentElement.localName === tag) return this.documentElement;
            return this.documentElement.querySelector(selector);
        }
        return super.querySelector(selector);
    }

    querySelectorAll(selector: string): DOMElement[] {
        const tag = selector.trim().toLowerCase();
        const results: DOMElement[] = [];
        if (this.documentElement) {
            if (this.documentElement.localName === tag) results.push(this.documentElement);
            this.documentElement._findAll(tag, results);
        }
        return results;
    }
}
