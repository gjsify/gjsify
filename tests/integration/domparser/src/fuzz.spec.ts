// Seeded random markup, diffed against parse5.
//
// The authored corpus in `fixtures.ts` covers the shapes somebody thought of.
// This covers the ones nobody did: it generates hostile markup out of the
// constructs ADR 0026 § 6 claims as IN scope and asserts that not one case
// diverges from the reference. It is what found the three gaps the § 6 list did
// not name — `</br>` (an end tag the spec rewrites into a start tag), the form
// element pointer (`<form><form>` is one form), and the "in select" insertion
// mode, which is still open and is pinned by the `select-with-foreign-markup`
// fixture instead.
//
// The generator EXCLUDES the three algorithms § 6 scopes out — formatting
// elements (adoption agency), table structure (foster parenting) and `<select>`.
// That exclusion is the honest part: including them would turn this file into a
// list of expected failures, which measures nothing. Its ablation is what
// attributes a divergence to a named algorithm rather than to "something".
//
// The seed is fixed and printed on failure, because a fuzz failure that cannot
// be reproduced is a rumour.

import { describe, expect, it } from '@gjsify/unit';
import { canonicalize, DOMParser, domTreeReader } from '@gjsify/domparser';
import { parse } from 'parse5';

import { type Parse5Node, parse5Reader } from './parse5-reader.js';

/** Deliberately without the formatting, table and select families — see header. */
const TAGS = [
    'div',
    'p',
    'ul',
    'li',
    'ol',
    'dl',
    'dt',
    'dd',
    'h1',
    'h2',
    'h3',
    'span',
    'section',
    'article',
    'aside',
    'header',
    'footer',
    'form',
    'input',
    'br',
    'img',
    'hr',
    'meta',
    'link',
    'textarea',
    'title',
    'script',
    'style',
    'template',
    'pre',
    'button',
    'label',
    'nav',
    'main',
    'figure',
    'figcaption',
    'blockquote',
];

const ATTRIBUTES = ['class', 'id', 'href', 'src', 'data-x', 'data-adid', 'type', 'value', 'disabled', 'lang'];
const VALUES = ['a', 'b c', '1', '&amp;', '?x=1&copy=2', 'TEXT', 'de-AT', '"q"', ''];
const TEXTS = ['t', 'a & b', 'x < y', '&nbsp;', '&euro;', '&#34;', '\n  ', '&notanentity;', ']]>', '--\x3e', 'AT&T'];
const NOISE = [
    '<!--c-->',
    '<!DOCTYPE html>',
    '</>',
    '<?php ?>',
    '<![CDATA[x]]>',
    '<!bogus>',
    '</div>',
    '</p>',
    '<',
    '>',
    '&',
    '</script>',
];

/** Deterministic PRNG — the same one the entity fuzz uses. */
function makeRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

function makeGenerator(seed: number): () => string {
    const random = makeRandom(seed);
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
    return () => {
        const parts: string[] = [];
        const open: string[] = [];
        const length = 3 + Math.floor(random() * 25);
        for (let i = 0; i < length; i++) {
            const roll = random();
            if (roll < 0.42) {
                const tag = pick(TAGS);
                let markup = '<' + tag;
                const count = Math.floor(random() * 3);
                for (let k = 0; k < count; k++) {
                    const name = pick(ATTRIBUTES);
                    const value = pick(VALUES);
                    if (random() < 0.2) markup += ' ' + name;
                    else if (random() < 0.3) markup += ' ' + name + '=' + (value.split(' ')[0] || 'x');
                    else markup += ' ' + name + '="' + value + '"';
                }
                // A stray solidus is a parse error the spec IGNORES on an HTML
                // element, so `<div/>` opens a div. Generated on purpose.
                markup += random() < 0.12 ? '/>' : '>';
                parts.push(markup);
                open.push(tag);
            } else if (roll < 0.62 && open.length > 0) {
                parts.push('</' + (random() < 0.8 ? (open.pop() as string) : pick(TAGS)) + '>');
            } else if (roll < 0.85) {
                parts.push(pick(TEXTS));
            } else {
                parts.push(pick(NOISE));
            }
        }
        return parts.join('');
    };
}

const SEEDS = [0x5eed1, 0x11111, 0x22222, 0xabcdef, 0x7fffff];
const CASES_PER_SEED = 600;

export default async () => {
    await describe('domparser vs parse5 — seeded fuzz', async () => {
        for (const seed of SEEDS) {
            await it('agrees on every case from seed 0x' + seed.toString(16), async () => {
                const generate = makeGenerator(seed);
                const divergent: string[] = [];
                let elementsSeen = 0;

                for (let i = 0; i < CASES_PER_SEED; i++) {
                    const html = generate();
                    // HTML has no fatal parse errors: a scraper that gets an
                    // exception instead of a tree has to guess what the page was.
                    const ours = canonicalize(domTreeReader, new DOMParser().parseFromString(html, 'text/html'));
                    const theirs = canonicalize(
                        parse5Reader,
                        parse(html, { scriptingEnabled: false }) as unknown as Parse5Node,
                    );
                    elementsSeen += theirs.split('\n').length;
                    if (ours === theirs) continue;
                    const a = ours.split('\n');
                    const b = theirs.split('\n');
                    let line = 0;
                    while (line < a.length && line < b.length && a[line] === b[line]) line++;
                    if (divergent.length < 3) {
                        divergent.push(
                            'seed 0x' +
                                seed.toString(16) +
                                ' case ' +
                                i +
                                ' line ' +
                                line +
                                '\n  input : ' +
                                JSON.stringify(html) +
                                '\n  ours  : ' +
                                JSON.stringify(a.slice(line, line + 2)) +
                                '\n  parse5: ' +
                                JSON.stringify(b.slice(line, line + 2)),
                        );
                    }
                }

                // The discriminator: a generator that emitted nothing, or an
                // oracle that returned a bare document every time, would agree
                // perfectly. Both trees have to have real depth first.
                expect(elementsSeen).toBeGreaterThan(CASES_PER_SEED * 8);
                expect(divergent.join('\n')).toBe('');
            });
        }
    });
};
