// `parsePangoMarkup` — the tree, and `stripMarkup` as its reduction.
//
// The point of the tree is that a renderer can build NODES from it. So the rows that
// matter most are the ones a web renderer used to reach with `innerHTML`: `<b>` must come
// back as an ELEMENT (there is something to create), and `<img src=x onerror=…>` /
// `<script>` must come back as NOTHING a renderer could build — the whole parse fails and
// the string stays text, which is what makes the markup property safe rather than merely
// differently-shaped.

import { describe, expect, it } from '@gjsify/unit';

import { escapeMarkup, parsePangoMarkup, stripMarkup } from './pango-markup.js';
import { STRIP_MARKUP_VECTORS } from './conformance/preferences.js';

/** The text of a parsed tree, so a row can state what a renderer would SHOW. */
function textOf(nodes: ReturnType<typeof parsePangoMarkup>): string | null {
    if (nodes === null) return null;
    let text = '';
    const pending = [...nodes].reverse();
    while (pending.length > 0) {
        const node = pending.pop()!;
        if (node.kind === 'text') text += node.text;
        else for (let i = node.children.length - 1; i >= 0; i -= 1) pending.push(node.children[i]!);
    }
    return text;
}

/** Every element node in the tree, in document order. */
function elementsOf(nodes: NonNullable<ReturnType<typeof parsePangoMarkup>>): string[] {
    const tags: string[] = [];
    const pending = [...nodes].reverse();
    while (pending.length > 0) {
        const node = pending.pop()!;
        if (node.kind === 'text') continue;
        tags.push(node.tag);
        for (let i = node.children.length - 1; i >= 0; i -= 1) pending.push(node.children[i]!);
    }
    return tags;
}

