// The tokenizer's output boundary.
//
// Deliberately a LEAF: it names no node class, so the tokenizer can be driven by
// a recording sink in its own tests and by the tree builder in production without
// either knowing about the other. A tokenizer bug cannot then hide behind a tree
// builder bug — the two are measured separately.

/** One attribute of a start tag, after name lowercasing and duplicate removal. */
export interface TokenAttribute {
    name: string;
    value: string;
}

/** `<!DOCTYPE …>`, in the parts an HTML document can observe. */
export interface DoctypeToken {
    name: string | null;
    publicId: string | null;
    systemId: string | null;
    /** The declaration was malformed; the tree builder maps this to quirks mode. */
    forceQuirks: boolean;
}

/**
 * What the tokenizer emits. Text arrives already decoded and coalesced: one call
 * per run between markup, never one per character, so a sink never has to merge.
 */
export interface TreeSink {
    onDoctype(doctype: DoctypeToken): void;
    onOpenTag(name: string, attrs: TokenAttribute[], selfClosing: boolean): void;
    onCloseTag(name: string): void;
    onText(text: string): void;
    onComment(data: string): void;
}
