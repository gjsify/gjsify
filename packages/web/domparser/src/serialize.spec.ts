// The serializer, asserted as a ROUND TRIP rather than as a string.
//
// A string expectation only says the output looks like it did yesterday. What a
// serializer owes is that reparsing its output gives back the tree it was handed
// — which is exactly the property that broke when character-reference decoding
// landed without it: `<data>x &lt; y</data>` parsed to the text `x < y` and
// serialized back to `<data>x < y</data>`, markup that reparses into a different
// tree and that no assertion in this package could see.

import { describe, expect, it } from '@gjsify/unit';
import { canonicalize, DOMParser, domTreeReader } from '@gjsify/domparser';

const html = (source: string) => new DOMParser().parseFromString(source, 'text/html');
const xml = (source: string) => new DOMParser().parseFromString(source, 'application/xml');

/** Parse, serialize, parse again — the two trees have to be the same tree. */
function roundTrip(source: string, mime: 'text/html' | 'application/xml'): { first: string; second: string } {
    const parse = (text: string) => new DOMParser().parseFromString(text, mime);
    const first = parse(source);
    const second = parse(first.documentElement === null ? first.innerHTML : first.documentElement.outerHTML);
    const shape = (document: ReturnType<typeof parse>) =>
        canonicalize(domTreeReader, document.documentElement ?? document);
    return { first: shape(first), second: shape(second) };
}

