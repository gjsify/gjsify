// The HTML tree, asserted by COUNT AND CONTENT together.
//
// A count on its own is green today against a tree that is wrong in exactly the
// way this file exists to fix: the XML scanner answers 3 for
// `querySelectorAll('li')` on `<ul><li>one<li>two<li>three</ul>` with all three
// items nested inside the first, and 27 for `article` on a page whose first
// article's text begins with the JSON-LD of a `<script>` block.
//
// The differential suite in tests/integration/domparser compares whole trees
// against parse5; this file pins the specific behaviours a consumer names.

import { describe, expect, it } from '@gjsify/unit';
import { DOMParser } from '@gjsify/domparser';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

export default async () => {
    await describe('HTML tree — void elements', async () => {
        await it('does not swallow the rest of the document', async () => {
            // The `<br>` and the text AFTER the `<img>` are the discriminator:
            // with `img` missing from the void set, `</div>` still pops it, so a
            // fixture whose image is the LAST child comes out identical either
            // way. Measured — that fixture stayed green with `img` deleted.
            const doc = parse('<div id="a"><img src="x"><br>text</div><div id="b">B</div>');
            const a = doc.querySelectorAll('div')[0];
            const b = doc.querySelectorAll('div')[1];
            expect(doc.querySelectorAll('div').length).toBe(2);
            expect(a.getAttribute('id')).toBe('a');
            expect(a.children.length).toBe(2);
            expect(a.children[0].localName).toBe('img');
            expect(a.children[1].localName).toBe('br');
            expect(a.children[0].children.length).toBe(0);
            expect(a.childNodes[2].nodeValue).toBe('text');
            expect(b.getAttribute('id')).toBe('b');
            expect(b.textContent).toBe('B');
            expect(b.parentElement!.localName).toBe('body');
        });

        await it('gives an attribute-only attribute the empty string', async () => {
            const input = parse('<input disabled value=q>').querySelector('input')!;
            expect(input).not.toBeNull();
            expect(input.hasAttribute('disabled')).toBeTruthy();
            expect(input.getAttribute('disabled')).toBe('');
            expect(input.getAttribute('value')).toBe('q');
        });
    });

    await describe('HTML tree — implied end tags', async () => {
        await it('makes list items siblings, not a chain', async () => {
            const doc = parse('<ul><li>one<li>two<li>three</ul>');
            const items = doc.querySelectorAll('li');
            expect(items.length).toBe(3);
            // The assertion the count cannot make: nested items would put all
            // three strings in the first.
            expect(items[0].textContent).toBe('one');
            expect(items[1].textContent).toBe('two');
            expect(items[2].textContent).toBe('three');
            expect(items[1].parentElement!.localName).toBe('ul');
        });

        await it('keeps a nested list inside its own item', async () => {
            const doc = parse('<ul><li>a<ul><li>b<li>c</ul><li>d</ul>');
            const outer = doc.querySelector('ul')!;
            expect(outer.children.length).toBe(2);
            expect(outer.children[0].textContent).toBe('abc');
            expect(outer.children[1].textContent).toBe('d');
        });

        await it('closes a paragraph on a block element', async () => {
            const doc = parse('<p>a<div>b</div><p>c');
            const paragraphs = doc.querySelectorAll('p');
            expect(paragraphs.length).toBe(2);
            expect(paragraphs[0].textContent).toBe('a');
            expect(paragraphs[1].textContent).toBe('c');
            expect(doc.querySelector('div')!.parentElement!.localName).toBe('body');
        });

        await it('builds table rows and cells, tbody included', async () => {
            const doc = parse('<table><tr><td>1<td>2</tr><tr><td>3</table>');
            const cells = doc.querySelectorAll('td');
            expect(cells.length).toBe(3);
            expect(cells[0].textContent).toBe('1');
            expect(cells[1].textContent).toBe('2');
            expect(cells[2].textContent).toBe('3');
            expect(doc.querySelectorAll('tr').length).toBe(2);
            expect(cells[0].parentElement!.parentElement!.localName).toBe('tbody');
        });

        await it('reopens a br for a stray end tag', async () => {
            // `</br>` is the spec's one end-tag-to-start-tag rewrite. Dropping it
            // loses a line break on every `<br></br>` in the wild — found by a
            // seeded fuzz run against parse5, not by reading the spec.
            const doc = parse('<div>x<br></br>y</div>');
            const breaks = doc.querySelectorAll('br');
            expect(breaks.length).toBe(2);
            expect(doc.querySelector('div')!.childNodes.length).toBe(4);
            expect(doc.querySelector('div')!.textContent).toBe('xy');
        });

        await it('ignores a form nested inside a form', async () => {
            // The form element pointer: `<form><form>` is ONE form everywhere.
            // The paragraphs are the discriminator — a parser that dropped the
            // whole token rather than only the element would lose them too.
            const doc = parse('<form><p>a</p><form><p>b</p></form></form>');
            expect(doc.querySelectorAll('form').length).toBe(1);
            const paragraphs = doc.querySelectorAll('p');
            expect(paragraphs.length).toBe(2);
            expect(paragraphs[1].parentElement!.localName).toBe('form');
        });

        await it('closes definition terms against one another', async () => {
            const doc = parse('<dl><dt>t1<dd>d1<dt>t2<dd>d2</dl>');
            expect(doc.querySelectorAll('dt').length).toBe(2);
            expect(doc.querySelectorAll('dd').length).toBe(2);
            expect(doc.querySelectorAll('dd')[0].textContent).toBe('d1');
        });
    });

    await describe('HTML tree — raw text', async () => {
        await it('keeps a JSON-LD block inside its script', async () => {
            const doc = parse(
                '<article><script type="application/ld+json">{"a":"<b> & c"}</script><h2>T</h2></article>',
            );
            const article = doc.querySelector('article')!;
            expect(article.children.length).toBe(2);

            const script = doc.querySelector('script')!;
            // The markup and the ampersand survive verbatim: raw text is neither
            // parsed nor entity-decoded.
            expect(script.textContent).toBe('{"a":"<b> & c"}');

            const h2 = doc.querySelector('h2')!;
            expect(h2.textContent).toBe('T');
            // The measured leak: with the XML scanner the heading ended up INSIDE
            // the script's text, not beside it.
            expect(h2.parentElement!.localName).toBe('article');
        });

        await it('reads script markup as text, not as tags', async () => {
            const doc = parse('<script>var a = 1 < 2 && 3 > 4;</script><p>after</p>');
            expect(doc.querySelector('script')!.textContent).toBe('var a = 1 < 2 && 3 > 4;');
            expect(doc.querySelector('p')!.textContent).toBe('after');
        });

        await it('decodes RCDATA and leaves RAWTEXT alone', async () => {
            const doc = parse('<style>a{content:"&amp;"}</style><textarea>&amp;</textarea>');
            expect(doc.querySelector('style')!.textContent).toBe('a{content:"&amp;"}');
            expect(doc.querySelector('textarea')!.textContent).toBe('&');
        });
    });

    await describe('HTML tree — entities', async () => {
        await it('decodes text content', async () => {
            const doc = parse('<p>3.550&nbsp;&euro; &uuml;ber 28&#034; &hellip;</p>');
            const text = doc.querySelector('p')!.textContent;
            expect(text).toContain('€');
            expect(text).toContain('über');
            expect(text).toContain('28"');
            expect(text).toContain('…');
            expect(text).not.toContain('&');
        });

        await it('leaves a query string in an attribute alone', async () => {
            const doc = parse('<a href="?a=1&copy=2">x</a><a href="?a=1&copy;=2">y</a>');
            const links = doc.querySelectorAll('a');
            expect(links.length).toBe(2);
            expect(links[0].getAttribute('href')).toBe('?a=1&copy=2');
            expect(links[1].getAttribute('href')).toBe('?a=1©=2');
        });
    });

    await describe('HTML tree — document structure', async () => {
        await it('supplies html, head and body for a bare fragment', async () => {
            const doc = parse('hello <b>world</b>');
            expect(doc.documentElement!.tagName).toBe('HTML');
            expect(doc.documentElement!.localName).toBe('html');
            expect(doc.head).not.toBeNull();
            expect(doc.body).not.toBeNull();
            expect(doc.body!.textContent).toBe('hello world');
        });

        await it('reads the doctype and puts the title in the head', async () => {
            const doc = parse(
                '<!DOCTYPE html><html lang="de"><head><title>T &amp; T</title></head><body><p>P</p></body></html>',
            );
            expect(doc.doctype).not.toBeNull();
            expect(doc.doctype!.name).toBe('html');
            expect(doc.documentElement!.getAttribute('lang')).toBe('de');
            expect(doc.head!.querySelector('title')!.textContent).toBe('T & T');
            expect(doc.body!.querySelector('p')!.textContent).toBe('P');
        });

        await it('keeps comments as nodeType 8 in childNodes', async () => {
            const doc = parse('<!DOCTYPE html><!-- c --><p>x');
            const comments = doc.childNodes.filter((n) => n.nodeType === 8);
            expect(comments.length).toBe(1);
            expect(comments[0].nodeValue).toBe(' c ');
            expect(doc.querySelector('p')!.textContent).toBe('x');
        });

        await it('does not reach into a template', async () => {
            const doc = parse('<template><span>t</span></template><span>s</span>');
            const spans = doc.querySelectorAll('span');
            expect(spans.length).toBe(1);
            expect(spans[0].textContent).toBe('s');

            const template = doc.querySelector('template')!;
            expect(template.childNodes.length).toBe(0);
            expect(template.content).toBeDefined();
            expect(template.content!.childNodes.length).toBe(1);
        });

        await it('closes what the document left open at EOF', async () => {
            const doc = parse('<div><span>x');
            expect(doc.querySelector('span')!.textContent).toBe('x');
            expect(doc.querySelector('span')!.parentElement!.localName).toBe('div');
        });

        await it('inserts an empty paragraph for a stray </p>', async () => {
            const doc = parse('<div></p>x</div>');
            const p = doc.querySelector('p')!;
            expect(p).not.toBeNull();
            expect(p.childNodes.length).toBe(0);
            expect(doc.querySelector('div')!.textContent).toBe('x');
        });
    });

    await describe('HTML tree — casing', async () => {
        await it('uppercases tagName and lowercases localName and attributes', async () => {
            const doc = parse('<DIV CLASS="a" data-X="1">t</DIV>');
            const div = doc.querySelector('div')!;
            expect(div).not.toBeNull();
            expect(div.tagName).toBe('DIV');
            expect(div.localName).toBe('div');
            expect(div.className).toBe('a');
            expect(div.getAttribute('data-x')).toBe('1');
        });

        await it('keeps the FIRST of two identically named attributes', async () => {
            const a = parse('<a HREF="x" href="y">l</a>').querySelector('a')!;
            expect(a.getAttribute('href')).toBe('x');
        });
    });

    await describe('DOMParser.parseFromString — mimeType', async () => {
        await it('gives the same input two different trees', async () => {
            // The whole feature in one assertion: the argument used to be ignored.
            const source = '<ul><li>a<li>b</ul>';
            const html = new DOMParser().parseFromString(source, 'text/html');
            const xml = new DOMParser().parseFromString(source, 'application/xml');

            expect(html.querySelectorAll('li')[0].textContent).toBe('a');
            expect(html.querySelectorAll('li').length).toBe(2);

            expect(xml.querySelectorAll('li').length).toBe(2);
            expect(xml.querySelectorAll('li')[0].textContent).toBe('ab');
        });

        await it('throws on a type the enum does not have', async () => {
            const parser = new DOMParser();
            expect(() => parser.parseFromString('<x/>', 'application/json')).toThrow();
            let message = '';
            try {
                parser.parseFromString('<x/>', 'application/json');
            } catch (error) {
                message = String(error);
            }
            expect(message).toContain('text/html');
            expect(message).toContain('application/xml');
            expect(message).toContain('image/svg+xml');
        });
    });
};
