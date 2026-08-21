// The selector oracle.
//
// Matches are compared by their INDEX PATH, never by how many there were: a
// count cannot tell two engines apart that found the same NUMBER of different
// elements, and `27 === 27` was green against the tree this parser replaces
// (ADR 0026 § Context).
//
// css-select reads a parse5 tree built with the htmlparser2 adapter, so it runs
// on its OWN default adapter — no code of this suite's sits between the oracle
// and its tree. That the two trees are node-for-node comparable is asserted per
// fixture, not assumed.

import { describe, expect, it } from '@gjsify/unit';
import { DOMParser, domTreeReader } from '@gjsify/domparser';
import type { DOMNode } from '@gjsify/domparser';
import { selectAll } from 'css-select';
import type { AnyNode, Element as OracleElement } from 'domhandler';
import { parse } from 'parse5';
import { adapter as htmlparser2Adapter } from 'parse5-htmlparser2-tree-adapter';

import { FIXTURES } from './fixtures.js';

/**
 * Run against every fixture; the sweep asserts each one matched SOMEWHERE, so a
 * selector that is quietly wrong everywhere cannot ride along as a green line.
 *
 * `:scope`, `:enabled` and `:nth-child(an+b of S)` are deliberately absent: the
 * first is context-dependent, and css-select answers the other two by rules of
 * its own (`:enabled` is `:not(:disabled)` there, so it matches a `div`; `of S`
 * it does not parse). The package's own spec covers all three.
 */
const SELECTORS = [
    '*',
    'article',
    '.aditem',
    '#results',
    '[data-adid]',
    '[data-adid^="1"]',
    '[data-adid$="3"]',
    '[data-adid!="2"]',
    '[class*="item"]',
    '[class~="price"]',
    '[lang|="de"]',
    '[type="text"]',
    '[type="text" s]',
    '[href^="?"]',
    'article, aside',
    'section > article',
    'section article',
    'h2 + p',
    'li ~ li',
    'li:first-child',
    'li:last-child',
    'li:nth-child(2)',
    'li:nth-child(2n+1)',
    'li:nth-last-child(1)',
    'td:nth-of-type(2)',
    'p:only-of-type',
    'li:empty',
    ':root',
    'article:has(.price)',
    'article:has(> h2)',
    'article:not(.aditem)',
    ':is(h1, h2, h3)',
    'html > body',
    'head > title',
    'script[type$="json"]',
    'input[disabled]',
    'option[selected]',
    'a[href]',
    'div p',
    'ul > li:last-child',
    '.aditem .price',
];

/**
 * `<template>` is left out of the sweep, and the reason is the ORACLE's tree,
 * not the engine: the htmlparser2 adapter hangs a template's content in
 * `children`, so css-select walks into it, while the DOM — and this parser —
 * keep it in a separate fragment `querySelectorAll` does not enter. The one test
 * below states both answers rather than hiding the difference behind a skip.
 */
const OUTSIDE_THE_SWEEP = 'template';

/** 590 measured over the corpus today; a lower bound, because adding a fixture
 *  legitimately raises it and a sweep that matched far less has stopped working. */
const MINIMUM_TOTAL_MATCHES = 500;

type OracleNode = AnyNode;

function isOracleElement(node: OracleNode): boolean {
    return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function oracleChildren(node: OracleNode): OracleNode[] {
    return (node as unknown as { children?: OracleNode[] }).children ?? [];
}

/** Index path per element, keyed by the node. Walked top-down, because one of
 *  the two trees does not link a child back (a template's content fragment). */
function indexPaths<TNode>(
    root: TNode,
    children: (node: TNode) => TNode[],
    isElement: (node: TNode) => boolean,
): Map<TNode, string> {
    const paths = new Map<TNode, string>();
    const walk = (node: TNode, prefix: string): void => {
        const kids = children(node);
        for (let i = 0; i < kids.length; i++) {
            const path = prefix + '/' + i;
            if (isElement(kids[i])) paths.set(kids[i], path);
            walk(kids[i], path);
        }
    };
    walk(root, '');
    return paths;
}

/** `path name` per element, in document order — the comparable shape of a tree. */
function structure<TNode>(paths: Map<TNode, string>, name: (node: TNode) => string): string {
    return [...paths].map(([node, path]) => path + ' ' + name(node)).join('\n');
}

export default async () => {
    let totalMatches = 0;
    const selectorsThatMatched = new Set<string>();

    await describe('domparser vs css-select — selectors', async () => {
        for (const fixture of FIXTURES) {
            if (fixture.expect !== 'identical' || fixture.name === OUTSIDE_THE_SWEEP) continue;

            await it(fixture.name, async () => {
                const ourDocument = new DOMParser().parseFromString(fixture.html, 'text/html');
                const ourPaths = indexPaths<DOMNode>(ourDocument, domTreeReader.children, domTreeReader.isElement);

                const oracleDocument = parse(fixture.html, {
                    treeAdapter: htmlparser2Adapter,
                    scriptingEnabled: false,
                }) as unknown as OracleNode;
                const oraclePaths = indexPaths<OracleNode>(oracleDocument, oracleChildren, isOracleElement);

                // 1. Without this the path comparison below would be comparing
                //    coordinates in two different trees.
                expect(ourPaths.size).toBeGreaterThan(fixture.minElements);
                expect(structure(ourPaths, (node) => domTreeReader.name(node))).toBe(
                    structure(oraclePaths, (node) => (node as OracleElement).name),
                );

                for (const selector of SELECTORS) {
                    const oracle = selectAll(selector, oracleDocument as never)
                        .map((match: OracleElement) => oraclePaths.get(match as unknown as OracleNode))
                        .join(' ');
                    const ours = ourDocument
                        .querySelectorAll(selector)
                        .map((match) => ourPaths.get(match as unknown as DOMNode))
                        .join(' ');
                    // 2. `toBe` on the paths, so a difference names WHERE.
                    expect(selector + ' => ' + ours).toBe(selector + ' => ' + oracle);

                    if (oracle !== '') {
                        selectorsThatMatched.add(selector);
                        totalMatches += oracle.split(' ').length;
                    }
                }
            });
        }

        await it('every selector in the sweep matched something', async () => {
            // The discriminator for the whole file: two engines that both found
            // nothing agree perfectly, and a corpus can drift into exactly that.
            const silent = SELECTORS.filter((selector) => !selectorsThatMatched.has(selector));
            expect(silent.join(', ')).toBe('');
            expect(totalMatches).toBeGreaterThan(MINIMUM_TOTAL_MATCHES);
        });

        await it('does not follow the oracle into a <template>', async () => {
            const html = '<template><span class="t">t</span></template><span class="s">s</span>';
            const oracleDocument = parse(html, {
                treeAdapter: htmlparser2Adapter,
                scriptingEnabled: false,
            }) as unknown as OracleNode;

            // The htmlparser2 tree adapter puts template content in `children`,
            // so css-select reaches it; the DOM says `querySelectorAll` must not.
            expect(selectAll('span', oracleDocument as never).length).toBe(2);
            const ours = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('span');
            expect(ours.length).toBe(1);
            expect(ours[0].getAttribute('class')).toBe('s');
        });
    });
};
