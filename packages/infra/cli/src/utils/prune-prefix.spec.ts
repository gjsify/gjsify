// The planner rows are built as plain objects, so every OS/arch/libc branch is
// decidable from a Linux runner — the purity `platform-check.ts` documents, which is
// the whole reason `planPlatformPrune` takes the target as an argument.
//
// The filesystem rows use a real `mkdtemp` fixture, because what they assert IS
// filesystem behaviour: what a symlink does to the walk, and that a removal failure
// is isolated rather than propagated.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlatformTarget } from './platform-check.js';
import {
    type InstalledPackage,
    automaticPruneRefusal,
    executePrune,
    formatPruneReport,
    planPlatformPrune,
    planPrune,
    scanPrefix,
} from './prune-prefix.js';

const LINUX: PlatformTarget = { os: 'linux', cpu: 'x64', libc: 'glibc' };

function pkg(over: Partial<InstalledPackage> = {}): InstalledPackage {
    return { name: 'p', version: '1.0.0', dir: '/tmp/p', linked: false, ...over };
}

/** Write a package directory with a manifest under `<prefix>/node_modules`. */
function writePackage(prefix: string, name: string, manifest: Record<string, unknown>, files = 1): string {
    const dir = join(prefix, 'node_modules', ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
    for (let i = 0; i < files; i += 1) writeFileSync(join(dir, `blob-${i}.bin`), 'x'.repeat(1000));
    return dir;
}

export default async () => {
    await describe('planPlatformPrune', async () => {
        await it('plans a package this host cannot use', async () => {
            const entries = planPlatformPrune([pkg({ platform: { os: 'darwin', cpu: 'arm64' } })], LINUX);
            expect(entries.length).toBe(1);
            expect(entries[0].verdict.ok).toBe(false);
        });

        await it('plans a libc-only package when the host libc is unknown', async () => {
            // npm's own asymmetry, which `checkPlatform` implements: a package that
            // DECLARES a libc against an unknown host libc is incompatible. Handing a
            // musl binary to a glibc process is the failure that rule prevents.
            const entries = planPlatformPrune([pkg({ platform: { libc: 'glibc' } })], { os: 'linux', cpu: 'x64' });
            expect(entries.length).toBe(1);
        });

        await it('never plans a package that declares nothing', async () => {
            // `@rolldown/binding-wasm32-wasi` is exactly this: unusable here, and it
            // says so nowhere. Guessing from the NAME is how a prune starts deleting
            // things it cannot justify.
            expect(planPlatformPrune([pkg()], LINUX).length).toBe(0);
            expect(planPlatformPrune([pkg({ platform: { os: 'any' } })], LINUX).length).toBe(0);
        });

        await it('never plans a linked package', async () => {
            // A symlink here is the user's own workspace source tree.
            const linked = pkg({ linked: true, platform: { os: 'darwin' } });
            expect(planPlatformPrune([linked], LINUX).length).toBe(0);
        });

        await it('keeps a package the host CAN use', async () => {
            expect(planPlatformPrune([pkg({ platform: { os: 'linux', cpu: 'x64' } })], LINUX).length).toBe(0);
        });
    });

    await describe('scanPrefix', async () => {
        await it('finds scoped and nested packages, and skips the reserved entries', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-prune-scan-'));
            try {
                writePackage(prefix, 'plain', {});
                writePackage(prefix, '@scope/inner', {});
                writePackage(join(prefix, 'node_modules', 'plain'), 'nested', {});
                // The live cross-process install lock, and the launcher dir.
                mkdirSync(join(prefix, 'node_modules', '.gjsify-install-lock'), { recursive: true });
                mkdirSync(join(prefix, 'node_modules', '.bin'), { recursive: true });

                const names = scanPrefix(prefix)
                    .map((p) => p.name)
                    .sort();
                expect(names).toStrictEqual(['@scope/inner', 'nested', 'plain']);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('marks a symlinked package as linked and does not descend it', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-prune-link-'));
            try {
                const source = mkdtempSync(join(tmpdir(), 'gjsify-prune-src-'));
                writePackage(source, 'workspace-pkg', { os: ['darwin'] });
                writePackage(join(source, 'node_modules', 'workspace-pkg'), 'hidden-child', {});
                mkdirSync(join(prefix, 'node_modules'), { recursive: true });
                symlinkSync(join(source, 'node_modules', 'workspace-pkg'), join(prefix, 'node_modules', 'linked'));

                const found = scanPrefix(prefix);
                expect(found.length).toBe(1);
                expect(found[0].linked).toBe(true);
                // Its own node_modules is the user's tree, not this prefix's to plan over.
                expect(found.some((p) => p.name === 'hidden-child')).toBe(false);
                rmSync(source, { recursive: true, force: true });
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('does not throw on an unreadable manifest, and leaves it un-prunable', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-prune-bad-'));
            try {
                const dir = join(prefix, 'node_modules', 'broken');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'package.json'), '{ not json');

                const found = scanPrefix(prefix);
                expect(found.length).toBe(1);
                expect(found[0].platform).toBe(undefined);
                expect(planPlatformPrune(found, LINUX).length).toBe(0);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });
    });

    await describe('executePrune', async () => {
        await it('removes the planned directories and reports their bytes', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-prune-exec-'));
            try {
                const doomed = writePackage(prefix, 'foreign', { os: ['darwin'] }, 3);
                const kept = writePackage(prefix, 'native', { os: ['linux'] });

                const result = executePrune(planPrune({ prefix, target: LINUX }));
                expect(result.removed.length).toBe(1);
                expect(existsSync(doomed)).toBe(false);
                expect(existsSync(kept)).toBe(true);
                // Three 1000-byte blobs plus the manifest — computed, not a literal, so
                // this does not go red on a change to the fixture's JSON formatting.
                expect(result.bytes > 3000).toBe(true);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('under dryRun removes nothing and still reports the total', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-prune-dry-'));
            try {
                const doomed = writePackage(prefix, 'foreign', { os: ['darwin'] });
                const plan = planPrune({ prefix, target: LINUX });
                const result = executePrune(plan, { dryRun: true });
                expect(existsSync(doomed)).toBe(true);
                expect(result.removed.length).toBe(0);
                expect(plan.bytes > 0).toBe(true);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('isolates a failing removal instead of throwing', async () => {
            // This runs as housekeeping at the end of an install. An install that
            // already succeeded must not be reported as failed because one directory
            // could not be unlinked.
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-prune-fail-'));
            try {
                writePackage(prefix, 'a-foreign', { os: ['darwin'] });
                writePackage(prefix, 'b-foreign', { os: ['darwin'] });
                const plan = planPrune({ prefix, target: LINUX });
                const result = executePrune(plan, {
                    remove: (dir) => {
                        if (dir.includes('a-foreign')) throw new Error('EBUSY');
                        rmSync(dir, { recursive: true, force: true });
                    },
                });
                expect(result.failed.length).toBe(1);
                expect(result.failed[0].error).toBe('EBUSY');
                expect(result.removed.length).toBe(1);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });

        await it('drops a dangling .bin SYMLINK and leaves a real file alone', async () => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-prune-bin-'));
            try {
                writePackage(prefix, 'foreign', { os: ['darwin'] });
                const binDir = join(prefix, 'node_modules', '.bin');
                mkdirSync(binDir, { recursive: true });
                symlinkSync(join(prefix, 'node_modules', 'foreign', 'cli.js'), join(binDir, 'dead'));
                writeFileSync(join(binDir, 'launcher'), '#!/bin/sh\n');

                const result = executePrune(planPrune({ prefix, target: LINUX }));
                expect(result.binLinks).toStrictEqual(['dead']);
                // Deadness is only PROVABLE for a dangling symlink; a real file may be a
                // launcher this prefix still needs, and reading it would be a second,
                // weaker rule.
                expect(existsSync(join(binDir, 'launcher'))).toBe(true);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        });
    });

    await describe('automaticPruneRefusal — the data-loss guard', async () => {
        await it('refuses when the platform target was overridden', async () => {
            // `gjsify install -g foo --os=darwin` reaches the automatic pass with
            // npm_config_os set. Acting on it would delete every linux package in the
            // user's real shared prefix — the engine set, the bundler bindings, the
            // CLI's own — because none of them is usable on darwin.
            expect(automaticPruneRefusal({ npm_config_os: 'darwin' }, false)).not.toBe(null);
            expect(automaticPruneRefusal({ npm_config_cpu: 'arm64' }, false)).not.toBe(null);
            expect(automaticPruneRefusal({ npm_config_libc: 'musl' }, false)).not.toBe(null);
        });

        await it('refuses under --immutable', async () => {
            expect(automaticPruneRefusal({}, true)).toBe('--immutable');
        });

        await it('allows a plain install', async () => {
            expect(automaticPruneRefusal({}, false)).toBe(null);
            // An empty override string is not an override — same reading as
            // `readPlatformOverrides`.
            expect(automaticPruneRefusal({ npm_config_os: '' }, false)).toBe(null);
        });
    });

    await describe('formatPruneReport', async () => {
        await it('says nothing is prunable rather than printing an empty list', async () => {
            const plan = { prefix: '/p', target: LINUX, scanned: 3, entries: [], bytes: 0 };
            const text = formatPruneReport(
                { plan, removed: [], failed: [], bytes: 0, binLinks: [] },
                { dryRun: false, verbose: false },
            );
            expect(text).toContain('nothing to prune');
            expect(text).toContain('scanned 3 package(s)');
        });

        await it('names what each entry required, and says the size is apparent', async () => {
            const entry = {
                pkg: pkg({ name: '@rolldown/binding-darwin-arm64', platform: { os: 'darwin' } }),
                bytes: 2048,
                verdict: { ok: false, current: LINUX, required: { os: 'darwin' } },
            };
            const plan = { prefix: '/p', target: LINUX, scanned: 9, entries: [entry], bytes: 2048 };
            const text = formatPruneReport(
                { plan, removed: [], failed: [], bytes: 0, binLinks: [] },
                { dryRun: true, verbose: false },
            );
            expect(text).toContain('@rolldown/binding-darwin-arm64');
            expect(text).toContain('"os":"darwin"');
            expect(text).toContain('would free');
            // `du` counts allocated blocks and will disagree; saying so costs one
            // clause and saves the bug report.
            expect(text).toContain('apparent size');
        });
    });
};
