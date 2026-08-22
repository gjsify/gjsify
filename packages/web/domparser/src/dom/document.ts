import { quoteSelectorString } from '../selectors/index.js';
import type { DOMDocumentType } from './doctype.js';
import { DOMElement } from './element.js';
import { DOCUMENT_NODE, DOCUMENT_TYPE_NODE, ELEMENT_NODE } from './node.js';

export class DOMDocument extends DOMElement {
    documentElement: DOMElement | null = null;

    constructor(html = false) {
        super('#document', html);
        // `DOMElement` derives these three from a real tag name; a document has
        // none, and the two it already spelled out are observable.
        this.nodeType = DOCUMENT_NODE;
        this.nodeName = '#document';
        this.tagName = '#document';
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

    getElementById(id: string): DOMElement | null {
        return this.querySelector('[id=' + quoteSelectorString(id) + ']');
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
}
