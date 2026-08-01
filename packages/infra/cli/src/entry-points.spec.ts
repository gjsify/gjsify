// SPDX-License-Identifier: MIT
// Determinism contract for `globToEntryPoints` — the entry ORDER handed to
// Rolldown is an INPUT to the emitted bytes, so it must be a pure function of
// the file set, never of filesystem or scheduler state.
//
// Why order is load-bearing: Rolldown derives every module's and external's
// exec order from a DFS that starts at the entries IN ORDER, and each emitted
// chunk renders its import statements sorted by that exec order (rolldown
// `sort_modules.rs` + `compute_cross_chunk_links.rs`). A multi-entry
// `--library` build therefore emits differently-ordered `lib/esm/*.js` import
// statements when the entry order changes, and every app bundle that inlines
// those libs (the committed `dist/*.gjs.mjs`) inherits the drift.
//
// fast-glob does NOT pin that order: its concurrent directory walker yields
// matches in COMPLETION order, so sibling directories race (measured on the
// real `rolldown-plugin-gjsify/src` tree: 9 distinct orderings in 60 runs on
// one machine). That race is what made the committed GJS bundles reproduce on
// CI but not on developer machines — the `system` / `gi://GioUnix` hoisted-
// import swap and the `makeCallable`/`mapSysname` module-order divergence in
// `verify-committed-bundles.mjs` failures were both downstream of it.
//
// The contract under test: each PATTERN's expansion is lexicographically
// sorted (locale-independent UTF-16 order), while the pattern-LIST order — the
// user's explicit input — is preserved.
//
// Tested from @gjsify/cli's harness because the plugin package has no
// `test:node` script of its own — same placement rationale as
// `alias-plugin.spec.ts` / `externals-plugin.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';
import { globToEntryPoints } from '@gjsify/rolldown-plugin-gjsify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fixture tree whose SORTED order interleaves root files between sibling
 * subdirectory groups (`aa/ < mm-root.ts < nn/ < yy/ < zz-root.ts`). A walker
 * that emits "parent files first, then subdirectories as they complete" —
 * fast-glob's natural order — can never produce this sorted order, so the
 * sortedness assertion fails deterministically without the fix, on every
 * machine, independent of how the directory race resolves.
 *
 * Files are created in REVERSE lexicographic order so an insertion-ordered
 * filesystem cannot make the raw readdir order accidentally sorted either.
 */
function makeFixtureTree(): { root: string; sortedRel: string[] } {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-entry-points-'));
    const files = [
        'zz-root.ts',
        'yy/two.ts',
        'yy/one.ts',
        'nn/beta.ts',
        'nn/alpha.ts',
        'mm-root.ts',
        'aa/second.ts',
        'aa/first.ts',
    ];
    for (const rel of files) {
        const abs = join(root, rel);
        const dir = abs.slice(0, abs.lastIndexOf('/'));
        mkdirSync(dir, { recursive: true });
        writeFileSync(abs, `export const marker = ${JSON.stringify(rel)};\n`);
    }
    // Excluded shapes: `.d.ts` (DEFAULT_IGNORE) + a caller-supplied ignore.
    writeFileSync(join(root, 'nn', 'types.d.ts'), 'export declare const t: string;\n');
    writeFileSync(join(root, 'nn', 'skip.spec.ts'), 'export const skipped = true;\n');
    const sortedRel = [...files].sort();
    return { root, sortedRel };
}

export default async () => {
    await describe('globToEntryPoints determinism', async () => {
        const { root, sortedRel } = makeFixtureTree();
        const sortedAbs = sortedRel.map((rel) => join(root, rel));

        try {
            await it('expands a glob to the lexicographically sorted file list', async () => {
                const result = await globToEntryPoints(`${root}/**/*.ts`, [`${root}/**/*.spec.ts`]);
                expect(result).toStrictEqual(sortedAbs);
            });

            await it('expansion is identical across concurrent repeats', async () => {
                // Concurrency maximizes the sibling-directory race the sort
                // must neutralize; 24 repeats made the unsorted order show up
                // reliably in the measurement that motivated this spec.
                const runs = await Promise.all(
                    Array.from({ length: 24 }, () => globToEntryPoints(`${root}/**/*.ts`, [`${root}/**/*.spec.ts`])),
                );
                const first = JSON.stringify(runs[0]);
                for (const run of runs) {
                    expect(JSON.stringify(run)).toBe(first);
                }
            });

            await it('preserves the user pattern-list order between patterns', async () => {
                // The LIST order is the user's explicit input (entry execution
                // order); only each pattern's own expansion is canonicalized.
                const result = await globToEntryPoints([`${root}/yy/**/*.ts`, `${root}/aa/**/*.ts`], []);
                expect(result).toStrictEqual([
                    join(root, 'yy/one.ts'),
                    join(root, 'yy/two.ts'),
                    join(root, 'aa/first.ts'),
                    join(root, 'aa/second.ts'),
                ]);
            });

            await it('keeps explicit non-glob paths in the order given', async () => {
                const explicit = [join(root, 'zz-root.ts'), join(root, 'mm-root.ts')];
                const result = await globToEntryPoints(explicit, []);
                expect(result).toStrictEqual(explicit);
            });

            await it('dedupes overlapping patterns, first occurrence wins', async () => {
                const result = (await globToEntryPoints(
                    [`${root}/aa/**/*.ts`, `${root}/**/*.ts`],
                    [`${root}/**/*.spec.ts`],
                )) as string[];
                expect(result.slice(0, 2)).toStrictEqual([join(root, 'aa/first.ts'), join(root, 'aa/second.ts')]);
                expect(result.length).toBe(sortedAbs.length);
                expect(new Set(result).size).toBe(result.length);
            });

            await it('sorts record-form expansions the same way', async () => {
                const result = (await globToEntryPoints({ [`${root}/**/*.ts`]: 'out' }, [
                    `${root}/**/*.spec.ts`,
                ])) as Record<string, string>;
                expect(Object.keys(result)).toStrictEqual(sortedAbs);
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
};
