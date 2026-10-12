// Pango markup — the parse, headless and shared (ADR 0004).
//
// PANGO MARKUP IS NOT HTML, AND THE DIFFERENCE IS THE WHOLE MODULE. `use-markup` says
// the string is Pango: eleven tag names, `<span>` attributes, five named entities and
// NO scripting, NO `on*` handler, NO `src`. HTML has every one of those, which is why
// the only way this was ever rendered on the web was `innerHTML` — a call that executes
// what the string carries. So the string is PARSED here, into a tree of plain data, and
// a renderer builds nodes out of it. A parser cannot execute anything, and the
// attributes that survive into the tree are inert until a renderer chooses what to do
// with them.
//
// IT IS HERE, NOT IN `preferences.ts`, BECAUSE IT IS NO LONGER PREFERENCES' OWN.
// `stripMarkup` was `make_comparable`'s second half and nothing else; it is now the
// reduction over {@link parsePangoMarkup}, and the tree itself is what
// `Adw.Banner:use-markup` and `Adw.AlertDialog:{heading,body}-use-markup` render from.
// Two renderers, one parse.
//
// PARSE FAILURE IS `null`, NEVER A THROW — that is the C fallback
// (`gtk_label_set_markup` warns and keeps the unparsed string), so a title with a bare
// `&` stays findable and a banner shows what it was given. It is also what makes an
// unknown tag SAFE: `<img src=x onerror=…>` is not markup pango can parse, so the whole
// string comes back as text, never as an element.
//
// Reference: https://docs.gtk.org/Pango/pango_markup.html (the tag and `<span>` attribute
//   set; no `refs/pango` pool — pango_parse_markup, pango_markup_parse_context_push)
// Reference: https://docs.gtk.org/glib/markup.html (GMarkupParser: the entity set, the
//   attribute grammar, passthrough constructs, end_parse on an unclosed element; no
//   `refs/glib` pool)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** The tag names pango's markup parser knows; anything else is a parse ERROR. */
export const PANGO_MARKUP_TAGS = ['markup', 'span', 'b', 'big', 'i', 's', 'sub', 'sup', 'small', 'tt', 'u'] as const;

/** One of {@link PANGO_MARKUP_TAGS} — the only tag names pango's parser accepts. */
export type PangoMarkupTag = (typeof PANGO_MARKUP_TAGS)[number];

const PANGO_MARKUP_TAG_SET: ReadonlySet<string> = new Set<string>(PANGO_MARKUP_TAGS);

/** A piece of parsed markup: either a run of text or an element with its children. */
export type PangoMarkupNode =
    | { readonly kind: 'text'; readonly text: string }
    | {
          readonly kind: 'element';
          readonly tag: PangoMarkupTag;
          /**
           * The element's attributes with their entities RESOLVED. Only `<span>` ever
           * carries any (`check_no_attributes`); an empty object on every other tag is
           * that rule, not a gap.
           */
          readonly attributes: Readonly<Record<string, string>>;
          readonly children: readonly PangoMarkupNode[];
      };

/** The five named entities GMarkup resolves. Everything else must be numeric. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
]);

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9._:-]/;
const XML_SPACE = /[ \t\r\n]/;

/**
 * `g_markup_escape_text` — the escape `create_search_row_subtitle` puts a page title
 * through before it becomes a markup subtitle. GLib emits NUMERIC references for the
 * quote characters (`&#39;`, `&#34;`), not `&apos;`/`&quot;`, so a port that "tidies"
 * those up produces a different string. Control characters become `&#xN;`; GLib's own C1
 * branch is unreachable for valid UTF-8 (it compares a signed `char` against
 * `0x7f`-`0x9f`), so only the ASCII controls are escaped here.
 */
export function escapeMarkup(text: string): string {
    let escaped = '';
    for (const character of text) {
        switch (character) {
            case '&':
                escaped += '&amp;';
                break;
            case '<':
                escaped += '&lt;';
                break;
            case '>':
                escaped += '&gt;';
                break;
            case "'":
                escaped += '&#39;';
                break;
            case '"':
                escaped += '&#34;';
                break;
            default: {
                const codePoint = character.codePointAt(0)!;
                const isControl =
                    (codePoint >= 0x01 && codePoint <= 0x08) ||
                    (codePoint >= 0x0b && codePoint <= 0x0c) ||
                    (codePoint >= 0x0e && codePoint <= 0x1f) ||
                    codePoint === 0x7f;
                escaped += isControl ? `&#x${codePoint.toString(16)};` : character;
            }
        }
    }
    return escaped;
}

