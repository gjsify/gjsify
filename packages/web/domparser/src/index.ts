// DOMParser for GJS — self-contained XML/HTML parser with a minimal DOM.
//
// Barrel: re-exports only. The node classes live in `./dom/`, the XML scanner in
// `./xml/`, the HTML tokenizer and tree builder in `./html/` and the
// character-reference decoder in `./entities/` — the last two are also reachable
// as their own package subpaths, so a consumer wanting the tokenizer alone does
// not pull the node classes in.

export { DOMNode } from './dom/node.js';
export { DOMElement } from './dom/element.js';
export { DOMDocument } from './dom/document.js';
export { DOMComment } from './dom/comment.js';
export { DOMDocumentType } from './dom/doctype.js';
export { DOMDocumentFragment } from './dom/fragment.js';
export { DOMCDATASection, DOMText } from './dom/text.js';
export { domTreeReader } from './dom/reader.js';
export { canonicalize } from './canonical.js';
export type { ReadAttribute, TreeReader } from './canonical.js';
export { DOMParser } from './dom-parser.js';
