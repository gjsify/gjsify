// DOMParser for GJS — self-contained XML/HTML parser.
// Implements the WHATWG DOMParser interface (parseFromString) with a minimal
// DOM sufficient for the excalibur-tiled plugin:
//   - Element: tagName, getAttribute, children, childNodes, querySelector,
//               querySelectorAll, textContent, innerHTML
//   - Document: documentElement, querySelector, querySelectorAll
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/DOMParser

export class DOMNode {
    nodeType: number;
    nodeName: string;
    nodeValue: string | null;
    parentNode: DOMNode | null = null;
    childNodes: DOMNode[] = [];

    constructor(nodeType: number, nodeName: string, nodeValue: string | null = null) {
        this.nodeType = nodeType;
        this.nodeName = nodeName;
        this.nodeValue = nodeValue;
    }

    get textContent(): string {
        if (this.nodeType === 3 || this.nodeType === 4) return this.nodeValue ?? '';
        return this.childNodes.map(c => c.textContent ?? '').join('');
    }
}

export class DOMElement extends DOMNode {
    tagName: string;
    localName: string;
    private _attrs: Map<string, string> = new Map();

    constructor(tagName: string) {
        super(1, tagName.toUpperCase());
        this.tagName = tagName.toLowerCase();
        this.localName = this.tagName;
    }

    get children(): DOMElement[] {
        return this.childNodes.filter((n): n is DOMElement => n.nodeType === 1);
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
        return this.childNodes.map(n => {
            if (n.nodeType === 1) return (n as DOMElement).outerHTML;
            if (n.nodeType === 3) return n.nodeValue ?? '';
            if (n.nodeType === 4) return '<![CDATA[' + (n.nodeValue ?? '') + ']]>';
            return '';
        }).join('');
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
        const matching = this.children.filter(c => c.tagName === first.trim().toLowerCase());
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

export class DOMDocument extends DOMElement {
    documentElement: DOMElement | null = null;

    constructor() {
        super('#document');
        this.nodeType = 9;
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

// ---------------------------------------------------------------------------
// XML tokeniser
// ---------------------------------------------------------------------------

const ATTR_PATTERN = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

function parseAttributes(attrsStr: string, el: DOMElement): void {
    let m: RegExpExecArray | null;
    ATTR_PATTERN.lastIndex = 0;
    while ((m = ATTR_PATTERN.exec(attrsStr)) !== null) {
        el.setAttribute(m[1], m[2] ?? m[3] ?? m[4] ?? '');
    }
}

function parseXml(xml: string): DOMDocument {
    const doc = new DOMDocument();
    const stack: DOMElement[] = [doc];
    let i = 0;
    const len = xml.length;

    while (i < len) {
        const ltIdx = xml.indexOf('<', i);
        if (ltIdx === -1) {
            const text = xml.slice(i);
            if (text.trim()) {
                const tn = new DOMNode(3, '#text', text);
                const top = stack[stack.length - 1];
                tn.parentNode = top;
                top.childNodes.push(tn);
            }
            break;
        }

        if (ltIdx > i) {
            const text = xml.slice(i, ltIdx);
            if (text.trim()) {
                const tn = new DOMNode(3, '#text', text);
                const top = stack[stack.length - 1];
                tn.parentNode = top;
                top.childNodes.push(tn);
            }
        }

        // CDATA
        if (xml.startsWith('<![CDATA[', ltIdx)) {
            const end = xml.indexOf(']]>', ltIdx);
            if (end === -1) break;
            const cn = new DOMNode(4, '#cdata-section', xml.slice(ltIdx + 9, end));
            const top = stack[stack.length - 1];
            cn.parentNode = top;
            top.childNodes.push(cn);
            i = end + 3;
            continue;
        }

        // Comment
        if (xml.startsWith('<!--', ltIdx)) {
            const end = xml.indexOf('-->', ltIdx);
            i = end === -1 ? len : end + 3;
            continue;
        }

        // Processing instruction or DOCTYPE
        if (xml.startsWith('<?', ltIdx) || xml.startsWith('<!', ltIdx)) {
            const end = xml.indexOf('>', ltIdx);
            i = end === -1 ? len : end + 1;
            continue;
        }

        // For tags that may contain '>' inside attribute values, find proper end
        const gtIdx = findTagEnd(xml, ltIdx + 1);
        if (gtIdx === -1) break;

        const tagContent = xml.slice(ltIdx + 1, gtIdx);

        // Closing tag
        if (tagContent.startsWith('/')) {
            if (stack.length > 1) stack.pop();
            i = gtIdx + 1;
            continue;
        }

        const selfClosing = tagContent.endsWith('/');
        const inner = selfClosing ? tagContent.slice(0, -1) : tagContent;

        const wsIdx = inner.search(/\s/);
        const tagName = (wsIdx === -1 ? inner : inner.slice(0, wsIdx)).trim();
        if (!tagName) { i = gtIdx + 1; continue; }

        const el = new DOMElement(tagName);
        if (wsIdx !== -1) parseAttributes(inner.slice(wsIdx), el);

        const top = stack[stack.length - 1];
        el.parentNode = top;
        top.childNodes.push(el);

        if (top === doc && !doc.documentElement) {
            doc.documentElement = el;
        }

        if (!selfClosing) stack.push(el);

        i = gtIdx + 1;
    }

    return doc;
}

/** Find the index of '>' that closes a tag, skipping '>' inside quoted attribute values. */
function findTagEnd(xml: string, start: number): number {
    let inSingle = false;
    let inDouble = false;
    for (let i = start; i < xml.length; i++) {
        const ch = xml[i];
        if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
        if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
        if (ch === '>' && !inSingle && !inDouble) return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// DOMParser
// ---------------------------------------------------------------------------

export class DOMParser {
    parseFromString(string: string, _mimeType: string): DOMDocument {
        return parseXml(string);
    }
}