/** Where a passthrough construct (`<!-- -->`, `<![CDATA[]]>`, `<? ?>`) ends. */
function passthroughEnd(text: string, start: number): { terminator: string } | null {
    if (text.startsWith('<!--', start)) return { terminator: '-->' };
    if (text.startsWith('<![CDATA[', start)) return { terminator: ']]>' };
    if (text.startsWith('<!', start) || text.startsWith('<?', start)) return { terminator: '>' };
    return null;
}

/** Resolve one `&…;` reference at `start`, or `null` when GMarkup would error. */
function readEntity(text: string, start: number): { value: string; next: number } | null {
    const end = text.indexOf(';', start);
    if (end < 0) return null;

    const body = text.slice(start + 1, end);
    if (body.length === 0) return null;

    if (body.startsWith('#')) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const digits = hex ? body.slice(2) : body.slice(1);
        if (digits.length === 0) return null;
        if (!(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) return null;
        const codePoint = Number.parseInt(digits, hex ? 16 : 10);
        // GMarkup validates the reference is a legal XML character.
        if (codePoint <= 0 || codePoint > 0x10ffff) return null;
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null;
        return { value: String.fromCodePoint(codePoint), next: end + 1 };
    }

    const named = NAMED_ENTITIES.get(body);
    return named === undefined ? null : { value: named, next: end + 1 };
}

/** One start/end tag, as GMarkup hands it to a parser. */
interface MarkupTag {
    name: string;
    closing: boolean;
    selfClosing: boolean;
    attributes: Record<string, string>;
    next: number;
}

/** Read a start or end tag beginning at `<`, or `null` on malformed markup. */
function readTag(text: string, start: number): MarkupTag | null {
    let index = start + 1;
    const closing = text[index] === '/';
    if (closing) index += 1;

    if (index >= text.length || !NAME_START.test(text[index]!)) return null;
    const nameStart = index;
    while (index < text.length && NAME_CHAR.test(text[index]!)) index += 1;
    const name = text.slice(nameStart, index);

    const attributes: Record<string, string> = {};
    let selfClosing = false;
    while (index < text.length) {
        while (index < text.length && XML_SPACE.test(text[index]!)) index += 1;
        const character = text[index];
        if (character === undefined) return null;
        if (character === '>') return { name, closing, selfClosing, attributes, next: index + 1 };
        if (character === '/') {
            if (closing || text[index + 1] !== '>') return null;
            selfClosing = true;
            return { name, closing, selfClosing, attributes, next: index + 2 };
        }
        if (closing) return null; // an end tag carries no attributes

        // attribute: name `=` quoted-value
        if (!NAME_START.test(character)) return null;
        const attributeStart = index;
        while (index < text.length && NAME_CHAR.test(text[index]!)) index += 1;
        const attributeName = text.slice(attributeStart, index);
        while (index < text.length && XML_SPACE.test(text[index]!)) index += 1;
        if (text[index] !== '=') return null;
        index += 1;
        while (index < text.length && XML_SPACE.test(text[index]!)) index += 1;
        const quote = text[index];
        if (quote !== '"' && quote !== "'") return null;
        const valueEnd = text.indexOf(quote, index + 1);
        if (valueEnd < 0) return null;
        // GMarkup resolves entities in an attribute value exactly as it does in text, so
        // `font_family="a&amp;b"` is the family `a&b` and a malformed one is a parse error.
        const value = text.slice(index + 1, valueEnd);
        const decoded = decodeEntities(value);
        if (decoded === null) return null;
        attributes[attributeName] = decoded;
        index = valueEnd + 1;
    }
    return null;
}

/** Every entity in `value` resolved, or `null` when GMarkup would reject one. */
function decodeEntities(value: string): string | null {
    if (!value.includes('&')) return value;
    let decoded = '';
    let index = 0;
    while (index < value.length) {
        const ampersand = value.indexOf('&', index);
        if (ampersand === -1) {
            decoded += value.slice(index);
            break;
        }
        decoded += value.slice(index, ampersand);
        const entity = readEntity(value, ampersand);
        if (!entity) return null;
        decoded += entity.value;
        index = entity.next;
    }
    return decoded;
}

/** An element being filled, bottom-up. */
interface OpenElement {
    tag: PangoMarkupTag;
    attributes: Record<string, string>;
    children: PangoMarkupNode[];
}

