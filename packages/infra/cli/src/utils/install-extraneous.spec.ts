// Two layers, because the bug lived in the seam between them.
//
// The planner rows are plain objects, so nested placements, symlinks and subtree
// collapsing are decidable without a filesystem.
//
// The last three rows are the guard that matters: they plant a real tree and call
// the real `installPackagesNative({ frozen: true })` — the exact entry point that exited
// 0 over a poisoned `node_modules` in gjsify#1683. A pure-function test alone would
// have passed while `--immutable` went on ignoring the stranger, which is precisely
// how the defect survived. Both run offline: the refusal fires before any download,
// and the clean tree is already extracted at the locked version, so
// `isAlreadyExtracted` short-circuits every fetch.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPackagesNative } from './install-backend-native.js';
import { EXTRANEOUS_REPORT_LIMIT, findExtraneous, formatExtraneousError } from './install-extraneous.js';
import { type InstalledPackage, scanPrefix } from './prune-prefix.js';
import { makeProgressReporter } from './install-progress.js';

function installed(dir: string, over: Partial<InstalledPackage> = {}): InstalledPackage {
    return { name: 'p', version: '1.0.0', dir, linked: false, ...over };
}

/** A package directory with a manifest, at a path relative to the prefix. */
function writePackage(prefix: string, installPath: string, name: string, version = '1.0.0'): void {
    const dir = join(prefix, ...installPath.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
}

function writeLock(prefix: string, packages: Record<string, { version: string; resolved: string }>): void {
    writeFileSync(
        join(prefix, 'gjsify-lock.json'),
        JSON.stringify({
            lockfileVersion: 4,
            requested: ['pkg-a@1.0.0'],
            packages,
        }),
    );
}

const QUIET = makeProgressReporter({ enabled: false });

export default async () => {
    await describe('findExtraneous', async () => {
        await it('names a nested copy of an already-hoisted package', async () => {
            // The gjsify#1683 shape verbatim: the lockfile hoists graphene, the
            // restored cache also carries it under gtk. tsc then sees one type with
            // two identities (TS2883) and the install that produced the tree said
            // nothing.
            const out = findExtraneous({
                prefix: '/p',
                installed: [
                    installed('/p/node_modules/@girs/gtk-4.0', { name: '@girs/gtk-4.0' }),
                    installed('/p/node_modules/@girs/graphene-1.0', { name: '@girs/graphene-1.0' }),
                    installed('/p/node_modules/@girs/gtk-4.0/node_modules/@girs/graphene-1.0', {
                        name: '@girs/graphene-1.0',
                    }),
                ],
                expected: [
                    { installPath: 'node_modules/@girs/gtk-4.0' },
                    { installPath: 'node_modules/@girs/graphene-1.0' },
                ],
            });
            expect(out.length).toBe(1);
            expect(out[0]!.installPath).toBe('node_modules/@girs/gtk-4.0/node_modules/@girs/graphene-1.0');
        });

        await it('says nothing about a tree the lockfile fully describes', async () => {
            const out = findExtraneous({
                prefix: '/p',
                installed: [installed('/p/node_modules/a', { name: 'a' })],
                expected: [{ installPath: 'node_modules/a' }, { installPath: 'node_modules/b' }],
            });
            // A locked package MISSING from disk is not this rule's business — the
            // install adds it. Only the reverse direction is a defect.
            expect(out.length).toBe(0);
        });

        await it('never accuses a workspace symlink', async () => {
            // `workspaceInstall` links the monorepo's own sources into node_modules;
            // the lockfile by construction does not carry them. Calling those
            // extraneous would fail every workspace install.
            const out = findExtraneous({
                prefix: '/p',
                installed: [installed('/p/node_modules/@gjsify/cli', { name: '@gjsify/cli', linked: true })],
                expected: [],
            });
            expect(out.length).toBe(0);
        });

        await it('reports the enclosing directory, not its whole subtree', async () => {
            const out = findExtraneous({
                prefix: '/p',
                installed: [
                    installed('/p/node_modules/stray', { name: 'stray' }),
                    installed('/p/node_modules/stray/node_modules/dep', { name: 'dep' }),
                ],
                expected: [],
            });
            expect(out.length).toBe(1);
            expect(out[0]!.installPath).toBe('node_modules/stray');
        });

        await it('walks a real tree through scanPrefix', async () => {
            // The pure rows above assume the scan shape; this one proves the seam,
            // including that `.bin` and a symlinked package are skipped by the walk
            // itself rather than by luck.
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-extraneous-'));
            try {
                writePackage(prefix, 'node_modules/pkg-a', 'pkg-a');
                writePackage(prefix, 'node_modules/pkg-a/node_modules/pkg-b', 'pkg-b');
                mkdirSync(join(prefix, 'node_modules', '.bin'), { recursive: true });
                writePackage(prefix, 'src-pkg', 'linked-pkg');
                symlinkSync(join(prefix, 'src-pkg'), join(prefix, 'node_modules', 'linked-pkg'));

                const out = findExtraneous({
                    prefix,
                    installed: scanPrefix(prefix),
                    expected: [{ installPath: 'node_modules/pkg-a' }],
                });
                expect(out.length).toBe(1);
                expect(out[0]!.installPath).toBe('node_modules/pkg-a/node_modules/pkg-b');
                expect(out[0]!.name).toBe('pkg-b');
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });
    });

    await describe('formatExtraneousError', async () => {
        await it('names the paths and the way out', async () => {
            const text = formatExtraneousError(
                [{ installPath: 'node_modules/a/node_modules/b', name: 'b', version: '2.0.0' }],
                '/p',
            );
            expect(text).toContain('node_modules/a/node_modules/b');
            expect(text).toContain('b@2.0.0');
            expect(text).toContain('--immutable');
        });

        await it('sends the reader to a remedy that actually removes the package', async () => {
            // MEASURED, not assumed: against a real prefix holding a top-level stray
            // and a stray nested under an already-extracted package, a plain
            // `gjsify install` left BOTH in place, and so did an explicit `--prune`
            // (which judges os/cpu/libc only). An earlier draft of this message
            // offered "run `gjsify install` without --immutable" as a way out; it
            // changes nothing and the refusal repeats verbatim. Deleting is the only
            // remedy, so the text may not name a command as an alternative to it.
            const text = formatExtraneousError(
                [{ installPath: 'node_modules/a/node_modules/b', name: 'b', version: '2.0.0' }],
                '/p',
            );
            expect(text).toContain('delete');
            expect(text).toContain('does NOT clear them');
        });

        await it('counts the rest instead of printing a thousand lines', async () => {
            const many = Array.from({ length: EXTRANEOUS_REPORT_LIMIT + 5 }, (_, i) => ({
                installPath: `node_modules/p${String(i).padStart(3, '0')}`,
                name: `p${i}`,
                version: '1.0.0',
            }));
            const text = formatExtraneousError(many, '/p');
            expect(text).toContain('and 5 more');
        });
    });

    await describe('gjsify install --immutable', async () => {
        await it('refuses a node_modules the lockfile does not describe', async () => {
            // THE GUARD. Plant the incident's tree, run the real frozen install, and
            // assert it does not quietly succeed. Verified by breaking it on purpose:
            // with `assertNoExtraneous` removed from the frozen branch this row goes
            // red on the "should have refused" line.
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-immutable-'));
            try {
                writeLock(prefix, {
                    'node_modules/pkg-a': { version: '1.0.0', resolved: 'https://example.invalid/a.tgz' },
                });
                writePackage(prefix, 'node_modules/pkg-a', 'pkg-a');
                writePackage(prefix, 'node_modules/pkg-a/node_modules/pkg-b', 'pkg-b', '2.0.0');

                let message = '';
                try {
                    await installPackagesNative({
                        prefix,
                        specs: ['pkg-a@1.0.0'],
                        frozen: true,
                        lockfile: false,
                        progress: QUIET,
                    });
                    message = '<no error: --immutable accepted an undescribed tree>';
                } catch (err) {
                    message = err instanceof Error ? err.message : String(err);
                }
                expect(message).toContain('node_modules/pkg-a/node_modules/pkg-b');
                expect(message).toContain('pkg-b@2.0.0');
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('reports a dev-LINKED top-level package as installed, not as absent', async () => {
            // REGRESSION, blocker 1 of the #1730 review — the defect that broke the
            // one promise `gjsify link` makes: that the consumer's package.json and
            // lockfile do not change.
            //
            // `linkedNames` drops the linked node from the FETCH set, and the
            // backend used to answer `topLevelResolutions` from that same filtered
            // array. So `result.installed` had no `pkg-a`, `commands/install.ts`
            // fell back to `'latest'`, and `gjsify install is-odd` against a linked
            // is-odd rewrote `"is-odd": "^3.0.1"` to `"is-odd": "latest"` in
            // package.json AND `is-odd@latest` in the lockfile's `requested`. The
            // control run without the link wrote `^3.0.1`.
            //
            // Offline like its two neighbours: frozen path, tree already extracted,
            // and the linked package is excluded from the fetch anyway.
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-linked-resolution-'));
            try {
                writeLock(prefix, {
                    'node_modules/pkg-a': { version: '1.0.0', resolved: 'https://example.invalid/a.tgz' },
                });
                writePackage(prefix, 'node_modules/pkg-a', 'pkg-a');

                const out = await installPackagesNative({
                    prefix,
                    specs: ['pkg-a@1.0.0'],
                    frozen: true,
                    lockfile: false,
                    progress: QUIET,
                    linkedNames: new Set(['pkg-a']),
                });
                // Present is not the same question as downloaded. A linked package
                // is installed — by a symlink — so the resolution must survive.
                expect(out.length).toBe(1);
                expect(out[0]!.name).toBe('pkg-a');
                expect(out[0]!.version).toBe('1.0.0');
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('still accepts the tree its lockfile does describe', async () => {
            // The discriminator: without it, an `assertNoExtraneous` that threw
            // unconditionally would pass the row above and break every install.
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-immutable-ok-'));
            try {
                writeLock(prefix, {
                    'node_modules/pkg-a': { version: '1.0.0', resolved: 'https://example.invalid/a.tgz' },
                });
                writePackage(prefix, 'node_modules/pkg-a', 'pkg-a');

                const out = await installPackagesNative({
                    prefix,
                    specs: ['pkg-a@1.0.0'],
                    frozen: true,
                    lockfile: false,
                    progress: QUIET,
                });
                expect(out.length).toBe(1);
                expect(out[0]!.name).toBe('pkg-a');
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });
    });
};
