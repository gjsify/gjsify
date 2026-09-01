// `{ pathname, params }` in, the same params out — the property that would have
// caught this before an application did.
//
// The defect: `router.push` took a string only, so an object interpolated as
// `[object Object]`, matched no route, and landed on `+not-found`. No build error, no
// throw, 10 call sites in one application, every one a detail screen reached with a
// parameter.
//
// WHAT MAKES THAT A PROPERTY RATHER THAN A LIST OF CASES. `hrefFrom` writes params
// INTO a pattern and `useLocalSearchParams` reads them back OUT, and the two share
// one definition of what a param is (`paramsSeenBy`). So the check is not "does
// `/detail/[id]` with `{id:'7'}` give `/detail/7`" — it is that for EVERY shape, what
// goes in comes out. A writer and a reader that drift apart is the whole failure, and
// this is the assertion that notices.
//
// PURE, deliberately: nothing here imports React Navigation, React or `gi://`, so the
// property runs with no container mounted and no widget realized. `router.spec.ts`
// carries the same round trip through the REAL navigator, which is the half this
// cannot prove.

import { describe, expect, it } from '@gjsify/unit';

import { RouterError } from './errors.js';
import { hrefFrom, paramsInHref, paramsSeenBy, patternParams, type HrefObject } from './href.js';

/** A param record as a comparable string, with its keys in a fixed order. */
const stable = (record: Record<string, string>): string =>
    JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1))));

const threw = (run: () => unknown): RouterError => {
    try {
        run();
    } catch (error) {
        if (error instanceof RouterError) return error;
        throw error;
    }
    throw new Error('expected a refusal, and nothing was thrown');
};

/**
 * The shapes the round trip is asserted over.
 *
 * Chosen for the ways a URL can lose a value rather than for coverage: a segment that
 * needs encoding, a value that is not a string, a param the pattern has no slot for,
 * and a pattern with more than one slot — which is where an implementation that
 * substituted by ORDER instead of by NAME comes apart.
 */
const ROUND_TRIP: readonly (readonly [string, HrefObject])[] = [
    ['one segment', { pathname: '/detail/[id]', params: { id: '7' } }],
    ['two segments, not in pattern order', { pathname: '/a/[first]/b/[second]', params: { second: 'y', first: 'x' } }],
    ['a number', { pathname: '/detail/[id]', params: { id: 42 } }],
    ['a boolean', { pathname: '/detail/[id]', params: { id: true } }],
    ['a slash in the value', { pathname: '/detail/[id]', params: { id: 'a/b' } }],
    ['an ampersand and a space', { pathname: '/detail/[id]', params: { id: 'a & b' } }],
    ['non-ASCII', { pathname: '/detail/[id]', params: { id: 'Grüße' } }],
    ['a leftover param, which becomes a query', { pathname: '/detail/[id]', params: { id: '7', tab: 'reviews' } }],
    ['only leftovers', { pathname: '/search', params: { q: 'a b', page: 2 } }],
    ['no params at all', { pathname: '/settings' }],
];