/**
 * `pango_parse_markup (text, -1, 0, NULL, &parsed, NULL, &error)`, keeping what the
 * parse PRODUCED instead of only its text: the element tree, with each `<span>`'s
 * attributes resolved.
 *
 * Returns `null` — NEVER throws — when the markup does not parse, which is what makes
 * the caller reproduce the C fallback exactly (`g_critical`, keep the UNPARSED string).
 * An unknown tag, an attribute on anything but `<span>`, a malformed entity, a
 * mismatched or unclosed tag and a bare `&` all land here.
 *
 * Pango wraps the input in an implicit `<markup>` element, so several top-level tags are
 * legal, and unknown tag names are a parse error — which is why this keeps pango's tag
 * list rather than stripping anything tag-shaped: `<3` and `<div>` are TEXT to
 * libadwaita, and a search for them must find them.
 *
 * Deviations, both fail-closed (unparsed → the caller keeps the raw string, never a
 * wrongly-stripped one): pango additionally validates `<span>`'s attribute NAMES, and
 * this does not — an attribute no renderer maps is inert, and a name pango would reject
 * (and therefore show as raw text) renders as styled text instead, which is the safer of
 * the two. GMarkup's DOCTYPE/PI/CDATA handling is modelled as plain passthrough, which is
 * what pango's parser does with it (its `passthrough` handler is NULL, so the content is
 * discarded).
 */
export function parsePangoMarkup(text: string): PangoMarkupNode[] | null {
    const roots: PangoMarkupNode[] = [];
    const open: OpenElement[] = [];
    let pending = '';
    let index = 0;

    /** The list a text run or a new element belongs to. */
    const current = (): PangoMarkupNode[] => (open.length > 0 ? open[open.length - 1]!.children : roots);

    /** Commit the buffered text, MERGING into the run before it (GMarkup hands runs, not characters). */
    const flush = (): void => {
        if (pending === '') return;
        const siblings = current();
        const last = siblings[siblings.length - 1];
        if (last !== undefined && last.kind === 'text')
            siblings[siblings.length - 1] = { kind: 'text', text: last.text + pending };
        else siblings.push({ kind: 'text', text: pending });
        pending = '';
    };

    while (index < text.length) {
        const character = text[index]!;

        if (character === '&') {
            const entity = readEntity(text, index);
            if (!entity) return null;
            pending += entity.value;
            index = entity.next;
            continue;
        }

        if (character !== '<') {
            pending += character;
            index += 1;
            continue;
        }

        const passthrough = passthroughEnd(text, index);
        if (passthrough) {
            const end = text.indexOf(passthrough.terminator, index + 2);
            if (end < 0) return null;
            index = end + passthrough.terminator.length;
            continue;
        }

        const tag = readTag(text, index);
        if (!tag) return null;
        if (!PANGO_MARKUP_TAG_SET.has(tag.name)) return null;
        // `check_no_attributes` — only <span> takes attributes.
        if (Object.keys(tag.attributes).length > 0 && tag.name !== 'span') return null;

        flush();
        if (tag.closing) {
            const finished = open.pop();
            if (finished === undefined || finished.tag !== tag.name) return null;
            current().push({ kind: 'element', ...finished });
        } else if (!tag.selfClosing) {
            open.push({ tag: tag.name as PangoMarkupTag, attributes: tag.attributes, children: [] });
        }
        // A SELF-CLOSING tag contributes nothing: pango registers its tags with an empty
        // flag, so `<b/>` parses and produces no content — and an element node with no
        // children would draw nothing while existing only to be counted.
        index = tag.next;
    }

    // `g_markup_parse_context_end_parse` fails on an unclosed element.
    if (open.length > 0) return null;
    flush();
    return roots;
}

/**
 * The plain text of markup — {@link parsePangoMarkup} reduced to its text runs, and
 * `null` under exactly the same failures. This is what `make_comparable` compares, what
 * `<gtk-label>`/`<gtk-inscription>` show for `use-markup`, and what the C shows when
 * markup does not parse.
 */
export function stripMarkup(text: string): string | null {
    const nodes = parsePangoMarkup(text);
    if (nodes === null) return null;
    let plain = '';
    // Document order out of a stack: both the seed and each element's children go in
    // REVERSED, so the `pop` that drives the walk hands back the next node in reading
    // order. Seeding them as-is concatenates the tail of the tree onto its head.
    const pending = [...nodes].reverse();
    while (pending.length > 0) {
        const node = pending.pop()!;
        if (node.kind === 'text') plain += node.text;
        else for (let i = node.children.length - 1; i >= 0; i -= 1) pending.push(node.children[i]!);
    }
    return plain;
}
