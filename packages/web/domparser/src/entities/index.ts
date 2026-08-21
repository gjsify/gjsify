// The character-reference decoder, as a leaf: it imports no node class and no
// platform module, so a consumer that only needs decoding does not pull the DOM
// in (ADR 0026 § Decision 1).

export { decodeAttributeValue, decodeHtml, decodeText, decodeXml } from './decode.js';
export type { DecodeContext } from './decode.js';
export { NAMED_REFERENCES } from './data.js';
