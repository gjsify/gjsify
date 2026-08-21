// The oracle for character-reference decoding.
//
// The named table has 2231 entries. Six hand-written expectations cannot show
// that they are all right, and a table that generated EMPTY would still pass
// them: every unknown name is passed through unchanged, so a missing entry
// produces no throw, no red test and a quietly wrong string. The whole table is
// therefore swept against `entities` — the decoder parse5 itself uses — in every
// context, and the sweep counts how many inputs it actually altered so a
// comparison of two no-ops cannot report success (ADR 0026 § 7).
//
// `entities` is a DECLARED devDependency here, not the one parse5 drags in: a
// test whose oracle arrives transitively stops running on the day parse5 changes
// its dependencies, and nothing says so.

import { describe, expect, it } from '@gjsify/unit';
import { decodeAttributeValue, decodeText, decodeXml, NAMED_REFERENCES } from '@gjsify/domparser/entities';
import { decodeHTML, decodeHTMLAttribute, decodeXML } from 'entities';

/**
 * References this file names ITSELF, rather than reading them out of the table
 * under test. The sweeps below iterate `NAMED_REFERENCES`, so a name MISSING from
 * it is a name they never try — measured: deleting `hellip;`, `euro;` and `uuml;`
 * left every sweep green. These are the completeness half, chosen to cover each
 * shape the table has: the five XML names, semicolon-less legacy spellings, a
 * value that is two UTF-16 units, an astral value, a value that IS the separator
 * a packed encoding would want, and the longest name in the spec.
 */
const NAMED_BY_HAND = [
    'amp;',
    'lt;',
    'gt;',
    'quot;',
    'apos;',
    'amp',
    'copy',
    'nbsp',
    'lt',
    'AMP',
    'nbsp;',
    'euro;',
    'hellip;',
    'uuml;',
    'szlig;',
    'auml;',
    'ouml;',
    'copy;',
    'reg;',
    'trade;',
    'mdash;',
    'ndash;',
    'laquo;',
    'raquo;',
    'deg;',
    'middot;',
    'bull;',
    'ldquo;',
    'rdquo;',
    'NotEqualTilde;',
    'fjlig;',
    'ThickSpace;',
    'Afr;',
    'NewLine;',
    'Tab;',
    'CounterClockwiseContourIntegral;',
];

/** The WHATWG table's size. Exact on purpose: the sweeps prove that every name we
 *  HAVE decodes correctly, and only a count can prove we have not quietly lost
 *  one. A change here is a spec change and has to be made deliberately. */
const SPEC_TABLE_SIZE = 2231;

/** The Windows-1252 range HTML re-maps and XML does not — the one place the two
 *  decoders are supposed to disagree, pinned below rather than filtered out. */
const C1_REMAPPED = [
    0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96,
    0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f,
];

/**
 * Empty when the two decoders agreed. Otherwise the count AND the first few
 * cases, so a failure names the input it happened on instead of only saying that
 * some number was not zero.
 */
function report(mismatches: string[]): string {
    if (mismatches.length === 0) return '';
    return `${mismatches.length} mismatch(es); first: ${mismatches.slice(0, 5).join(' | ')}`;
}

function show(input: string, ours: string, theirs: string): string {
    return `${JSON.stringify(input)} -> ours ${JSON.stringify(ours)} vs oracle ${JSON.stringify(theirs)}`;
}

/** Deterministic PRNG: a fuzz failure that cannot be reproduced is a rumour. */
function makeRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

