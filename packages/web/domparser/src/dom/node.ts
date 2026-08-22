// The base node. Deliberately platform-free: no `gi://`, no `node:`, so the same
// classes serve the gjs, node, bun and deno runs.

/** Node type constants, spelled out so call sites read as the spec does. */
export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const CDATA_SECTION_NODE = 4;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;
export const DOCUMENT_TYPE_NODE = 10;
export const DOCUMENT_FRAGMENT_NODE = 11;

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
        if (this.nodeType === TEXT_NODE || this.nodeType === CDATA_SECTION_NODE) return this.nodeValue ?? '';
        return this.childNodes.map((c) => c.textContent ?? '').join('');
    }
}
