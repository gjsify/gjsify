import { DOMNode, ELEMENT_NODE, TEXT_NODE, CDATA_SECTION_NODE } from './node.js';

export class DOMElement extends DOMNode {
    tagName: string;
    localName: string;
    private _attrs: Map<string, string> = new Map();

    constructor(tagName: string) {
        super(ELEMENT_NODE, tagName.toUpperCase());
        this.tagName = tagName.toLowerCase();
        this.localName = this.tagName;
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
        if (this.childNodes.length === 0) return '<' + this.tagName + attrs + '/>';
        return '<' + this.tagName + attrs + '>' + this.innerHTML + '</' + this.tagName + '>';
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
            if (child.tagName === tag) return child;
            const found = child._find(tag);
            if (found) return found;
        }
        return undefined;
    }

    _findAll(tag: string, results: DOMElement[]): void {
        for (const child of this.children) {
            if (child.tagName === tag) results.push(child);
            child._findAll(tag, results);
        }
    }

    private _queryChildChain(parts: string[]): DOMElement | null {
        const [first, ...rest] = parts;
        const matching = this.children.filter((c) => c.tagName === first.trim().toLowerCase());
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
