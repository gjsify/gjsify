// A pull tokeniser over the XML subset an AppStream metainfo file is.
//
// NO GI imports, deliberately. `appdata.ts` above it is the AppStream field reader that
// `about-dialog.ts` uses when `Adw.AboutDialog.new_from_appdata()` is missing, and that
// fallback runs ONLY on Windows (see `about-dialog.ts` for the `#ifndef G_OS_WIN32` patch
// that removes the constructor there). A parser reachable only from a platform CI never
// opens a window on is a parser nothing tests — so the whole reading half is plain
// TypeScript, runs in the `--app node` suite as well as the GJS one, and is held against
// real metainfo XML there.
//
// NOT a general XML parser and not meant to become one. It covers what a metainfo
// document contains: elements, attributes, text, CDATA, comments, the XML declaration and
// a doctype. Namespaces are not resolved (`xml:lang` is read as the literal attribute name
// AppStream writes), entity declarations are not supported, and nothing is validated —
// a malformed document yields whatever tokens can be read, because the caller's job is to
// show a slightly emptier About dialog, never to refuse to open one.

/** An opening (or self-closing) element. */
export interface XmlOpenTag {
    kind: 'open';
    /** Element name exactly as written, prefix included (`xml:lang` is an attribute, not this). */
    name: string;
    /** Attribute values with entities already decoded. */
    attributes: Record<string, string>;
    /** `true` for `<foo/>`, which emits no matching {@link XmlCloseTag}. */
    selfClosing: boolean;
}

/** A closing element. */
export interface XmlCloseTag {
    kind: 'close';
    name: string;
}

/** Character data between elements, with entities already decoded. */
export interface XmlText {
    kind: 'text';
    text: string;
}

export type XmlToken = XmlOpenTag | XmlCloseTag | XmlText;

/** The five entities XML predefines; everything else is a numeric reference or is left alone. */
const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
};

/**
 * Resolve the entity references a metainfo file may contain.
 *
 * An UNKNOWN reference is returned verbatim rather than dropped. A metainfo file is
 * hand-written and `&` is the character most often left unescaped in one; turning
 * `Tom & Jerry` into `Tom ` would silently truncate a developer name, which is exactly
 * the kind of Windows-only difference this module exists to prevent.
 */
export function decodeXmlEntities(text: string): string {
    if (!text.includes('&')) return text;
    return text.replace(/&(#[Xx][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
        if (body.charAt(0) !== '#') return NAMED_ENTITIES[body] ?? whole;
        const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
        // Surrogate halves are not characters; `String.fromCodePoint` accepts them and
        // produces a lone surrogate that breaks every later string operation.
        if (code >= 0xd800 && code <= 0xdfff) return whole;
        return String.fromCodePoint(code);
    });
}

/**
 * Index of the `>` that ends the tag starting at `start`, or `-1`.
 *
 * Quote-aware, because an attribute value may legally contain `>` — AppStream release
 * descriptions and licence strings both do in the wild (`a > b`). Scanning to the first
 * `>` would cut the tag in half and turn the rest of the attribute list into text.
 */
function findTagEnd(xml: string, start: number): number {
    let quote = '';
    for (let i = start + 1; i < xml.length; i++) {
        const ch = xml.charAt(i);
        if (quote) {
            if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '>') {
            return i;
        }
    }
    return -1;
}

const ATTRIBUTE_PATTERN = /([^\s=/<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(source: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    ATTRIBUTE_PATTERN.lastIndex = 0;
    let match = ATTRIBUTE_PATTERN.exec(source);
    while (match !== null) {
        // First wins: a duplicated attribute is malformed XML, and taking the first
        // matches how a real parser reports the document it decided to accept.
        if (!(match[1] in attributes)) attributes[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? '');
        match = ATTRIBUTE_PATTERN.exec(source);
    }
    return attributes;
}

/**
 * Tokenise an XML document.
 *
 * Returns an array rather than a generator on purpose: a metainfo file is a few kilobytes,
 * three bundler targets (`gjs`, `node`, library) have to agree on the output, and an array
 * is the form that needs no iteration-protocol support from any of them.
 */
export function scanXml(xml: string): XmlToken[] {
    const tokens: XmlToken[] = [];
    const pushText = (raw: string): void => {
        if (raw !== '') tokens.push({ kind: 'text', text: decodeXmlEntities(raw) });
    };

    let cursor = 0;
    while (cursor < xml.length) {
        const open = xml.indexOf('<', cursor);
        if (open < 0) {
            pushText(xml.slice(cursor));
            break;
        }
        if (open > cursor) pushText(xml.slice(cursor, open));

        if (xml.startsWith('<!--', open)) {
            const end = xml.indexOf('-->', open + 4);
            cursor = end < 0 ? xml.length : end + 3;
            continue;
        }
        if (xml.startsWith('<![CDATA[', open)) {
            const end = xml.indexOf(']]>', open + 9);
            // CDATA content is NOT entity-decoded — that is the whole point of the section.
            tokens.push({ kind: 'text', text: xml.slice(open + 9, end < 0 ? xml.length : end) });
            cursor = end < 0 ? xml.length : end + 3;
            continue;
        }
        if (xml.startsWith('<?', open)) {
            const end = xml.indexOf('?>', open + 2);
            cursor = end < 0 ? xml.length : end + 2;
            continue;
        }
        if (xml.startsWith('<!', open)) {
            // A doctype. Metainfo files carry no internal subset, so the first `>` ends it.
            const end = xml.indexOf('>', open + 2);
            cursor = end < 0 ? xml.length : end + 1;
            continue;
        }

        const close = findTagEnd(xml, open);
        if (close < 0) {
            // An unterminated tag at EOF: the remainder is not markup any reader can trust,
            // so it is reported as the text it literally is rather than silently dropped.
            pushText(xml.slice(open));
            break;
        }

        const raw = xml.slice(open + 1, close);
        cursor = close + 1;
        if (raw.charAt(0) === '/') {
            const name = raw.slice(1).trim();
            if (name !== '') tokens.push({ kind: 'close', name });
            continue;
        }
        let body = raw;
        let selfClosing = false;
        if (body.endsWith('/')) {
            selfClosing = true;
            body = body.slice(0, -1);
        }
        const nameMatch = /^([^\s/<>]+)/.exec(body);
        if (nameMatch === null) continue;
        const name = nameMatch[1];
        tokens.push({ kind: 'open', name, attributes: parseAttributes(body.slice(name.length)), selfClosing });
    }

    return tokens;
}
