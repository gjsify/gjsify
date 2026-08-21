// Character-reference decoding, in the three contexts this parser has.
//
// The contexts are not a nicety. Without the attribute rule,
// `href="?a=1&copy=2"` decodes to `?a=1©=2` — a URL that looks parsed and points
// nowhere. HTML therefore refuses a semicolon-less named reference inside an
// attribute value when the character after it is `=` or alphanumeric, and
// decodes the very same text in element content.
//
// `strict` is the XML rule and a different table: five predefined names, the
// semicolon mandatory, and no Windows-1252 remap — `&nbsp;` is not an XML
// reference and must survive unchanged.
//
// https://html.spec.whatwg.org/multipage/parsing.html#character-reference-state

import { NAMED_REFERENCES } from './data.js';

const REPLACEMENT = '\uFFFD';

/** Longest key in the table, so the matcher's window follows the data. */
const MAX_REFERENCE_LENGTH = Object.keys(NAMED_REFERENCES).reduce(
    (max, key) => (key.length > max ? key.length : max),
    0,
);

/** XML's five predefined entities. A separate table, not a filter over the HTML
 *  one, so `&nbsp;` cannot resolve here by accident. */
const XML_REFERENCES: Record<string, string> = {
    'amp;': '&',
    'apos;': "'",
    'gt;': '>',
    'lt;': '<',
    'quot;': '"',
};

const MAX_XML_REFERENCE_LENGTH = 6;

// HTML re-maps the C1 range to the Windows-1252 characters authors meant, because
// a decade of `&#128;` in the wild means `€` and not U+0080. Codes in the range
// with no entry here (0x81, 0x8D, 0x8F, 0x90, 0x9D) are used as written.
// https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
const C1_REPLACEMENTS: Record<number, number> = {
    0x80: 0x20ac,
    0x82: 0x201a,
    0x83: 0x0192,
    0x84: 0x201e,
    0x85: 0x2026,
    0x86: 0x2020,
    0x87: 0x2021,
    0x88: 0x02c6,
    0x89: 0x2030,
    0x8a: 0x0160,
    0x8b: 0x2039,
    0x8c: 0x0152,
    0x8e: 0x017d,
    0x91: 0x2018,
    0x92: 0x2019,
    0x93: 0x201c,
    0x94: 0x201d,
    0x95: 0x2022,
    0x96: 0x2013,
    0x97: 0x2014,
    0x98: 0x02dc,
    0x99: 0x2122,
    0x9a: 0x0161,
    0x9b: 0x203a,
    0x9c: 0x0153,
    0x9e: 0x017e,
    0x9f: 0x0178,
};

/**
 * `text` — element content and RCDATA: the semicolon may be omitted.
 * `attribute` — the same table, refusing a semicolon-less name followed by `=`
 * or an alphanumeric, so a query string survives.
 * `strict` — XML: the five predefined names only, semicolon mandatory.
 */
export type DecodeContext = 'text' | 'attribute' | 'strict';

function isDecimalDigit(c: string | undefined): boolean {
    return c !== undefined && c >= '0' && c <= '9';
}

function isHexDigit(c: string | undefined): boolean {
    if (c === undefined) return false;
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

function isAlphanumeric(c: string | undefined): boolean {
    if (c === undefined) return false;
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function fromCodePoint(digits: string, hex: boolean, remapC1: boolean): string {
    const code = Number.parseInt(digits, hex ? 16 : 10);
    // A long enough digit run parses to Infinity, which is why the finiteness
    // check comes before the range comparison rather than after it.
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff) return REPLACEMENT;
    if (code >= 0xd800 && code <= 0xdfff) return REPLACEMENT;
    const remapped = remapC1 ? C1_REPLACEMENTS[code] : undefined;
    return String.fromCodePoint(remapped === undefined ? code : remapped);
}

/**
 * Result of one reference attempt: the decoded text, and how many characters
 * after the `&` it consumed. `consumed === 0` means "not a reference" — the `&`
 * is then literal text, which is legal and common (`AT&T`, `?a=1&copy=2`).
 */
interface ReferenceMatch {
    text: string;
    consumed: number;
}

function matchNumeric(input: string, start: number, ctx: DecodeContext): ReferenceMatch {
    let p = start + 1;
    const hex = input[p] === 'x' || input[p] === 'X';
    if (hex) p++;
    const digitsStart = p;
    while (p < input.length && (hex ? isHexDigit(input[p]) : isDecimalDigit(input[p]))) p++;
    if (p === digitsStart) return { text: '', consumed: 0 };
    const strict = ctx === 'strict';
    // XML requires the semicolon; HTML makes it a parse error and decodes anyway,
    // in attribute values as well as in text.
    if (strict && input[p] !== ';') return { text: '', consumed: 0 };
    const text = fromCodePoint(input.slice(digitsStart, p), hex, !strict);
    return { text, consumed: (input[p] === ';' ? p + 1 : p) - start };
}

function matchNamed(input: string, start: number, ctx: DecodeContext): ReferenceMatch {
    const table = ctx === 'strict' ? XML_REFERENCES : NAMED_REFERENCES;
    const window = ctx === 'strict' ? MAX_XML_REFERENCE_LENGTH : MAX_REFERENCE_LENGTH;
    const lookahead = input.slice(start, start + window);
    for (let n = lookahead.length; n > 0; n--) {
        const key = lookahead.slice(0, n);
        if (!Object.hasOwn(table, key)) continue;
        if (ctx === 'attribute' && key[key.length - 1] !== ';') {
            const after = input[start + n];
            // Decided on the LONGEST match, as the spec does: a shorter one is not
            // tried, so `?a=1&copy=2` stays whole instead of falling back to `&cop`.
            if (after === '=' || isAlphanumeric(after)) break;
        }
        return { text: table[key], consumed: n };
    }
    return { text: '', consumed: 0 };
}

/** Decode every character reference in `input` under the rules of `ctx`. */
export function decodeHtml(input: string, ctx: DecodeContext): string {
    let amp = input.indexOf('&');
    if (amp === -1) return input;

    let out = '';
    let read = 0;
    while (amp !== -1) {
        out += input.slice(read, amp);
        const match = input[amp + 1] === '#' ? matchNumeric(input, amp + 1, ctx) : matchNamed(input, amp + 1, ctx);
        if (match.consumed === 0) {
            out += '&';
            read = amp + 1;
        } else {
            out += match.text;
            read = amp + 1 + match.consumed;
        }
        amp = input.indexOf('&', read);
    }
    return out + input.slice(read);
}

/** Decode references in element content (RCDATA included). */
export function decodeText(input: string): string {
    return decodeHtml(input, 'text');
}

/** Decode references in an attribute value, quoted or unquoted. */
export function decodeAttributeValue(input: string): string {
    return decodeHtml(input, 'attribute');
}

/** Decode the references XML defines, and only those. */
export function decodeXml(input: string): string {
    return decodeHtml(input, 'strict');
}
