import { DOMElement } from './element.js';
import { DOCUMENT_NODE } from './node.js';

export class DOMDocument extends DOMElement {
    documentElement: DOMElement | null = null;

    constructor() {
        super('#document');
        this.nodeType = DOCUMENT_NODE;
        this.nodeName = '#document';
    }

    querySelector(selector: string): DOMElement | null {
        if (this.documentElement) {
            const tag = selector.trim().toLowerCase();
            if (this.documentElement.tagName === tag) return this.documentElement;
            return this.documentElement.querySelector(selector);
        }
        return super.querySelector(selector);
    }

    querySelectorAll(selector: string): DOMElement[] {
        const tag = selector.trim().toLowerCase();
        const results: DOMElement[] = [];
        if (this.documentElement) {
            if (this.documentElement.tagName === tag) results.push(this.documentElement);
            this.documentElement._findAll(tag, results);
        }
        return results;
    }
}
