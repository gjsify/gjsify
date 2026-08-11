// SPDX-License-Identifier: MIT
// The content-hash per-package build cache (ADR 0006 phase 1): pure key
// computation plus the store/restore/prune disk contract. End-to-end behaviour
// (a hit skips the script, a dep edit re-runs dependents) is tests/e2e/build-cache/.

import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Workspace } from '@gjsify/workspace';

import {
    BuildCacheRunner,
    buildCacheEnabledByEnv,
    buildCacheRoot,
    composeCacheKey,
    hashPackageInputs,
    modifiedOutputDirs,
    outputUnits,
    pruneCacheEntries,
    readCacheEntry,
    restoreCacheEntry,
    sanitizePackageDirName,
    snapshotOutputDirs,
    storeCacheEntry,
} from './build-cache.js';

// Minimal Workspace factory for fixture monorepos under a temp root.
function makeWorkspace(
    root: string,
    dir: string,
    name: string,
    deps: Record<string, string> = {},
    devDeps: Record<string, string> = {},
): Workspace {
    const location = join(root, 'packages', dir);
    mkdirSync(join(location, 'src'), { recursive: true });
    const manifest = {
        name,
        version: '0.0.1',
        type: 'module',
        dependencies: deps,
        devDependencies: devDeps,
        scripts: { build: 'noop' },
    };
    writeFileSync(join(location, 'package.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(join(location, 'src', 'index.ts'), `export const who = '${name}';\n`);
    return {
        location,
        relativeLocation: `packages/${dir}`,
        name,
        version: '0.0.1',
        manifest,
        private: false,
    };
}

const quiet = () => {};

export default async () => {
    await describe('build-cache: composeCacheKey', async () => {
        const base = {
            script: 'build',
            args: [] as string[],
            toolchain: { '@gjsify/cli': '1.0.0', rolldown: '2.0.0' },
            ownHash: 'aaa',
            depHashes: { '@x/a': 'h1', '@x/b': 'h2' },
        };

        await it('is deterministic and dep-order independent', async () => {
            const k1 = composeCacheKey(base);
            const k2 = composeCacheKey({ ...base, depHashes: { '@x/b': 'h2', '@x/a': 'h1' } });
            expect(k1).toBe(k2);
            expect(k1.length).toBe(32);
        });

        await it('changes with script name, args, toolchain, own hash and dep hashes', async () => {
            const k = composeCacheKey(base);
            expect(composeCacheKey({ ...base, script: 'build:types' })).not.toBe(k);
            expect(composeCacheKey({ ...base, args: ['--flag'] })).not.toBe(k);
            expect(composeCacheKey({ ...base, toolchain: { ...base.toolchain, rolldown: '2.0.1' } })).not.toBe(k);
            expect(composeCacheKey({ ...base, ownHash: 'bbb' })).not.toBe(k);
            expect(composeCacheKey({ ...base, depHashes: { '@x/a': 'CHANGED', '@x/b': 'h2' } })).not.toBe(k);
            // A dep appearing at all matters too.
            expect(composeCacheKey({ ...base, depHashes: { '@x/a': 'h1' } })).not.toBe(k);
        });
    });

    await describe('build-cache: hashPackageInputs', async () => {
        await it('is content-sensitive for src/**, package.json and tsconfig*.json but ignores outputs', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                const h0 = hashPackageInputs(ws.location);
                // Identical content → identical hash (mtime-independent).
                writeFileSync(join(ws.location, 'src', 'index.ts'), `export const who = '@x/a';\n`);
                expect(hashPackageInputs(ws.location)).toBe(h0);
                // Output/vendor dirs do NOT participate.
                mkdirSync(join(ws.location, 'lib'), { recursive: true });
                mkdirSync(join(ws.location, 'dist'), { recursive: true });
                mkdirSync(join(ws.location, 'node_modules', 'x'), { recursive: true });
                writeFileSync(join(ws.location, 'lib', 'index.js'), 'out');
                writeFileSync(join(ws.location, 'dist', 'bundle.js'), 'out');
                writeFileSync(join(ws.location, 'node_modules', 'x', 'package.json'), '{}');
                expect(hashPackageInputs(ws.location)).toBe(h0);
                // src content change → new hash.
                writeFileSync(join(ws.location, 'src', 'index.ts'), 'export const who = "changed";\n');
                const h1 = hashPackageInputs(ws.location);
                expect(h1).not.toBe(h0);
                // Adding a src file → new hash.
                writeFileSync(join(ws.location, 'src', 'extra.ts'), 'export {};\n');
                const h2 = hashPackageInputs(ws.location);
                expect(h2).not.toBe(h1);
                // tsconfig at the package root → new hash.
                writeFileSync(join(ws.location, 'tsconfig.json'), '{"compilerOptions":{}}');
                const h3 = hashPackageInputs(ws.location);
                expect(h3).not.toBe(h2);
                writeFileSync(join(ws.location, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
                expect(hashPackageInputs(ws.location)).not.toBe(h3);
                // package.json (scripts/deps) → new hash.
                const pkgPath = join(ws.location, 'package.json');
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
                writeFileSync(pkgPath, JSON.stringify({ ...pkg, extraField: 1 }));
                expect(hashPackageInputs(ws.location)).not.toBe(h3);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('build-cache: BuildCacheRunner key composition', async () => {
        await it('a dep edit invalidates every transitive dependent (and only those)', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                // c → b → a (prod deps) plus d standalone via devDep on a.
                const a = makeWorkspace(root, 'a', '@x/a');
                const b = makeWorkspace(root, 'b', '@x/b', { '@x/a': 'workspace:^' });
                const c = makeWorkspace(root, 'c', '@x/c', { '@x/b': 'workspace:^' });
                const d = makeWorkspace(root, 'd', '@x/d', {}, { '@x/a': 'workspace:^' });
                const e = makeWorkspace(root, 'e', '@x/e');
                const all = [a, b, c, d, e];
                const keysOf = () => {
                    const runner = new BuildCacheRunner({ root, workspaces: all, script: 'build', log: quiet });
                    return {
                        a: runner.keyFor(a),
                        b: runner.keyFor(b),
                        c: runner.keyFor(c),
                        d: runner.keyFor(d),
                        e: runner.keyFor(e),
                    };
                };
                const k0 = keysOf();
                writeFileSync(join(a.location, 'src', 'index.ts'), 'export const who = "edited";\n');
                const k1 = keysOf();
                expect(k1.a).not.toBe(k0.a);
                expect(k1.b).not.toBe(k0.b); // direct dependent
                expect(k1.c).not.toBe(k0.c); // TRANSITIVE dependent
                expect(k1.d).not.toBe(k0.d); // devDependency edge counts too
                expect(k1.e).toBe(k0.e); // unrelated package untouched
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('build-cache: output-dir detection + store/restore/prune', async () => {
        await it('records only the dirs the build modified — a committed lib/ is never captured', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                // "Committed" lib that the build does NOT touch.
                mkdirSync(join(ws.location, 'lib'), { recursive: true });
                writeFileSync(join(ws.location, 'lib', 'tracked.mjs'), 'committed source\n');
                const before = snapshotOutputDirs(ws.location);
                // Simulated build: writes dist only.
                mkdirSync(join(ws.location, 'dist'), { recursive: true });
                writeFileSync(join(ws.location, 'dist', 'bundle.js'), 'built\n');
                expect(modifiedOutputDirs(ws.location, before)).toStrictEqual(['dist']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('splits a dir-only candidate into per-child units so the dual emit cannot overlap', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                // The package convention: `build:gjsify` → lib/esm, `build:types` →
                // lib/types. Two scripts, ONE parent dir.
                mkdirSync(join(ws.location, 'lib', 'esm'), { recursive: true });
                mkdirSync(join(ws.location, 'lib', 'types'), { recursive: true });
                writeFileSync(join(ws.location, 'lib', 'esm', 'index.js'), 'export const x = 1;\n');
                writeFileSync(join(ws.location, 'lib', 'types', 'index.d.ts'), 'export declare const x: number;\n');
                expect(outputUnits(ws.location)).toStrictEqual(['lib/esm', 'lib/types']);

                // At whole-`lib` granularity a `build:types` hit would wipe `lib/esm`.
                const before = snapshotOutputDirs(ws.location);
                writeFileSync(join(ws.location, 'lib', 'types', 'other.d.ts'), 'export {};\n');
                expect(modifiedOutputDirs(ws.location, before)).toStrictEqual(['lib/types']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('does not let a .tsbuildinfo collapse the per-child units', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                // `@gjsify/semver`'s real shape: both emit dirs PLUS the incremental
                // state tsc writes beside them. That loose file used to flip ownership
                // back to the whole `lib`, so a `build:types` hit restored over — and
                // deleted — `lib/esm`.
                mkdirSync(join(ws.location, 'lib', 'esm'), { recursive: true });
                mkdirSync(join(ws.location, 'lib', 'types'), { recursive: true });
                writeFileSync(join(ws.location, 'lib', 'esm', 'index.js'), 'export const x = 1;\n');
                writeFileSync(join(ws.location, 'lib', 'types', 'index.d.ts'), 'export declare const x: number;\n');
                writeFileSync(join(ws.location, 'lib', 'tsconfig.build.tsbuildinfo'), '{"version":"5"}\n');

                expect(outputUnits(ws.location)).toStrictEqual(['lib/esm', 'lib/types']);

                // The types half must still claim only its own unit.
                const before = snapshotOutputDirs(ws.location);
                writeFileSync(join(ws.location, 'lib', 'types', 'other.d.ts'), 'export {};\n');
                expect(modifiedOutputDirs(ws.location, before)).toStrictEqual(['lib/types']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('ignores a rewritten .tsbuildinfo when deciding what a build modified', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                mkdirSync(join(ws.location, 'lib', 'esm'), { recursive: true });
                writeFileSync(join(ws.location, 'lib', 'esm', 'index.js'), 'export const x = 1;\n');
                writeFileSync(join(ws.location, 'lib', 'tsconfig.build.tsbuildinfo'), '{"version":"5"}\n');

                // tsc rewrites its state on every run. Treating that as a changed output
                // unit is how a restore into a tree whose emit never happened makes the
                // next `tsc` skip emitting and exit 0 with nothing written.
                const before = snapshotOutputDirs(ws.location);
                writeFileSync(join(ws.location, 'lib', 'tsconfig.build.tsbuildinfo'), '{"version":"5","n":1}\n');
                expect(modifiedOutputDirs(ws.location, before)).toStrictEqual([]);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('keeps whole-dir granularity when the candidate holds loose files', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                // `@gjsify/tsc` shape: committed loose `lib*.d.ts` files.
                mkdirSync(join(ws.location, 'lib'), { recursive: true });
                writeFileSync(join(ws.location, 'lib', 'lib.esnext.d.ts'), 'export {};\n');
                expect(outputUnits(ws.location)).toStrictEqual(['lib']);
                // …and a build that never touches it still records nothing.
                const before = snapshotOutputDirs(ws.location);
                mkdirSync(join(ws.location, 'dist'), { recursive: true });
                writeFileSync(join(ws.location, 'dist', 'bundle.js'), 'built\n');
                expect(modifiedOutputDirs(ws.location, before)).toStrictEqual(['dist']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('store → delete → restore round-trips the recorded dirs and leaves others alone', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                mkdirSync(join(ws.location, 'lib'), { recursive: true });
                writeFileSync(join(ws.location, 'lib', 'tracked.mjs'), 'committed source\n');
                mkdirSync(join(ws.location, 'dist', 'nested'), { recursive: true });
                writeFileSync(join(ws.location, 'dist', 'bundle.js'), 'built v1\n');
                writeFileSync(join(ws.location, 'dist', 'nested', 'part.js'), 'part\n');

                const cacheRoot = buildCacheRoot(root);
                const stored = storeCacheEntry(cacheRoot, ws, 'key1', 'build', ['dist']);
                expect(stored).not.toBe(null);
                const manifest = readCacheEntry(cacheRoot, ws.name, 'key1');
                expect(manifest?.dirs).toStrictEqual(['dist']);

                // Same content on disk → 'up-to-date' (no copy needed).
                expect(restoreCacheEntry(cacheRoot, ws, manifest!)).toBe('up-to-date');

                // Wipe + drift the outputs → full restore.
                rmSync(join(ws.location, 'dist'), { recursive: true, force: true });
                expect(restoreCacheEntry(cacheRoot, ws, manifest!)).toBe('restored');
                expect(readFileSync(join(ws.location, 'dist', 'bundle.js'), 'utf-8')).toBe('built v1\n');
                expect(readFileSync(join(ws.location, 'dist', 'nested', 'part.js'), 'utf-8')).toBe('part\n');
                // The un-recorded committed lib/ was never touched.
                expect(readFileSync(join(ws.location, 'lib', 'tracked.mjs'), 'utf-8')).toBe('committed source\n');

                // Unknown key / script mismatch are misses.
                expect(readCacheEntry(cacheRoot, ws.name, 'other-key')).toBe(null);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('prunes to the newest N entries per package', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                mkdirSync(join(ws.location, 'dist'), { recursive: true });
                const cacheRoot = buildCacheRoot(root);
                for (const key of ['key1', 'key2', 'key3']) {
                    writeFileSync(join(ws.location, 'dist', 'bundle.js'), `build for ${key}\n`);
                    storeCacheEntry(cacheRoot, ws, key, 'build', ['dist']);
                    // Distinct usedAt stamps (ISO strings sort lexicographically).
                    await new Promise((res) => setTimeout(res, 5));
                }
                const pkgDir = join(cacheRoot, sanitizePackageDirName(ws.name));
                expect(readdirSync(pkgDir).sort()).toStrictEqual(['key2', 'key3']);
                pruneCacheEntries(cacheRoot, ws.name, 1);
                expect(readdirSync(pkgDir)).toStrictEqual(['key3']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('runner tryRestore/storeAfterSuccess integrate hit and miss paths', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-build-cache-'));
            try {
                const ws = makeWorkspace(root, 'a', '@x/a');
                const runner = new BuildCacheRunner({ root, workspaces: [ws], script: 'build', log: quiet });
                // Cold cache: miss.
                expect(runner.tryRestore(ws)).toBe(false);
                const before = runner.snapshotOutputs(ws);
                mkdirSync(join(ws.location, 'lib'), { recursive: true });
                writeFileSync(join(ws.location, 'lib', 'out.js'), 'built\n');
                runner.storeAfterSuccess(ws, before);
                // Warm cache, same inputs: hit even after the outputs vanish.
                rmSync(join(ws.location, 'lib'), { recursive: true, force: true });
                const runner2 = new BuildCacheRunner({ root, workspaces: [ws], script: 'build', log: quiet });
                expect(runner2.tryRestore(ws)).toBe(true);
                expect(readFileSync(join(ws.location, 'lib', 'out.js'), 'utf-8')).toBe('built\n');
                // Different script name: miss (keys are script-scoped).
                const runner3 = new BuildCacheRunner({ root, workspaces: [ws], script: 'build:types', log: quiet });
                expect(runner3.tryRestore(ws)).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('build-cache: env toggle', async () => {
        await it('GJSIFY_BUILD_CACHE truthiness', async () => {
            expect(buildCacheEnabledByEnv({})).toBe(false);
            expect(buildCacheEnabledByEnv({ GJSIFY_BUILD_CACHE: '' })).toBe(false);
            expect(buildCacheEnabledByEnv({ GJSIFY_BUILD_CACHE: '0' })).toBe(false);
            expect(buildCacheEnabledByEnv({ GJSIFY_BUILD_CACHE: 'false' })).toBe(false);
            expect(buildCacheEnabledByEnv({ GJSIFY_BUILD_CACHE: '1' })).toBe(true);
            expect(buildCacheEnabledByEnv({ GJSIFY_BUILD_CACHE: 'true' })).toBe(true);
        });

        await it('sanitizePackageDirName is filesystem-safe and collision-resistant', async () => {
            const a = sanitizePackageDirName('@gjsify/cli');
            expect(a.startsWith('gjsify-cli-')).toBe(true);
            expect(/^[A-Za-z0-9._-]+$/.test(a)).toBe(true);
            expect(sanitizePackageDirName('@a/b-c')).not.toBe(sanitizePackageDirName('@a-b/c'));
        });
    });
};
