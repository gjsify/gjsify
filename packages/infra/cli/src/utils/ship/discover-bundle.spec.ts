// SPDX-License-Identifier: MIT
// Which files beside the entry become payload, and which one never may not.
//
// `discoverPayload` stages the whole directory the entry lives in, which is what
// makes a two-host project ship each artifact the other's bundle (#1545) — and
// what makes the exclusion that fixes it dangerous in the other direction. The
// foreign set is built from DECLARED strings, and `dist/app.mjs`,
// `./dist/app.mjs`, `dist/../dist/app.mjs` and an absolute path are four
// spellings of one file. Comparing strings drops the target's own entry and
// stages a launcher pointing at a bundle that is not there: an artifact strictly
// worse than the one the exclusion exists to prevent.
//
// So every case here is about the boundary rather than the rule, and it runs
// against a real directory for `discover-typelibs.spec.ts`'s reason: the subject
// is what a directory MEANS.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPayload } from './discover.js';

/** A project whose `dist/` holds the entry, a shared chunk and a second bundle. */
function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-ship-bundle-'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'app.mjs'), '// the entry\n');
    writeFileSync(join(root, 'dist', 'chunk-abc.mjs'), '// a shared chunk\n');
    writeFileSync(join(root, 'dist', 'app.node.mjs'), '// the other target\n');
    return root;
}

function staged(root: string, foreignBundles: readonly string[]): string[] {
    return discoverPayload({
        projectDir: root,
        pkg: { name: 'hello', version: '1.0.0' },
        ship: {},
        declaredBundle: 'dist/app.mjs',
        foreignBundles,
    }).bundleFiles;
}

export default async () => {
    await describe('the payload beside the entry', async () => {
        await it("drops another target's entry and keeps everything else", async () => {
            const root = project();
            try {
                expect(staged(root, ['dist/app.node.mjs'])).toStrictEqual(['app.mjs', 'chunk-abc.mjs']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it("keeps THIS target's entry under every spelling of it", async () => {
            // Measured, and it produced a payload with no bundle in it: the
            // launcher shipped, the file it execs did not, and the run reported
            // the artifact as built.
            const root = project();
            try {
                for (const spelling of ['./dist/app.mjs', 'dist/../dist/app.mjs', join(root, 'dist', 'app.mjs')]) {
                    // Nothing is dropped: the only name in the foreign set IS this
                    // target's entry, under a spelling a string comparison misses.
                    expect(staged(root, [spelling])).toStrictEqual(['app.mjs', 'app.node.mjs', 'chunk-abc.mjs']);
                }
                // …and the exclusion still works when a real foreign entry rides
                // along with the misspelt own one.
                expect(staged(root, ['./dist/app.mjs', 'dist/app.node.mjs'])).toStrictEqual([
                    'app.mjs',
                    'chunk-abc.mjs',
                ]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('keeps a shared chunk, which no rule here can tell from an application file', async () => {
            const root = project();
            try {
                const files = staged(root, ['dist/app.node.mjs']);
                expect(files.includes('chunk-abc.mjs')).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('ignores a foreign entry that is not in this payload at all', async () => {
            // Another target may build somewhere else entirely; there is then
            // nothing here to subtract, and no reason to say so.
            const root = project();
            try {
                expect(staged(root, ['../elsewhere/app.node.mjs'])).toStrictEqual([
                    'app.mjs',
                    'app.node.mjs',
                    'chunk-abc.mjs',
                ]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