export default async () => {
    await describe('an href, in both directions', async () => {
        await it('round-trips every shape — what goes in comes out', async () => {
            // THE VECTOR THIS FILE EXISTS FOR. `paramsSeenBy` is what
            // `useLocalSearchParams` will hand a screen; `paramsInHref` is what the URL
            // carries. If those disagree the application navigates somewhere that looks
            // right and reads back something else.
            const wrong: string[] = [];
            for (const [label, href] of ROUND_TRIP) {
                const url = hrefFrom('push', href);
                const readBack = paramsInHref(href.pathname, url);
                const expected = paramsSeenBy(href.params);
                // SORTED, because a param record has no meaningful key order and
                // `JSON.stringify` has one: the pattern fills its slots left to right
                // while the author's object is in whatever order they wrote it, so an
                // order-sensitive comparison reports a difference that is not one.
                if (stable(readBack) !== stable(expected)) {
                    wrong.push(`${label}: ${url} → ${stable(readBack)} ≠ ${stable(expected)}`);
                }
            }
            expect(wrong).toStrictEqual([]);
            // Not vacuous: an empty case list satisfies an empty problem list, and a
            // case with no params satisfies any writer at all.
            expect(ROUND_TRIP.length > 8).toBe(true);
            expect(Object.keys(paramsSeenBy(ROUND_TRIP[0]?.[1].params)).length).toBe(1);
        });

        await it('substitutes by NAME, not by position', async () => {
            // The case the round trip covers and no single example makes obvious: the
            // params object is unordered, so an implementation that walked the pattern
            // and the values in parallel would pass every one-param test.
            expect(hrefFrom('push', { pathname: '/a/[first]/b/[second]', params: { second: 'y', first: 'x' } })).toBe(
                '/a/x/b/y',
            );
        });

        await it('leaves a string href untouched, query and all', async () => {
            // Not laziness: expo-router's string form is already a URL, and
            // re-encoding one would double-escape a query an author wrote by hand.
            expect(hrefFrom('push', '/detail/7?tab=reviews')).toBe('/detail/7?tab=reviews');
            expect(hrefFrom('push', '/a%20b')).toBe('/a%20b');
        });

        await it('puts what the pattern has no slot for into the query', async () => {
            expect(hrefFrom('push', { pathname: '/detail/[id]', params: { id: '7', tab: 'reviews' } })).toBe(
                '/detail/7?tab=reviews',
            );
        });

        await it('reports the param names a pattern carries', async () => {
            expect(patternParams('/a/[first]/b/[second]')).toStrictEqual(['first', 'second']);
            expect(patternParams('/settings')).toStrictEqual([]);
        });
    });

    await describe('what an href refuses, and why each one is not a silent drop', async () => {
        await it('names the object form when something else arrives', async () => {
            // The message carries the defect's own symptom, because that is what a
            // reader searching for "[object Object]" will have in front of them.
            const error = threw(() => hrefFrom('push', 42 as never));
            expect(error.message).toContain('[object Object]');
            expect(error.message).toContain('+not-found');
        });

        await it('refuses a pattern slot with no param, rather than sending the literal', async () => {
            const error = threw(() => hrefFrom('push', { pathname: '/detail/[id]', params: { other: '1' } }));
            expect(error.message).toContain('"id"');
            expect(error.message).toContain('other');
            // The alternative is what the old code did by accident: send something the
            // router cannot match and let the user land on +not-found.
            expect(error.message).toContain('matches no route');
        });

        await it('refuses a structural value on BOTH sides of the pattern', async () => {
            // A URL segment is a string and so is a query value, so an object could not
            // survive the trip in either direction — which is the same sentence
            // `useLocalSearchParams` has always used for dropping one.
            expect(threw(() => hrefFrom('push', { pathname: '/d/[id]', params: { id: { a: 1 } } })).message).toContain(
                'a URL segment is a string',
            );
            expect(threw(() => hrefFrom('push', { pathname: '/d', params: { q: [1, 2] } })).message).toContain(
                'an array',
            );
        });

        await it('refuses one of React Navigation’s nesting keys as a param name', async () => {
            // `screen`, `params`, `initial`, `state`, `path`, `pop`, `merge`: the filter
            // on the READ side drops them, so sending one is a param that never arrives.
            const error = threw(() => hrefFrom('push', { pathname: '/d', params: { screen: 'x' } }));
            expect(error.message).toContain('nesting keys');
            expect(error.message).toContain('never arrives');
        });

        await it('refuses a catch-all pathname with the file-tree parser’s own answer', async () => {
            const error = threw(() => hrefFrom('push', { pathname: '/blog/[...slug]', params: { slug: 'a' } }));
            expect(error.code).toBe('deep-dynamic-unsupported');
            expect(error.message).toContain('one [param] per segment');
        });

        await it('refuses a pathname that is not a non-empty string', async () => {
            expect(threw(() => hrefFrom('push', { pathname: '' } as never)).message).toContain('non-empty string');
        });
    });

    await describe('the one rule both directions share', async () => {
        await it('stringifies a scalar and drops what a URL cannot carry', async () => {
            expect(paramsSeenBy({ a: 'x', b: 2, c: false })).toStrictEqual({ a: 'x', b: '2', c: 'false' });
            expect(paramsSeenBy({ a: { deep: 1 }, b: [1], c: undefined, d: null })).toStrictEqual({});
            expect(paramsSeenBy(undefined)).toStrictEqual({});
        });

        await it('filters React Navigation’s nesting keys, which are not the author’s', async () => {
            expect(paramsSeenBy({ id: '7', screen: 'x', params: {}, initial: true })).toStrictEqual({ id: '7' });
        });
    });
};
