// `parsePangoMarkup` — the tree, and `stripMarkup` as its reduction. Plus
// `parseLabelMarkup` / `stripLabelMarkup`, the same scan with `<a href>` allowed.
//
// The point of the tree is that a renderer can build NODES from it. So the rows that
// matter most are the ones a web renderer used to reach with `innerHTML`: `<b>` must come
// back as an ELEMENT (there is something to create), and `<img src=x onerror=…>` /
// `<script>` must come back as NOTHING a renderer could build — the whole parse fails and
// the string stays text, which is what makes the markup property safe rather than merely
// differently-shaped.
//
// THE TWO ENTRY POINTS MUST STAY APART. `<a>` is `Gtk.Label`'s tag, not pango's, so the
// pango-only parse has to keep REJECTING it: `stripMarkup`'s callers (the search pipeline,
// `Adw.Banner`, `Adw.AlertDialog`, `Gtk.Inscription`) show a string with an `<a>` in it
// raw, exactly as the C does. The block below asserts that divergence directly, because a
// single widened parser is the obvious refactor and it would silently change all four.

import { describe, expect, it } from '@gjsify/unit';

import { escapeMarkup, parseLabelMarkup, parsePangoMarkup, stripLabelMarkup, stripMarkup } from './pango-markup.js';
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

        // THE ALIASES AND SPELLINGS PANGO DOCUMENTS, pinned here because the failure they
        // cause is SILENT and lands on the far side of a fallback: the parser validates no
        // attribute NAME and no attribute VALUE, so a spelling it stopped accepting would
        // return `null` — and a renderer would then show the WHOLE string as text, which is
        // the safe outcome and a silent one. `renderPangoMarkup` is where these are read
        // (pango_markup.html: `font_weight`/`font_style`/`face`/`font_size`, a numeric
        // `weight`, and `size` as 1024ths of a point, `12.5pt` or `200%` since 1.50, plus
        // `smaller`/`larger`); this asserts the parse lets all of them THROUGH.
        for (const [markup, attribute, value] of [
            ['<span font_weight="600">x</span>', 'font_weight', '600'],
            ['<span font_style="italic">x</span>', 'font_style', 'italic'],
            ['<span face="monospace">x</span>', 'face', 'monospace'],
            ['<span font_size="larger">x</span>', 'font_size', 'larger'],
            ['<span size="12288">x</span>', 'size', '12288'],
            ['<span size="12.5pt">x</span>', 'size', '12.5pt'],
            ['<span size="200%">x</span>', 'size', '200%'],
            ['<span size="smaller">x</span>', 'size', 'smaller'],
            ['<span weight="700">x</span>', 'weight', '700'],
        ] as const) {
            await it(`${JSON.stringify(markup)} parses, so it is not shown as a raw string`, () => {
                const nodes = parsePangoMarkup(markup);
                expect(nodes).not.toBe(null);
                expect(nodes![0]).toMatchObject({ kind: 'element', tag: 'span', attributes: { [attribute]: value } });
                expect(stripMarkup(markup)).toBe('x');
            });
        }

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

    await describe('parseLabelMarkup — the same scan, with `<a href>` the one addition', async () => {
        await it('<a> comes back as its OWN kind, carrying the three attributes GTK keeps', () => {
            expect(parseLabelMarkup('<a href="https://gtk.org" title="Docs" class="x">GTK</a>')).toStrictEqual([
                {
                    kind: 'link',
                    href: 'https://gtk.org',
                    title: 'Docs',
                    cssClass: 'x',
                    children: [{ kind: 'text', text: 'GTK' }],
                },
            ]);
        });

        await it('the two optional attributes are null when absent, not missing keys', () => {
            expect(parseLabelMarkup('<a href="https://gtk.org">GTK</a>')).toStrictEqual([
                {
                    kind: 'link',
                    href: 'https://gtk.org',
                    title: null,
                    cssClass: null,
                    children: [{ kind: 'text', text: 'GTK' }],
                },
            ]);
        });

        await it('href arrives RESOLVED, so a `&amp;` in a query string is one character', () => {
            expect(parseLabelMarkup('<a href="https://x/?a=1&amp;b=2">q</a>')).toStrictEqual([
                {
                    kind: 'link',
                    href: 'https://x/?a=1&b=2',
                    title: null,
                    cssClass: null,
                    children: [{ kind: 'text', text: 'q' }],
                },
            ]);
        });

        await it('a missing href FAILS the whole parse — G_MARKUP_ERROR_INVALID_CONTENT', () => {
            expect(parseLabelMarkup('<a>GTK</a>')).toBe(null);
            expect(parseLabelMarkup('<a title="Docs">GTK</a>')).toBe(null);
        });

        await it('a fourth attribute FAILS it too, rather than being ignored', () => {
            // `G_MARKUP_ERROR_UNKNOWN_ATTRIBUTE`: the label then shows the raw string, so
            // an author who writes `target="_blank"` sees the markup, not a silent drop.
            expect(parseLabelMarkup('<a href="https://gtk.org" target="_blank">GTK</a>')).toBe(null);
            expect(parseLabelMarkup('<a href="https://gtk.org" onclick="x()">GTK</a>')).toBe(null);
        });

        await it('pango tags still nest inside a link, and a link inside them', () => {
            expect(parseLabelMarkup('<a href="u"><b>GTK</b></a>')).toStrictEqual([
                {
                    kind: 'link',
                    href: 'u',
                    title: null,
                    cssClass: null,
                    children: [
                        { kind: 'element', tag: 'b', attributes: {}, children: [{ kind: 'text', text: 'GTK' }] },
                    ],
                },
            ]);
            expect(parseLabelMarkup('<b><a href="u">GTK</a></b>')).toStrictEqual([
                {
                    kind: 'element',
                    tag: 'b',
                    attributes: {},
                    children: [
                        {
                            kind: 'link',
                            href: 'u',
                            title: null,
                            cssClass: null,
                            children: [{ kind: 'text', text: 'GTK' }],
                        },
                    ],
                },
            ]);
        });

        await it('a NESTED <a> parses, as it does in the C — the inner one is its own link', () => {
            // GTK's `start_element_handler` does not check for an open link, so this is not
            // an error there either; what the two overlapping ranges draw is the renderer's
            // problem and `label-markup.ts`'s, not the parser's.
            expect(parseLabelMarkup('<a href="o">out<a href="i">in</a></a>')).toStrictEqual([
                {
                    kind: 'link',
                    href: 'o',
                    title: null,
                    cssClass: null,
                    children: [
                        { kind: 'text', text: 'out' },
                        {
                            kind: 'link',
                            href: 'i',
                            title: null,
                            cssClass: null,
                            children: [{ kind: 'text', text: 'in' }],
                        },
                    ],
                },
            ]);
        });

        await it('an unclosed <a> fails, like every other unclosed element', () => {
            expect(parseLabelMarkup('<a href="u">GTK')).toBe(null);
            expect(parseLabelMarkup('<a href="u">GTK</b>')).toBe(null);
        });

        await it('every failure the pango-only parse has, it has too', () => {
            for (const markup of [
                'a < b',
                '<b>unclosed',
                '<blink>x</blink>',
                '<script>alert(1)</script>',
                '<b x="1">y</b>',
            ]) {
                expect(parseLabelMarkup(markup)).toBe(null);
            }
        });
    });

    await describe('parsePangoMarkup still REJECTS <a>, which is what keeps the two apart', async () => {
        // `stripMarkup`'s callers are not labels: `Adw.Banner`, `Adw.AlertDialog`,
        // `Gtk.Inscription` and the search pipeline all run pango's parser alone, and an
        // `<a>` there is an unknown tag. Widening one parser would change all four.
        for (const markup of ['<a href="u">GTK</a>', 'see <a href="u">the docs</a>', '<b><a href="u">x</a></b>']) {
            await it(`${JSON.stringify(markup)} is an unknown tag to pango, so the string stays raw`, () => {
                expect(parsePangoMarkup(markup)).toBe(null);
                expect(stripMarkup(markup)).toBe(null);
            });
        }
    });

    await describe('stripLabelMarkup is gtk_label_get_text — the text with the <a> gone', async () => {
        await it('drops the link tag and keeps its text', () => {
            expect(stripLabelMarkup('see <a href="https://gtk.org">the docs</a>')).toBe('see the docs');
        });

        await it('reduces pango tags and links in one pass', () => {
            expect(stripLabelMarkup('<b>Read</b> <a href="u"><i>this</i></a>')).toBe('Read this');
        });

        await it('is null under the same failures, so the caller keeps the raw string', () => {
            expect(stripLabelMarkup('<a>no href</a>')).toBe(null);
            expect(stripLabelMarkup('a < b')).toBe(null);
        });

        await it('agrees with stripMarkup on everything that has no link in it', () => {
            for (const { markup } of STRIP_MARKUP_VECTORS) {
                expect(stripLabelMarkup(markup)).toBe(stripMarkup(markup));
            }
        });
    });
};
