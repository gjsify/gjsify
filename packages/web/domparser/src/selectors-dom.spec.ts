// The engine wired to the DOM, on the shapes that were MEASURED wrong.
//
// Every number in the left column below is what this package answered before the
// engine landed, on markup taken from a real 329 KB listing page (ADR 0026
// § Context) — the selector was compared to a tag name and nothing else:
//
//   .aditem            0        [data-adid]        0        [class*="item"]  0
//   article, aside     0        article > h2       0        map > layer      null
//
// So each assertion below names the elements it found, never just how many.

import { describe, expect, it } from '@gjsify/unit';
import { DOMParser } from '@gjsify/domparser';

const PAGE =
    '<section id="results">' +
    '<article class="aditem" data-adid="1"><h2>One</h2><p class="price">10 &euro;</p></article>' +
    '<article class="aditem featured" data-adid="2"><h2>Two</h2><p class="price">20 €</p></article>' +
    '<article class="aditem" data-adid="13"><h2>Three</h2></article>' +
    '</section>' +
    '<aside id="side"><a class="pagelink" href="?page=2">next</a></aside>';

const page = () => new DOMParser().parseFromString(PAGE, 'text/html');
const adids = (elements: { getAttribute(name: string): string | null }[]): string =>
    elements.map((el) => el.getAttribute('data-adid') ?? '?').join(',');

const TMX =
    '<?xml version="1.0"?><map version="1.0" tiledversion="1.9">' +
    '<tileset firstgid="1" name="Terrain"><image source="t.png"/></tileset>' +
    '<layer id="1" name="Ground"><data encoding="csv">1,2</data></layer>' +
    '<layer id="2" name="Sky"/></map>';

