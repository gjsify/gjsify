// This package's side of the one selector engine (ADR 0026 § Decision 2).
//
// The engine lives in `@gjsify/domparser/selectors` and knows nothing about any
// node model; everything it needs from a tree is the eight members below. That
// seam exists precisely so `dom-elements` does not grow a second engine — the
// duplication shape where "the drifted copy fails in a CONSUMER while the owning
// package stays green".
//
// The edge is dom → web, tier 1 → tier 1, and the subpath is pure TypeScript, so
// nothing new becomes reachable from a package that must keep running headless.
// The reverse edge is closed: `domparser` importing this package would drag
// GdkPixbuf, Cairo and Soup into something that has to run on Node.

import type { Adapter } from '@gjsify/domparser/selectors';

import { NodeType } from './node-type.js';
import * as PS from './property-symbol.js';
import type { Element } from './element.js';
import type { Node } from './node.js';

/**
 * The adapter, over `Node` rather than `Element`.
 *
 * Sibling and child lists contain text and comment nodes too, and the engine
 * needs to see them: `:nth-child` counts elements, but `+` and `~` have to skip
 * what lies between, and `:empty` asks whether any character data is there at
 * all. Handing it a pre-filtered element list would answer those three wrong.
 */
export const elementAdapter: Adapter<Node> = {
    isTag(node: Node): boolean {
        return node[PS.nodeType] === NodeType.ELEMENT_NODE;
    },

    // `localName`, not `tagName`: this model stores tagName uppercased, and the
    // engine compares against the lowercase type selector it parsed.
    getName(node: Node): string {
        return (node as Element)[PS.localName] ?? '';
    },

    getParent(node: Node): Node | null {
        return node.parentNode;
    },

    getChildren(node: Node): Node[] {
        return node[PS.childNodesList];
    },

    getSiblings(node: Node): Node[] {
        const parent = node.parentNode;
        return parent ? parent[PS.childNodesList] : [node];
    },

    getAttributeValue(node: Node, name: string): string | null {
        if (node[PS.nodeType] !== NodeType.ELEMENT_NODE) return null;
        return (node as Element).getAttribute(name);
    },

    getText(node: Node): string {
        return node.textContent ?? '';
    },

    // These are HTML elements: type and attribute names fold to lowercase. The
    // XML side of the same engine sets this true; nothing here builds one.
    caseSensitive: false,
};
