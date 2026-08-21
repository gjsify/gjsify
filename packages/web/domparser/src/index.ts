// DOMParser for GJS — self-contained XML/HTML parser with a minimal DOM.
//
// Barrel: re-exports only. The node classes live in `./dom/`, the XML scanner in
// `./xml/`, the HTML tokenizer in `./html/` and the character-reference decoder in
// `./entities/` — the last two are also reachable as their own package subpaths,
// so a consumer wanting the tokenizer alone does not pull the node classes in.

export { DOMNode } from './dom/node.js';
export { DOMElement } from './dom/element.js';
export { DOMDocument } from './dom/document.js';
export { DOMParser } from './dom-parser.js';