export default async () => {
    await describe('querySelectorAll — class, id and attribute', async () => {
        await it('finds a class, which used to answer nothing at all', async () => {
            const items = page().querySelectorAll('.aditem');
            expect(items.length).toBe(3);
            expect(adids(items)).toBe('1,2,13');
        });

        await it('finds an attribute and its prefix, suffix and substring forms', async () => {
            const doc = page();
            expect(adids(doc.querySelectorAll('[data-adid]'))).toBe('1,2,13');
            expect(adids(doc.querySelectorAll('[data-adid^="1"]'))).toBe('1,13');
            expect(adids(doc.querySelectorAll('[data-adid$="3"]'))).toBe('13');
            // Position, not presence: `1`/`2`/`13` answer the same for all three
            // operators, so a `^=` quietly degraded to `*=` stayed green on the
            // two lines above. These two put the digit where only one can find it.
            expect(adids(doc.querySelectorAll('[data-adid^="3"]'))).toBe('');
            expect(adids(doc.querySelectorAll('[data-adid$="1"]'))).toBe('1');
            expect(adids(doc.querySelectorAll('[class*="item"]'))).toBe('1,2,13');
            expect(adids(doc.querySelectorAll('[class~="featured"]'))).toBe('2');
        });

        await it('reads a query string out of an attribute unharmed', async () => {
            expect(page().querySelector('a[href^="?page="]')!.getAttribute('href')).toBe('?page=2');
        });
    });

    await describe('querySelectorAll — lists and combinators', async () => {
        await it('returns a list in document order', async () => {
            const found = page().querySelectorAll('section, aside');
            expect(found.map((el) => el.getAttribute('id')).join(',')).toBe('results,side');
        });

        await it('walks the four combinators', async () => {
            const doc = page();
            expect(doc.querySelectorAll('article > h2').length).toBe(3);
            expect(doc.querySelector('article > h2')!.textContent).toBe('One');
            expect(doc.querySelectorAll('section h2').length).toBe(3);
            expect(doc.querySelector('h2 + p')!.textContent).toBe('10 €');
            expect(adids(doc.querySelectorAll('.featured ~ article'))).toBe('13');
        });

        await it('answers :has() about a subtree', async () => {
            expect(adids(page().querySelectorAll('article:has(.price)'))).toBe('1,2');
            expect(adids(page().querySelectorAll('article:not(:has(.price))'))).toBe('13');
        });
    });

    await describe('Element.matches, closest and the by-name lookups', async () => {
        await it('closest walks up from the element itself', async () => {
            const price = page().querySelector('.price')!;
            expect(price.textContent).toBe('10 €');
            expect(price.closest('article')!.getAttribute('data-adid')).toBe('1');
            expect(price.closest('.price')!.getAttribute('class')).toBe('price');
            expect(price.closest('table')).toBeNull();
        });

        await it('matches tests the element and not its descendants', async () => {
            const article = page().querySelector('article')!;
            expect(article.matches('.aditem')).toBeTruthy();
            expect(article.matches('section > article')).toBeTruthy();
            expect(article.matches('.price')).toBeFalsy();
        });

        await it('getElementById and getElementsByClassName run through the engine', async () => {
            const doc = page();
            expect(doc.getElementById('side')!.localName).toBe('aside');
            expect(doc.getElementById('nope')).toBeNull();
            expect(adids(doc.getElementsByClassName('aditem'))).toBe('1,2,13');
            expect(adids(doc.getElementsByClassName('aditem featured'))).toBe('2');
        });
    });

    await describe('querySelectorAll — scoping', async () => {
        await it('searches descendants only, never the element itself', async () => {
            const section = page().querySelector('#results')!;
            expect(section.querySelectorAll('section').length).toBe(0);
            expect(adids(section.querySelectorAll('article'))).toBe('1,2,13');
        });

        await it('matches an ancestor above the element it was called on', async () => {
            // The spec matches against the whole tree and then keeps the
            // descendants — so `section article` still resolves its `section`.
            const section = page().querySelector('#results')!;
            expect(adids(section.querySelectorAll('section article'))).toBe('1,2,13');
        });

        await it('does not reach into a template', async () => {
            const doc = new DOMParser().parseFromString(
                '<template><b class="t">x</b></template><b class="s">y</b>',
                'text/html',
            );
            const found = doc.querySelectorAll('b');
            expect(found.length).toBe(1);
            expect(found[0].getAttribute('class')).toBe('s');
        });
    });

    await describe('querySelectorAll — HTML folds case, XML does not', async () => {
        await it('matches an uppercase type selector in HTML', async () => {
            expect(page().querySelectorAll('ARTICLE').length).toBe(3);
        });

        await it('keeps the XML tree case-sensitive', async () => {
            const xml = new DOMParser().parseFromString(TMX, 'application/xml');
            expect(xml.querySelectorAll('layer').length).toBe(2);
            expect(xml.querySelectorAll('LAYER').length).toBe(0);
        });
    });

    await describe('querySelector on an XML document', async () => {
        await it('resolves a child combinator that used to answer null', async () => {
            const xml = new DOMParser().parseFromString(TMX, 'application/xml');
            expect(xml.querySelectorAll('map > layer').length).toBe(2);
            expect(xml.querySelector('map > layer')!.getAttribute('name')).toBe('Ground');
            expect(xml.querySelector('layer > data')!.textContent).toBe('1,2');
            expect(xml.querySelector('tileset > image')!.getAttribute('source')).toBe('t.png');
        });

        await it('selects XML attributes by their own case', async () => {
            const xml = new DOMParser().parseFromString(TMX, 'application/xml');
            expect(xml.querySelector('[name="Ground"]')!.localName).toBe('layer');
            expect(xml.querySelectorAll('[name="ground"]').length).toBe(0);
            expect(xml.querySelectorAll('layer[id]').length).toBe(2);
        });
    });

    await describe('querySelector — an unreadable selector throws', async () => {
        await it('never answers an empty list for something it could not parse', async () => {
            const doc = page();
            expect(() => doc.querySelectorAll('article::first-line')).toThrow('pseudo-element');
            expect(() => doc.querySelector('article:focus')).toThrow('user-state');
        });
    });
};
