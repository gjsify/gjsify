// Unit coverage for the watch loop's self-write filter.
//
// The loop's own build lands inside the watched tree in the DEFAULT arrangement
// — the watch dir defaults to the entry point's directory, so a project whose
// entry sits at its root watches the root and writes `dist/` into it — and every
// such write used to start the next rebuild. Measured before the filter: one
// edit produced a rebuild every ~5 s forever. Pinned here rather than only in
// `tests/e2e/dev-command` because "exactly one rebuild" costs a real build and a
// quiet window to observe, while the decision itself is a pure path question.

import { describe, expect, it } from '@gjsify/unit';
import { isSelfWrite } from './watch-loop.js';

const PROJECT = '/tmp/project';
const BUNDLE = '/tmp/project/dist/out.mjs';

export default async () => {
    await describe('watch-loop: self-write filter', async () => {
        await it('ignores the bundle and what the bundler writes beside it', () => {
            expect(isSelfWrite(PROJECT, BUNDLE, 'dist/out.mjs')).toBe(true);
            expect(isSelfWrite(PROJECT, BUNDLE, 'dist/out.mjs.map')).toBe(true);
        });

        await it('ignores the whole output directory', () => {
            // Chunks and assets land there too, under names the loop cannot
            // predict from `--outfile` alone.
            expect(isSelfWrite(PROJECT, BUNDLE, 'dist/chunk-a1b2.mjs')).toBe(true);
            expect(isSelfWrite(PROJECT, BUNDLE, 'dist/assets/logo.svg')).toBe(true);
        });

        await it('still rebuilds for a source edit', () => {
            expect(isSelfWrite(PROJECT, BUNDLE, 'index.ts')).toBe(false);
            expect(isSelfWrite(PROJECT, BUNDLE, 'src/index.ts')).toBe(false);
            // A sibling directory whose name merely starts with the output's:
            // string-prefix matching without the separator would swallow it.
            expect(isSelfWrite(PROJECT, BUNDLE, 'distribution/notes.ts')).toBe(false);
        });

        await it('excludes only the file when the output IS in the watched dir', () => {
            // `--outfile bundle.js` with the sources beside it: excluding the
            // output's directory here would exclude every source too, so the
            // loop would never rebuild at all.
            const flat = '/tmp/project/bundle.js';
            expect(isSelfWrite(PROJECT, flat, 'bundle.js')).toBe(true);
            expect(isSelfWrite(PROJECT, flat, 'bundle.js.map')).toBe(true);
            expect(isSelfWrite(PROJECT, flat, 'index.ts')).toBe(false);
        });

        await it('compares normalised paths, not the spellings it was handed', () => {
            // Linux passed all the cases above while win32 failed three: the
            // changed path was resolved and `output` was not, so the two sides
            // were different spellings of one file and every self-write read as
            // a source edit. An unnormalised `output` reproduces that on ANY
            // platform — which is what keeps this honest here rather than only
            // on the one CI leg that happened to catch it.
            expect(isSelfWrite(PROJECT, '/tmp/project/./dist/out.mjs', 'dist/out.mjs')).toBe(true);
            expect(isSelfWrite(PROJECT, 'dist/out.mjs', 'dist/out.mjs')).toBe(true);
        });

        await it('rebuilds when it cannot tell what changed', () => {
            // No declared output (`--build-only` on a project naming none), and
            // the platforms where `fs.watch` reports a null filename: neither
            // can be answered, and a missed rebuild is worse than an extra one.
            expect(isSelfWrite(PROJECT, undefined, 'dist/out.mjs')).toBe(false);
            expect(isSelfWrite(PROJECT, BUNDLE, null)).toBe(false);
        });
    });
};
