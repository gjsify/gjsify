// The map merge, on maps built by hand — because the interesting cases are the ones
// `@vue/compiler-sfc` does not happen to produce.
//
// `compile.spec.ts` asserts the merge against the real compiler, which is the evidence
// that matters and is also blind to everything below: one source, no names, and a script
// half that always carries a map. Here the chunks are written out, so the delta encoding
// is exercised where it actually bites — a second source, a name index, a chunk with no
// map between two that have one, and the two malformed shapes that must be refused
// rather than read as a mapping to line 1.

import { describe, expect, it } from '@gjsify/unit';

import { type CombinedSourceMap, combineSourceMaps, originalPositionFor } from './source-map.js';

/** A one-line map: generated line 1 column 1 ← `source` line/column (both 1-based). */
function oneMapping(source: string, line: number, column: number, name?: string) {
    // `AAAA` is [0,0,0,0]: generated column 0 ← source 0, line 0, column 0. The fixtures
    // below shift it by writing the deltas out, which is what keeps this readable.
    const vlq = (value: number) => {
        let rest = value < 0 ? -value * 2 + 1 : value * 2;
        let out = '';
        do {
            const digit = rest % 32;
            rest = Math.floor(rest / 32);
            out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[rest > 0 ? digit + 32 : digit];
        } while (rest > 0);
        return out;
    };
    return {
        sources: [source],
        sourcesContent: [`// ${source}`],
        names: name === undefined ? [] : [name],
        mappings: `${vlq(0)}${vlq(0)}${vlq(line - 1)}${vlq(column - 1)}${name === undefined ? '' : vlq(0)}`,
    };
}

const at = (map: CombinedSourceMap | null, line: number, column = 1) =>
    map === null ? null : originalPositionFor(map, line, column);

export default async () => {
    await describe('combineSourceMaps', async () => {
        await it('returns null when no chunk carries a map', async () => {
            // Not an empty map: `null` says "this code has no source", where a map with
            // no mappings claims the generated lines are their own source.
            expect(combineSourceMaps([{ lineCount: 3, map: null }])).toBe(null);
        });

        await it('offsets a later chunk by the lines before it', async () => {
            const merged = combineSourceMaps([
                { lineCount: 4, map: null },
                { lineCount: 1, map: oneMapping('a.vue', 9, 3) },
            ]);
            expect(at(merged, 4)).toBe(null);
            expect(at(merged, 5)?.line).toBe(9);
            expect(at(merged, 5)?.column).toBe(3);
        });

        await it('keeps two chunks apart instead of chaining their deltas', async () => {
            // THE bug a raw `mappings` splice produces: the second chunk's first segment
            // is relative to the first chunk's last, so both would land on line 1 + 9.
            const merged = combineSourceMaps([
                { lineCount: 1, map: oneMapping('a.vue', 1, 1) },
                { lineCount: 1, map: oneMapping('a.vue', 9, 1) },
            ]);
            expect(at(merged, 1)?.line).toBe(1);
            expect(at(merged, 2)?.line).toBe(9);
        });

        await it('pads a chunk whose map stops before its last line', async () => {
            // A map may describe FEWER lines than its chunk holds, and the compiler's
            // template map does. Without the padding the next chunk starts early and
            // every mapping in it names a line of the previous half.
            const merged = combineSourceMaps([
                { lineCount: 3, map: oneMapping('a.vue', 2, 1) },
                { lineCount: 1, map: oneMapping('b.vue', 7, 1) },
            ]);
            expect(at(merged, 1)?.line).toBe(2);
            expect(at(merged, 2)).toBe(null);
            expect(at(merged, 4)?.source).toBe('b.vue');
            expect(at(merged, 4)?.line).toBe(7);
        });

        await it('merges the source tables instead of trusting per-map indices', async () => {
            const merged = combineSourceMaps([
                { lineCount: 1, map: oneMapping('a.vue', 2, 1) },
                { lineCount: 1, map: oneMapping('b.vue', 3, 1) },
                { lineCount: 1, map: oneMapping('a.vue', 4, 1) },
            ]);
            expect(merged?.sources).toStrictEqual(['a.vue', 'b.vue']);
            expect(merged?.sourcesContent).toStrictEqual(['// a.vue', '// b.vue']);
            expect(at(merged, 1)?.source).toBe('a.vue');
            expect(at(merged, 2)?.source).toBe('b.vue');
            expect(at(merged, 3)?.source).toBe('a.vue');
        });

        await it('merges the name table the same way', async () => {
            const merged = combineSourceMaps([
                { lineCount: 1, map: oneMapping('a.vue', 1, 1, 'first') },
                { lineCount: 1, map: oneMapping('b.vue', 1, 1, 'second') },
            ]);
            expect(merged?.names).toStrictEqual(['first', 'second']);
        });

        await it('refuses a map that describes more lines than its chunk', async () => {
            // Silent otherwise: the mappings still decode, they just push every later
            // chunk down a line, so a stack frame points into the neighbouring half.
            let caught: string | null = null;
            try {
                combineSourceMaps([{ lineCount: 1, map: { ...oneMapping('a.vue', 1, 1), mappings: 'AAAA;AAAA' } }]);
            } catch (error) {
                caught = String((error as Error).message);
            }
            expect(caught).toContain('describes 2 line(s) for a 1-line chunk');
        });

        await it('refuses the two malformed segment shapes by name', async () => {
            for (const [mappings, expected] of [
                ['AAA', 'carries 3 fields'],
                ['A*A', 'not a Base64 VLQ digit'],
                ['g', 'ends mid-continuation'],
            ] as const) {
                let caught: string | null = null;
                try {
                    combineSourceMaps([{ lineCount: 1, map: { ...oneMapping('a.vue', 1, 1), mappings } }]);
                } catch (error) {
                    caught = String((error as Error).message);
                }
                expect(caught).toContain(expected);
            }
        });

        await it('round-trips a segment with no source through the merge', async () => {
            // A one-field segment marks generated code no source produced. Dropping it
            // would be invisible; re-encoding it as a 4-field segment would point it at
            // line 1.
            const merged = combineSourceMaps([{ lineCount: 1, map: { ...oneMapping('a.vue', 5, 1), mappings: 'A' } }]);
            expect(merged?.mappings).toBe('A');
            expect(at(merged, 1)).toBe(null);
        });

        await it('encodes a value wide enough to need two VLQ digits', async () => {
            // The continuation bit, which a single-digit fixture never reaches: a column
            // past 15 needs two digits, and a `<<`-based decoder would still pass here
            // while failing on a large name index.
            const merged = combineSourceMaps([{ lineCount: 1, map: oneMapping('a.vue', 4096, 999) }]);
            expect(at(merged, 1)?.line).toBe(4096);
            expect(at(merged, 1)?.column).toBe(999);
        });
    });
};
