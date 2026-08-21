// The one seam between the selector engine and a tree.
//
// It exists so that ONE engine serves two node models: this package's own nodes
// and `@gjsify/dom-elements`'s `Element` (ADR 0026 § Decision 2). A second
// engine is the shape code-anti-patterns names as "the drifted copy fails in a
// CONSUMER while the owning package stays green" — and `dom-elements` is where
// it would have drifted, since its four selector methods answered `null`/`[]`
// without ever looking at the tree.
//
// Node identity is compared with `===`. Every tree in reach hands out stable
// node objects; a model that materialises wrappers per access would need an
// `equals` here before it could be adapted.

export interface Adapter<TNode> {
    isTag(node: TNode): boolean;
    /** The element's lowercase local name — no namespace prefix. */
    getName(node: TNode): string;
    getParent(node: TNode): TNode | null;
    /** Every child NODE in document order; the engine filters elements itself. */
    getChildren(node: TNode): TNode[];
    /** The child list `node` lives in, or `[node]` when it has no parent. */
    getSiblings(node: TNode): TNode[];
    getAttributeValue(node: TNode, name: string): string | null;
    /** Concatenated character data of the subtree — what `:empty` asks about. */
    getText(node: TNode): string;
    /**
     * `false` in an HTML document, where type and attribute NAMES fold to
     * lowercase; `true` in an XML one, where they do not.
     */
    readonly caseSensitive: boolean;
}
