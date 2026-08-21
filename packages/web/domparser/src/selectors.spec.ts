// The selector engine, proved WITHOUT the parser.
//
// The tree here is plain objects behind a test `Adapter`, so a failure in this
// file is a failure of the engine and nothing else — and `selectors-dom.spec.ts`
// cannot hide a selector bug behind a tree bug, or the reverse.
//
// Every positive case asserts the matched IDS, never a count: `3 === 3` is what
// `querySelectorAll('article')` answered on a page whose first article had
// swallowed the other two (ADR 0026 § Context).

import { describe, expect, it } from '@gjsify/unit';
import type { Adapter } from '@gjsify/domparser/selectors';
import { closestSelector, matchesSelector, selectAll, selectOne } from '@gjsify/domparser/selectors';

interface TestNode {
    tag: string | null;
    text: string;
    attrs: Record<string, string>;
    children: TestNode[];
    parent: TestNode | null;
}

function element(tag: string, attrs: Record<string, string>, children: TestNode[] = []): TestNode {
    const node: TestNode = { tag, text: '', attrs, children, parent: null };
    for (const child of children) child.parent = node;
    return node;
}

function text(value: string): TestNode {
    return { tag: null, text: value, attrs: {}, children: [], parent: null };
}

function adapterFor(caseSensitive: boolean): Adapter<TestNode> {
    return {
        caseSensitive,
        isTag: (node) => node.tag !== null,
        getName: (node) => node.tag ?? '',
        getParent: (node) => node.parent,
        getChildren: (node) => node.children,
        getSiblings: (node) => (node.parent === null ? [node] : node.parent.children),
        getAttributeValue: (node, name) => (Object.hasOwn(node.attrs, name) ? node.attrs[name] : null),
        getText: (node) => (node.tag === null ? node.text : node.children.map((c) => c.text).join('')),
    };
}

const HTML = adapterFor(false);
const XML = adapterFor(true);

const ROOT_ELEMENT = element('div', { id: 'root' }, [
    element('section', { id: 's1', class: 'list wrap' }, [
        element('article', { id: 'a1', class: 'aditem', 'data-adid': '10' }, [
            element('h2', { id: 'h1' }, [text('One')]),
            element('p', { id: 'p1', class: 'price big' }, [text('10')]),
        ]),
        element('article', { id: 'a2', class: 'aditem featured', 'data-adid': '20' }, [
            element('h2', { id: 'h2' }, [text('Two')]),
        ]),
        element('article', { id: 'a3', class: 'other', 'data-adid': '30' }, [
            element('p', { id: 'p3', class: 'price' }, [text('30')]),
        ]),
    ]),
    element('aside', { id: 'side', lang: 'de-AT' }, [
        element('ul', { id: 'ul1' }, [
            element('li', { id: 'l1' }, [text('a')]),
            element('li', { id: 'l2' }, [text('b')]),
            element('li', { id: 'l3', class: 'last' }),
        ]),
        element('a', { id: 'lnk', href: '#x' }, [text('link')]),
        element('input', { id: 'in1', type: 'TEXT', disabled: '' }),
        element('input', { id: 'in2', type: 'checkbox', checked: '' }),
    ]),
]);

/**
 * The query root is a non-element container, the shape a `Document` has: it is
 * what makes `#root` the `:root` and keeps the walk's starting node out of its
 * own results.
 */
const ROOT: TestNode = { tag: null, text: '', attrs: {}, children: [ROOT_ELEMENT], parent: null };
ROOT_ELEMENT.parent = ROOT;

/** Every element in the tree; `*` must find all of them and no more. */
const ELEMENTS_IN_TREE = 17;

const ids = (selector: string, adapter: Adapter<TestNode> = HTML): string =>
    selectAll(selector, ROOT, adapter)
        .map((node) => node.attrs.id)
        .join(',');