export default async () => {
    await describe('serializer — escaping', async () => {
        await it('writes back the three characters that can forge markup', async () => {
            const body = html('<p>a &lt; b &amp; c &gt; d</p>').body!;
            // The discriminator: the text really was decoded, so this is a
            // re-escape and not an untouched echo of the source.
            expect(body.querySelector('p')!.textContent).toBe('a < b & c > d');
            expect(body.innerHTML).toBe('<p>a &lt; b &amp; c &gt; d</p>');
        });

        await it('escapes an attribute value the same way', async () => {
            const a = html('<a href="?x=1&amp;y=2" title="say &quot;hi&quot;">l</a>').querySelector('a')!;
            expect(a.getAttribute('href')).toBe('?x=1&y=2');
            expect(a.outerHTML).toBe('<a href="?x=1&amp;y=2" title="say &quot;hi&quot;">l</a>');
        });

        await it('leaves raw text alone, where an escape would change the code', async () => {
            const doc = html('<script>if (a < b && c) {}</script><style>a[b="c"]{}</style>');
            expect(doc.querySelector('script')!.textContent).toBe('if (a < b && c) {}');
            expect(doc.querySelector('script')!.outerHTML).toBe('<script>if (a < b && c) {}</script>');
            expect(doc.querySelector('style')!.outerHTML).toBe('<style>a[b="c"]{}</style>');
        });

        await it('escapes RCDATA, which is decoded and therefore not raw', async () => {
            const area = html('<textarea>&amp; &lt;</textarea>').querySelector('textarea')!;
            expect(area.textContent).toBe('& <');
            expect(area.outerHTML).toBe('<textarea>&amp; &lt;</textarea>');
        });

        await it('writes a no-break space as a name in HTML and as itself in XML', async () => {
            expect(html('<p>a&nbsp;b</p>').querySelector('p')!.outerHTML).toBe('<p>a&nbsp;b</p>');
            // `&nbsp;` is not one of XML's five names — emitting it there would
            // produce a document no XML parser can read.
            const node = xml('<p>a&#160;b</p>').documentElement!;
            expect(node.textContent).toBe('a b');
            expect(node.outerHTML).toBe('<p>a b</p>');
        });
    });

    await describe('serializer — element shapes', async () => {
        await it('closes an empty HTML element and leaves a void one open', async () => {
            const doc = html('<div id="a"></div><br><img src="x">');
            expect(doc.querySelector('#a')!.outerHTML).toBe('<div id="a"></div>');
            expect(doc.querySelector('br')!.outerHTML).toBe('<br>');
            expect(doc.querySelector('img')!.outerHTML).toBe('<img src="x">');
        });

        await it('keeps the frozen XML self-closing form', async () => {
            // ADR 0026 § Decision 4: the XML output shape does not move.
            expect(xml('<map><layer/></map>').querySelector('layer')!.outerHTML).toBe('<layer/>');
            expect(xml('<map><layer id="1"/></map>').querySelector('layer')!.outerHTML).toBe('<layer id="1"/>');
        });

        await it('keeps comments, which used to be dropped', async () => {
            const div = html('<div><!-- c --><p>x</p></div>').querySelector('div')!;
            expect(div.childNodes.length).toBe(2);
            expect(div.innerHTML).toBe('<!-- c --><p>x</p>');
        });

        await it('serializes a template through its content fragment', async () => {
            const template = html('<template><b>t</b></template>').querySelector('template')!;
            expect(template.childNodes.length).toBe(0);
            expect(template.innerHTML).toBe('<b>t</b>');
            expect(template.outerHTML).toBe('<template><b>t</b></template>');
        });

        await it('keeps an XML CDATA section', async () => {
            const data = xml('<d><![CDATA[raw <x> & y]]></d>').documentElement!;
            expect(data.textContent).toBe('raw <x> & y');
            expect(data.innerHTML).toBe('<![CDATA[raw <x> & y]]>');
        });
    });

    await describe('serializer — round trip', async () => {
        const HTML_CASES = [
            '<div id="a"><img src="?x=1&amp;y=2"><br>text &amp; more</div><div id="b">B</div>',
            '<ul><li>one<li>two &lt; three</ul>',
            '<table><tr><td>1<td>2</tr></table>',
            '<p>3.550&nbsp;&euro; &uuml;ber 28&#034;</p>',
            '<article><script type="application/ld+json">{"a":"<b> & c"}</script><h2>T</h2></article>',
            '<!DOCTYPE html><html lang="de"><head><title>T &amp; T</title></head><body><p>P</p></body></html>',
            '<div><!-- c --><textarea>&amp;</textarea><input disabled value="q&quot;"></div>',
        ];

        for (const source of HTML_CASES) {
            await it('reparses to the same HTML tree: ' + source.slice(0, 40), async () => {
                const { first, second } = roundTrip(source, 'text/html');
                // Discriminator: an empty tree round-trips perfectly and proves
                // nothing, so the shape has to have real depth first.
                expect(first.split('\n').length).toBeGreaterThan(4);
                expect(second).toBe(first);
            });
        }

        const XML_CASES = [
            '<map><property name="c" value="a &amp; b"/><data>x &lt; y &amp;&amp; z</data><empty/></map>',
            '<map version="1.10"><tileset firstgid="1"><image source="t.png"/></tileset></map>',
            '<d><![CDATA[raw <x> & y]]></d>',
        ];

        for (const source of XML_CASES) {
            await it('reparses to the same XML tree: ' + source.slice(0, 40), async () => {
                const { first, second } = roundTrip(source, 'application/xml');
                expect(first.split('\n').length).toBeGreaterThan(1);
                expect(second).toBe(first);
            });
        }

        await it('produces the markup origin/main produced on the frozen path', async () => {
            // The exact strings the XML path emitted before decoding landed. They
            // are what `@excaliburjs/plugin-tiled` reads through `innerHTML`.
            const doc = xml('<map><property value="a &amp; b"/><data>x &lt; y &amp;&amp; z</data><empty/></map>');
            expect(doc.querySelector('data')!.outerHTML).toBe('<data>x &lt; y &amp;&amp; z</data>');
            expect(doc.querySelector('property')!.outerHTML).toBe('<property value="a &amp; b"/>');
            expect(doc.querySelector('empty')!.outerHTML).toBe('<empty/>');
        });
    });
};
