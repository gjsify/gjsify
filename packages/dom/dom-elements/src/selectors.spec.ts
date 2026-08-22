import { describe, expect, it } from '@gjsify/unit';

import { Document } from './document.js';
import type { Element } from './element.js';

/**
 * The four selector methods, over this package's own `Element`.
 *
 * They used to return `null` / `[]` / `false` / `null` unconditionally. Every
 * assertion below therefore names a value that is impossible to produce without
 * walking the tree — "it did not throw" would have passed against the stubs, and
 * so would "it returned no match".
 *
 * The engine itself is verified differentially against `css-select` in
 * `tests/integration/domparser`; what these cover is the ADAPTER — that this
 * node model's parent links, child lists, attribute map and lowercase local
 * names are handed over in the shape the engine expects.
 */
function tree(): { doc: Document; root: Element } {
    const doc = new Document();
    const root = doc.createElement('div');
    root.setAttribute('id', 'root');

    const list = doc.createElement('ul');
    list.setAttribute('class', 'items wide');
    root.appendChild(list);

    for (const [index, name] of ['alpha', 'beta', 'gamma'].entries()) {
        const item = doc.createElement('li');
        item.setAttribute('data-name', name);
        if (index === 1) item.setAttribute('class', 'chosen');
        item.appendChild(doc.createTextNode(name));
        list.appendChild(item);
    }

    const note = doc.createElement('p');
    note.setAttribute('class', 'note');
    note.appendChild(doc.createTextNode('tail'));
    root.appendChild(note);

    return { doc, root };
}

export default async () => {
    await describe('Element selectors', async () => {
        await it('finds by type, and returns them in document order', async () => {
            const { root } = tree();
            const items = root.querySelectorAll('li');
            expect(items.length).toBe(3);
            expect(items[0].getAttribute('data-name')).toBe('alpha');
            expect(items[2].getAttribute('data-name')).toBe('gamma');
        });

        await it('reads the class and id attributes of this node model', async () => {
            const { root } = tree();
            expect(root.querySelectorAll('.items').length).toBe(1);
            expect(root.querySelector('.chosen')?.getAttribute('data-name')).toBe('beta');
            // `#root` is the element the query starts FROM, and a query looks at
            // descendants only — the same rule the DOM has.
            expect(root.querySelector('#root')).toBe(null);
        });

        await it('matches the eight attribute operators through the adapter', async () => {
            const { root } = tree();
            expect(root.querySelectorAll('[data-name]').length).toBe(3);
            expect(root.querySelector('[data-name="beta"]')?.getAttribute('class')).toBe('chosen');
            expect(root.querySelectorAll('[data-name^="g"]').length).toBe(1);
            expect(root.querySelectorAll('[class~="wide"]').length).toBe(1);
        });

        await it('walks parents for combinators, not just children', async () => {
            const { root } = tree();
            // `>` and the descendant combinator both need getParent(); `+` and
            // `~` need the sibling list INCLUDING the text nodes between.
            expect(root.querySelectorAll('ul > li').length).toBe(3);
            expect(root.querySelectorAll('li + li').length).toBe(2);
            expect(root.querySelectorAll('ul ~ p').length).toBe(1);
        });

        await it('counts positions with :nth-child', async () => {
            const { root } = tree();
            expect(root.querySelector('li:nth-child(2)')?.getAttribute('data-name')).toBe('beta');
            expect(root.querySelectorAll('li:last-child').length).toBe(1);
        });

        await it('answers matches() about the element itself', async () => {
            const { root } = tree();
            const chosen = root.querySelector('.chosen')!;
            expect(chosen.matches('li.chosen')).toBe(true);
            expect(chosen.matches('p')).toBe(false);
            // The stub returned false for everything, so only a TRUE here
            // discriminates.
            expect(root.matches('div#root')).toBe(true);
        });

        await it('climbs to an ancestor with closest(), starting at itself', async () => {
            const { root } = tree();
            const chosen = root.querySelector('.chosen')!;
            expect(chosen.closest('li')).toBe(chosen);
            expect(chosen.closest('ul')?.getAttribute('class')).toBe('items wide');
            expect(chosen.closest('div')).toBe(root);
            expect(chosen.closest('table')).toBe(null);
        });

        await it('sees text nodes where the selector asks about them', async () => {
            const { doc, root } = tree();
            const empty = doc.createElement('span');
            root.appendChild(empty);
            // `:empty` is the one selector that fails when the adapter hands over
            // a pre-filtered element list instead of every child node.
            expect(root.querySelectorAll('span:empty').length).toBe(1);
            expect(root.querySelectorAll('li:empty').length).toBe(0);
        });

        await it('reports an unsupported construct instead of matching nothing', async () => {
            const { root } = tree();
            let message = '';
            try {
                root.querySelectorAll('li::before');
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }
            // The whole point of adopting the engine: a selector this package
            // cannot evaluate must say so, not answer `[]` like the stub did.
            expect(message.length > 0).toBe(true);
        });
    });
};