export default async () => {
    await describe('selectors — the corpus', async () => {
        await it('walks every element under the root', async () => {
            // The discriminator for the whole file: an adapter that reached
            // nothing would leave every assertion below comparing '' with ''.
            expect(selectAll('*', ROOT, HTML).length).toBe(ELEMENTS_IN_TREE);
            expect(ids('article')).toBe('a1,a2,a3');
        });
    });

    await describe('selectors — type, class and id', async () => {
        await it('matches a class without matching its neighbours', async () => {
            expect(ids('.aditem')).toBe('a1,a2');
            expect(ids('.featured')).toBe('a2');
            expect(ids('.item')).toBe('');
        });

        await it('matches an id', async () => {
            expect(ids('#p1')).toBe('p1');
            expect(ids('#nope')).toBe('');
        });

        await it('folds a type name in HTML and keeps it in XML', async () => {
            expect(ids('ARTICLE')).toBe('a1,a2,a3');
            expect(ids('ARTICLE', XML)).toBe('');
            expect(ids('article', XML)).toBe('a1,a2,a3');
        });
    });

    await describe('selectors — the eight attribute operators', async () => {
        await it('exists, equals and not', async () => {
            expect(ids('[data-adid]')).toBe('a1,a2,a3');
            expect(ids('[data-adid="20"]')).toBe('a2');
            expect(ids('[data-adid="99"]')).toBe('');
            expect(ids('article[data-adid!="20"]')).toBe('a1,a3');
        });

        await it('start, end and any', async () => {
            expect(ids('[data-adid^="1"]')).toBe('a1');
            expect(ids('[data-adid$="0"]')).toBe('a1,a2,a3');
            expect(ids('[data-adid*="2"]')).toBe('a2');
            expect(ids('[data-adid^="9"]')).toBe('');
        });

        await it('element and hyphen', async () => {
            expect(ids('[class~="price"]')).toBe('p1,p3');
            expect(ids('[class~="pri"]')).toBe('');
            expect(ids('[lang|="de"]')).toBe('side');
            expect(ids('[lang|="d"]')).toBe('');
        });

        await it('honours the i and s flags over the HTML default', async () => {
            // `type` is one of the attributes HTML compares case-insensitively,
            // so the DEFAULT already matches `TEXT`; `s` is what turns it off.
            expect(ids('[type="text"]')).toBe('in1');
            expect(ids('[type="text" s]')).toBe('');
            expect(ids('[type="TEXT" s]')).toBe('in1');
            expect(ids('[id="IN1" i]')).toBe('in1');
            expect(ids('[id="IN1"]')).toBe('');
        });

        await it('compares values case-sensitively in XML', async () => {
            expect(ids('[type="text"]', XML)).toBe('');
            expect(ids('[type="TEXT"]', XML)).toBe('in1');
        });
    });

    await describe('selectors — combinators', async () => {
        await it('child and descendant differ', async () => {
            expect(ids('section > article')).toBe('a1,a2,a3');
            expect(ids('div > article')).toBe('');
            expect(ids('div article')).toBe('a1,a2,a3');
            expect(ids('section > article > h2')).toBe('h1,h2');
        });

        await it('adjacent and general sibling differ', async () => {
            expect(ids('h2 + p')).toBe('p1');
            expect(ids('li + li')).toBe('l2,l3');
            expect(ids('#l1 ~ li')).toBe('l2,l3');
            expect(ids('#l3 ~ li')).toBe('');
        });
    });

    await describe('selectors — lists', async () => {
        await it('keeps document order and reports each match once', async () => {
            expect(ids('h2, p')).toBe('h1,p1,h2,p3');
            expect(ids('article, .aditem')).toBe('a1,a2,a3');
        });
    });

    await describe('selectors — positional pseudo-classes', async () => {
        await it('first, last and only', async () => {
            expect(ids('li:first-child')).toBe('l1');
            expect(ids('li:last-child')).toBe('l3');
            expect(ids('ul:only-child')).toBe('');
            expect(ids('p:only-of-type')).toBe('p1,p3');
        });

        await it('nth-child with an An+B formula', async () => {
            expect(ids('li:nth-child(2)')).toBe('l2');
            expect(ids('li:nth-child(2n+1)')).toBe('l1,l3');
            expect(ids('li:nth-child(-n+2)')).toBe('l1,l2');
            expect(ids('li:nth-child(odd)')).toBe('l1,l3');
            expect(ids('li:nth-child(even)')).toBe('l2');
            expect(ids('li:nth-last-child(1)')).toBe('l3');
        });

        await it('nth-of-type counts only its own type', async () => {
            expect(ids('article:nth-of-type(2)')).toBe('a2');
            expect(ids('p:nth-of-type(1)')).toBe('p1,p3');
        });

        await it('nth-child(an+b of S) counts only the filtered siblings', async () => {
            expect(ids('article:nth-child(2 of .aditem)')).toBe('a2');
            expect(ids('article:nth-child(1 of .other)')).toBe('a3');
        });

        await it('empty and root', async () => {
            expect(ids('li:empty')).toBe('l3');
            expect(ids(':root')).toBe('root');
        });
    });

    await describe('selectors — functional pseudo-classes', async () => {
        await it('not, is and where', async () => {
            expect(ids('article:not(.aditem)')).toBe('a3');
            expect(ids('p:not(.big)')).toBe('p3');
            expect(ids('article:not(.aditem, .other)')).toBe('');
            expect(ids(':is(h2, p)')).toBe('h1,p1,h2,p3');
            expect(ids(':where(h2, p)')).toBe('h1,p1,h2,p3');
        });

        await it('has, with and without a leading combinator', async () => {
            expect(ids('article:has(.price)')).toBe('a1,a3');
            expect(ids('article:has(> h2)')).toBe('a1,a2');
            expect(ids('article:has(> .price)')).toBe('a1,a3');
            expect(ids('article:has(+ article)')).toBe('a1,a2');
            expect(ids('article:has(~ .other)')).toBe('a1,a2');
            expect(ids('article:has(.nothing)')).toBe('');
        });

        await it('scope names the element the query started from', async () => {
            expect(ids(':scope > div')).toBe('root');
            expect(
                selectAll(':scope > li', ROOT_ELEMENT.children[1].children[0], HTML)
                    .map((n) => n.attrs.id)
                    .join(','),
            ).toBe('l1,l2,l3');
        });

        await it('resolves the attribute-derived form states', async () => {
            expect(ids('input:disabled')).toBe('in1');
            expect(ids('input:enabled')).toBe('in2');
            expect(ids(':checked')).toBe('in2');
            expect(ids(':any-link')).toBe('lnk');
        });
    });

    await describe('selectors — matches, closest and selectOne', async () => {
        const price = selectAll('#p1', ROOT, HTML)[0];

        await it('matches tests the element itself', async () => {
            expect(price).toBeDefined();
            expect(matchesSelector('p.price', price, HTML)).toBeTruthy();
            expect(matchesSelector('article p', price, HTML)).toBeTruthy();
            expect(matchesSelector('p.other', price, HTML)).toBeFalsy();
        });

        await it('closest starts at the element and walks up', async () => {
            expect(closestSelector('.price', price, HTML)!.attrs.id).toBe('p1');
            expect(closestSelector('article', price, HTML)!.attrs.id).toBe('a1');
            expect(closestSelector('table', price, HTML)).toBeNull();
        });

        await it('selectOne returns the first match in document order', async () => {
            expect(selectOne('article', ROOT, HTML)!.attrs.id).toBe('a1');
            expect(selectOne('.nothing', ROOT, HTML)).toBeNull();
        });
    });

    await describe('selectors — what it refuses to guess at', async () => {
        await it('names the construct instead of matching nothing', async () => {
            expect(() => selectAll('a::before', ROOT, HTML)).toThrow('pseudo-element');
            expect(() => selectAll('a:before', ROOT, HTML)).toThrow('pseudo-element');
            expect(() => selectAll('div:hover', ROOT, HTML)).toThrow('user-state');
            expect(() => selectAll('svg|circle', ROOT, HTML)).toThrow('namespace');
            expect(() => selectAll('col || td', ROOT, HTML)).toThrow('column combinator');
            expect(() => selectAll(':frobnicate', ROOT, HTML)).toThrow('unknown pseudo-class');
            expect(() => selectAll('li:nth-child(q)', ROOT, HTML)).toThrow('An+B');
            expect(() => selectAll('[type=', ROOT, HTML)).toThrow();
            expect(() => selectAll('', ROOT, HTML)).toThrow();
        });
    });
};
