// The serializer oracle.
//
// parse5's `serialize` implements the same WHATWG fragment-serialization
// algorithm, so the whole `identical` half of the corpus can be pushed through
// both and compared with one `toBe`. That is stronger than any string
// expectation: a serializer that agrees with the reference on 30 documents
// cannot be quietly emitting XHTML slashes or unescaped ampersands.
//
// The comparison is over the BODY, because the two APIs disagree about what a
// document serializes to — `serialize(document)` includes the doctype, our
// `innerHTML` is an element member — and the disagreement is about the entry
// point rather than about the algorithm.

import { describe, expect, it } from '@gjsify/unit';
import { canonicalize, DOMParser, domTreeReader } from '@gjsify/domparser';
import { parse, serialize } from 'parse5';

import { FIXTURES } from './fixtures.js';
import type { Parse5Node } from './parse5-reader.js';

function findBody(node: Parse5Node): Parse5Node | null {
    if (node.tagName === 'body') return node;
    for (const child of node.childNodes ?? []) {
        const found = findBody(child);
        if (found !== null) return found;
    }
    return null;
}

export default async () => {
    await describe('domparser vs parse5 — serialization', async () => {
        for (const fixture of FIXTURES) {
            if (fixture.expect !== 'identical') continue;

            await it(fixture.name, async () => {
                const ours = new DOMParser().parseFromString(fixture.html, 'text/html');
                const theirs = parse(fixture.html, { scriptingEnabled: false }) as unknown as Parse5Node;

                const ourMarkup = ours.body!.innerHTML;
                const theirBody = findBody(theirs);
                expect(theirBody).not.toBeNull();
                const theirMarkup = serialize(theirBody as never);

                // 1. Both sides produced markup. Two empty strings compare equal,
                //    so a fixture that serialized to nothing must not reach the
                //    comparison below.
                expect(theirMarkup.length).toBeGreaterThan(0);
                expect(ourMarkup.length).toBeGreaterThan(0);

                expect(ourMarkup).toBe(theirMarkup);
            });
        }

        await it('reparses its own output into the same tree', async () => {
            // The property a string comparison cannot state: whatever we emit has
            // to parse back to what we emitted it from. Run over the whole corpus,
            // so it covers the shapes the oracle comparison already walks.
            const parser = new DOMParser();
            // Compared at the documentElement, because `outerHTML` starts there:
            // a doctype is a sibling of `<html>` and is not part of what was emitted.
            const shape = (source: string) =>
                canonicalize(domTreeReader, parser.parseFromString(source, 'text/html').documentElement!);
            const mismatches: string[] = [];
            let checked = 0;
            for (const fixture of FIXTURES) {
                if (fixture.expect !== 'identical') continue;
                const first = parser.parseFromString(fixture.html, 'text/html');
                const emitted = first.documentElement!.outerHTML;
                checked++;
                if (shape(emitted) !== canonicalize(domTreeReader, first.documentElement!)) {
                    mismatches.push(fixture.name);
                }
            }
            expect(checked).toBeGreaterThan(20);
            expect(mismatches.join(', ')).toBe('');
        });
    });
};