export default async () => {
    await describe('parsePangoMarkup — the tree a renderer builds nodes from', async () => {
        await it('<b> comes back as an ELEMENT, which is the whole reason for the tree', () => {
            const nodes = parsePangoMarkup('<b>Dark</b> Style');
            expect(nodes).not.toBe(null);
            expect(elementsOf(nodes!)).toStrictEqual(['b']);
            expect(nodes![0]).toStrictEqual({
                kind: 'element',
                tag: 'b',
                attributes: {},
                children: [{ kind: 'text', text: 'Dark' }],
            });
            expect(nodes![1]).toStrictEqual({ kind: 'text', text: ' Style' });
        });

        await it('every tag pango knows parses, and each nests its own children', () => {
            expect(elementsOf(parsePangoMarkup('<b><i><u><tt><s>x</s></tt></u></i></b>')!)).toStrictEqual([
                'b',
                'i',
                'u',
                'tt',
                's',
            ]);
            expect(elementsOf(parsePangoMarkup('<big><small><sub><sup>x</sup></sub></small></big>')!)).toStrictEqual([
                'big',
                'small',
                'sub',
                'sup',
            ]);
        });

        await it('an attribute on anything but <span> is a parse ERROR, per check_no_attributes', () => {
            expect(parsePangoMarkup('<b class="x">Dark</b>')).toBe(null);
            expect(parsePangoMarkup('<span foreground="red">Dark</span>')).not.toBe(null);
        });

        await it('<span> attributes arrive RESOLVED, so a renderer maps them without re-parsing', () => {
            const nodes = parsePangoMarkup('<span weight="bold" font_family="Sans &amp; Serif">Dark</span>');
            expect(nodes![0]).toMatchObject({
                kind: 'element',
                tag: 'span',
                attributes: { weight: 'bold', font_family: 'Sans & Serif' },
            });
        });

        await it('an entity pango cannot resolve fails the parse rather than reaching a renderer raw', () => {
            expect(parsePangoMarkup('<span weight="a&nosuch">x</span>')).toBe(null);
            expect(parsePangoMarkup('a&nbsp;b')).toBe(null);
        });

        // THE THREE ROWS THAT MADE THIS A PARSER. Each was reachable through `innerHTML`
        // on `<adw-banner>` / `<adw-alert-dialog>`: a tag outside pango's set is not
        // markup, so the parse fails and the caller keeps the string AS TEXT. Nothing here
        // becomes an element, so nothing here can carry an `onerror`.
        await it('a tag pango does not know produces NO element — the raw string, as text', () => {
            for (const markup of [
                '<img src=x onerror="alert(1)">',
                '<script>alert(1)</script>',
                '<div onclick="x">Dark</div>',
                '<svg><animate onbegin="alert(1)"></svg>',
            ]) {
                expect(parsePangoMarkup(markup)).toBe(null);
                // What a renderer falls back to is the string, and `stripMarkup` refuses it
                // for the same reason — so the caller cannot mistake it for parsed text.
                expect(stripMarkup(markup)).toBe(null);
            }
        });

        await it('a comment carrying a tag is passthrough, so it contributes neither text nor element', () => {
            const nodes = parsePangoMarkup('a<!-- <script>x</script> -->b');
            expect(elementsOf(nodes!)).toStrictEqual([]);
            expect(textOf(nodes)).toBe('ab');
        });

        await it('adjacent text runs merge into one node, the way GMarkup hands them over', () => {
            const nodes = parsePangoMarkup('a&amp;b');
            expect(nodes).toStrictEqual([{ kind: 'text', text: 'a&b' }]);
        });

        await it('an explicit <markup> wrapper parses — pango opens one implicitly', () => {
            const nodes = parsePangoMarkup('<markup><b>x</b></markup>');
            expect(elementsOf(nodes!)).toStrictEqual(['markup', 'b']);
            expect(textOf(nodes)).toBe('x');
        });

        await it('a self-closing tag contributes no element and no text — pango has it as EMPTY', () => {
            // `<b/>` parses (pango registers the tag with an empty flag) and produces no
            // content, so the tree drops it: an element with no children would draw nothing
            // and exist only to be counted.
            const nodes = parsePangoMarkup('a<b/>c');
            expect(elementsOf(nodes!)).toStrictEqual([]);
            expect(textOf(nodes)).toBe('ac');
        });

        await it('deep nesting parses iteratively — a renderer must not have to recurse to parse', () => {
            const depth = 500;
            const markup = `${'<b>'.repeat(depth)}x${'</b>'.repeat(depth)}`;
            expect(stripMarkup(markup)).toBe('x');
        });

        await it('empty markup is the EMPTY tree, never null', () => {
            expect(parsePangoMarkup('')).toStrictEqual([]);
            expect(stripMarkup('')).toBe('');
        });

        await it('markup with no text is an element with no children — how a group title hides', () => {
            expect(parsePangoMarkup('<b></b>')).toStrictEqual([
                { kind: 'element', tag: 'b', attributes: {}, children: [] },
            ]);
        });
    });

    await describe('stripMarkup is the reduction over that tree, under the same failures', async () => {
        // The search pipeline's table, re-asserted against the moved function so the
        // extraction cannot have changed one row of it.
        for (const { markup, plain, rule } of STRIP_MARKUP_VECTORS) {
            await it(`${JSON.stringify(markup)} → ${JSON.stringify(plain)} — ${rule}`, () => {
                expect(stripMarkup(markup)).toBe(plain);
            });
        }

        await it('every row that parses has a tree whose text IS the plain text', () => {
            for (const { markup, plain } of STRIP_MARKUP_VECTORS) {
                if (plain === null) continue;
                expect(textOf(parsePangoMarkup(markup))).toBe(plain);
            }
        });
    });

    await describe('escapeMarkup round-trips through the parser', async () => {
        // `create_search_row_subtitle` escapes a page title before it becomes markup, so
        // an escaped title must parse to the title itself — the property that makes a `<`
        // in prose searchable.
        for (const text of ['a < b', 'Tom & Jerry', 'x"y', "it's", '<b>not bold</b>']) {
            await it(`${JSON.stringify(text)} → parses back to itself`, () => {
                expect(stripMarkup(escapeMarkup(text))).toBe(text);
            });
        }

        await it("the escape is GLib's, numeric references for the quote characters", () => {
            expect(escapeMarkup(`'"`)).toBe('&#39;&#34;');
            expect(escapeMarkup('\u007f')).toBe('&#x7f;');
        });
    });
};
