// The HTML parser, as a leaf: tokenizer, tree builder and the tables they read.
// It imports the node classes it builds and nothing platform-specific, so the
// same code runs on gjs, node, bun and deno (ADR 0026 § Decision 1).

export { parseHtml } from './tree-builder.js';
export { RAWTEXT_ELEMENTS, RCDATA_ELEMENTS, tokenize } from './tokenizer.js';
export { VOID_ELEMENTS } from './void-elements.js';
export type { DoctypeToken, TokenAttribute, TreeSink } from './tree-sink.js';