export default async () => {
    await describe('domparser vs entities — character references', async () => {
        await it('has an oracle that decodes', async () => {
            // Every comparison below is only as good as this: an oracle that
            // returned its input would make each of them ours-against-ours.
            expect(decodeHTML('&hellip;')).toBe('…');
            expect(decodeHTMLAttribute('&amp;')).toBe('&');
            expect(decodeXML('&lt;')).toBe('<');
            expect(Object.keys(NAMED_REFERENCES).length).toBe(SPEC_TABLE_SIZE);
        });

        await it('has every name this file asks for by name', async () => {
            // The completeness half. Each name is written out here, so a table that
            // lost it is caught by the name rather than by whichever fixture in the
            // sibling suite happened to use it.
            const missing: string[] = [];
            for (const name of NAMED_BY_HAND) {
                const input = `&${name}`;
                const ours = decodeText(input);
                // It has to RESOLVE — an unknown name decodes to itself, which is
                // exactly what a missing entry looks like.
                if (ours === input) missing.push(input);
                else if (ours !== decodeHTML(input)) missing.push(show(input, ours, decodeHTML(input)));
            }
            expect(report(missing)).toBe('');
            expect(NAMED_BY_HAND.length).toBeGreaterThan(30);
        });

        await it('decodes every name in the table exactly as the oracle does', async () => {
            const names = Object.keys(NAMED_REFERENCES);
            const mismatches: string[] = [];
            let changed = 0;
            for (const name of names) {
                const input = `&${name}`;
                const ours = decodeText(input);
                const theirs = decodeHTML(input);
                if (ours !== input) changed++;
                if (ours !== theirs) mismatches.push(show(input, ours, theirs));
            }
            // Discriminator: the sweep has to have DONE something. A table that
            // generated empty leaves every input untouched and every comparison
            // trivially equal.
            expect(changed).toBeGreaterThan(2000);
            expect(report(mismatches)).toBe('');
        });

        await it('applies the legacy attribute rule per name, as the oracle does', async () => {
            // `&copy=2` in an attribute is a query string, not `©=2`. The rule is
            // per name — the semicolon-less spellings are a 106-entry subset — so
            // it is swept rather than sampled.
            const mismatches: string[] = [];
            let refused = 0;
            for (const name of Object.keys(NAMED_REFERENCES)) {
                const input = `?a=1&${name}=2`;
                const ours = decodeAttributeValue(input);
                const theirs = decodeHTMLAttribute(input);
                if (ours === input) refused++;
                if (ours !== theirs) mismatches.push(show(input, ours, theirs));
            }
            // The semicolon-less names are the ones an attribute must refuse.
            expect(refused).toBeGreaterThan(100);
            expect(report(mismatches)).toBe('');
        });

        await it('decodes numeric references exactly as the oracle does', async () => {
            const inputs: string[] = [];
            for (let code = 0; code <= 0x2100; code++) {
                inputs.push(`&#${code};`, `&#x${code.toString(16)};`, `&#X${code.toString(16).toUpperCase()};`);
            }
            // The boundaries, in both spellings and with the semicolon omitted —
            // HTML decodes a semicolon-less numeric reference anyway.
            for (const code of [0, 0xd7ff, 0xd800, 0xdfff, 0xe000, 0xfffd, 0x10000, 0x10ffff, 0x110000, 0x7fffffff]) {
                inputs.push(`&#${code};`, `&#${code}`, `&#x${code.toString(16)};`, `&#x${code.toString(16)}`);
            }
            inputs.push('&#', '&#x', '&#;', '&#x;', '&#-1;', '&# 1;', '&#0000000065;', '&#99999999999999999999;');

            const mismatches: string[] = [];
            let changed = 0;
            for (const input of inputs) {
                const ours = decodeText(input);
                const theirs = decodeHTML(input);
                if (ours !== input) changed++;
                if (ours !== theirs) mismatches.push(show(input, ours, theirs));
                const oursAttr = decodeAttributeValue(input);
                const theirsAttr = decodeHTMLAttribute(input);
                if (oursAttr !== theirsAttr) mismatches.push(show(input, oursAttr, theirsAttr));
            }
            expect(changed).toBeGreaterThan(8000);
            expect(report(mismatches)).toBe('');
        });

        await it('agrees with the oracle on ampersand soup', async () => {
            // The sweeps above feed one reference at a time. This feeds them in
            // runs, where a decoder can resume at the wrong offset — a class the
            // single-reference cases cannot reach.
            const names = Object.keys(NAMED_REFERENCES);
            const parts = ['&', '#', 'x', ';', '=', '1', 'a', 'Z', ' ', '&#', '&#x', '&&', '</'];
            const random = makeRandom(0x2f6e2b1);
            const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)] as T;

            const mismatches: string[] = [];
            let changed = 0;
            const total = 20000;
            for (let i = 0; i < total; i++) {
                let input = '';
                const length = 1 + Math.floor(random() * 9);
                for (let j = 0; j < length; j++) input += random() < 0.25 ? `&${pick(names)}` : pick(parts);
                const ours = decodeText(input);
                if (ours !== input) changed++;
                if (ours !== decodeHTML(input)) mismatches.push(show(input, ours, decodeHTML(input)));
                const oursAttr = decodeAttributeValue(input);
                if (oursAttr !== decodeHTMLAttribute(input)) {
                    mismatches.push(show(input, oursAttr, decodeHTMLAttribute(input)));
                }
            }
            expect(changed).toBeGreaterThan(total / 4);
            expect(report(mismatches)).toBe('');
        });

        await it('knows no HTML name in XML mode, and the oracle agrees', async () => {
            const mismatches: string[] = [];
            let passedThrough = 0;
            for (const name of Object.keys(NAMED_REFERENCES)) {
                const input = `&${name}`;
                const ours = decodeXml(input);
                const theirs = decodeXML(input);
                if (ours === input) passedThrough++;
                if (ours !== theirs) mismatches.push(show(input, ours, theirs));
            }
            // Only the five predefined names resolve; `&amp` without its semicolon
            // is not one of them, so a handful more than 2231 - 5 pass through.
            expect(passedThrough).toBeGreaterThan(2200);
            expect(report(mismatches)).toBe('');
        });

        await it('refuses the Windows-1252 remap in XML, where the oracle applies it', async () => {
            // A DELIBERATE divergence, pinned as an exact set rather than filtered
            // away: `&#128;` is U+20AC in HTML and U+0080 in XML. Verified against
            // expat, which is neither of these two implementations.
            //
            // Asserted in both directions, so this fails the day either side
            // changes its mind — including the day someone "fixes" ours to match.
            const divergent: number[] = [];
            for (let code = 0; code <= 0x2100; code++) {
                const input = `&#${code};`;
                if (decodeXml(input) !== decodeXML(input)) divergent.push(code);
            }
            expect(divergent.join(',')).toBe(C1_REMAPPED.join(','));

            for (const code of C1_REMAPPED) {
                const input = `&#${code};`;
                // Ours keeps the code point the number names.
                expect(decodeXml(input)).toBe(String.fromCharCode(code));
                // HTML remaps it, and there both decoders agree.
                expect(decodeText(input)).toBe(decodeHTML(input));
                expect(decodeText(input)).not.toBe(String.fromCharCode(code));
            }
        });
    });
};
