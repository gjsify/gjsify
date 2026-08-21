// The oracle.
//
// Each fixture is parsed twice — by @gjsify/domparser and by parse5 — and both
// trees are printed by the SAME `canonicalize`, through two readers. The strings
// are compared with `toBe`, so a divergence names the line it happens on.
//
// parse5 runs with `scriptingEnabled: false` because nothing here runs scripts:
// it is the setting our tokenizer already assumes when it refuses to treat
// `<noscript>` as raw text, and running the oracle with the other setting would
// compare two different languages.

import { describe, expect, it } from '@gjsify/unit';
import { canonicalize, DOMParser, domTreeReader } from '@gjsify/domparser';
import type { DOMNode } from '@gjsify/domparser';
import { parse } from 'parse5';

import { FIXTURES } from './fixtures.js';
import { type Parse5Node, parse5Reader } from './parse5-reader.js';

/**
 * What we produce for the fixtures ADR 0026 § 6 scopes out. Committed, and
 * asserted together with `not.toBe(parse5)` — so the day one of these algorithms
 * lands, the test fails and the ledger has to be updated rather than the
 * boundary silently moving.
 */
const DIVERGENT_GOLDENS: Record<string, string> = {
    'misnested-formatting': [
        '#document',
        '  html',
        '    head',
        '    body',
        '      b',
        '        i',
        '          #text "x"',
        '      #text "y"',
    ].join('\n'),
    'foster-parented-table-text': [
        '#document',
        '  html',
        '    head',
        '    body',
        '      table',
        '        #text "text"',
        '        tbody',
        '          tr',
        '            td',
        '              #text "1"',
    ].join('\n'),
    'svg-foreign-content': [
        '#document',
        '  html',
        '    head',
        '    body',
        '      div',
        '        svg viewbox="0 0 1 1"',
        '          circle cx="1"',
        '            rect x="2"',
    ].join('\n'),
};

function countElements(node: DOMNode): number {
    let total = domTreeReader.isElement(node) ? 1 : 0;
    for (const child of domTreeReader.children(node)) total += countElements(child);
    return total;
}

export default async () => {
    await describe('domparser vs parse5 — tree shape', async () => {
        await it('has a corpus that covers both verdicts', async () => {
            // Without this, a corpus that lost its `identical` half would still
            // report a green run.
            expect(FIXTURES.filter((f) => f.expect === 'identical').length).toBeGreaterThan(20);
            expect(FIXTURES.filter((f) => f.expect === 'divergent').length).toBeGreaterThan(2);
        });

        for (const fixture of FIXTURES) {
            await it(fixture.name, async () => {
                const ourDocument = new DOMParser().parseFromString(fixture.html, 'text/html');

                // 1. A fixture that parsed to nothing must not reach the comparison.
                expect(countElements(ourDocument)).toBeGreaterThan(fixture.minElements);

                const ours = canonicalize(domTreeReader, ourDocument);

                // 2. Decoded content, so the comparison is over real text rather
                //    than over two empty strings.
                for (const needle of fixture.mustContain) expect(ours).toContain(needle);

                const theirs = canonicalize(
                    parse5Reader,
                    parse(fixture.html, { scriptingEnabled: false }) as unknown as Parse5Node,
                );
                expect(theirs.split('\n').length).toBeGreaterThan(2);

                if (fixture.expect === 'identical') {
                    expect(ours).toBe(theirs);
                    return;
                }

                expect(ours).toBe(DIVERGENT_GOLDENS[fixture.name]);
                expect(ours).not.toBe(theirs);
            });
        }
    });
};
