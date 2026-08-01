// SPDX-License-Identifier: MIT
// Unit tests for the `gjsify dlx` cache — the cache behind
// `npx @gjsify/cli@latest showcase <name>`.
//
// WHY THIS FILE EXISTS. The cache had no tests at all, and the thing it does on
// the SECOND run — swap the live `pkg` link to a freshly prepared tree — is
// where both Windows defects lived: a directory *symlink* Windows refuses
// without elevation (EPERM), and a rename-over-existing that Windows performs
// for files but not for directories, which made the swap silently return the OLD
// target instead of failing. The second one is the dangerous shape: not a crash,
// a cache that never refreshes.
//
// So the Windows ORDERING is executed here, on Linux, by injecting
// `{ junctions: true }` — the same trick `dir-link.spec.ts` and
// `detect-native-packages.spec.ts` use, and the only way that branch is ever run
// by a repo whose CI has no Windows leg. What is NOT covered, and cannot be
// off-host: whether Windows accepts the junction and whether `MoveFileEx`
// behaves as assumed. What IS covered is that the swap REFRESHES on both paths.

import { describe, it, expect } from '@gjsify/unit';
import { lutimesSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCacheKey, getValidCachedPkg, symlinkSwap } from './dlx-cache.js';

/** A cache dir plus two prepared trees, each tagged so we can tell them apart. */
function fixture() {
    // `realpathSync` is load-bearing, not tidiness. `prepare()` below returns a
    // CANONICAL path, while `os.tmpdir()` on macOS is `/var/folders/…` and
    // `/var` is a symlink to `/private/var`. Mixing the two spaces breaks the
    // link `symlinkSwap` writes: POSIX dir links are deliberately RELATIVE
    // (`dirLinkTarget`), computed from the link's own directory, so a relative
    // path from `/var/…/cachekey` to `/private/var/…/cachekey/tree-a` resolves
    // from the link's REAL parent and lands nowhere — `realpathSync(linkPath)`
    // then throws ENOENT out of `symlinkSwap`. Canonicalising the root puts
    // both sides in one space; a no-op wherever `/tmp` is already real.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'gjsify-dlx-cache-')));
    const cacheDir = join(root, 'cachekey');
    mkdirSync(cacheDir, { recursive: true });
    const prepare = (tag: string) => {
        const dir = join(cacheDir, tag);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'which.txt'), tag);
        return realpathSync(dir);
    };
    return { root, cacheDir, prepare, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export default async () => {
    await describe('createCacheKey', async () => {
        await it('is order-independent — the same set is one cache entry', async () => {
            const a = createCacheKey({ packages: ['@gjsify/example-x@1.0.0', '@gjsify/node-gi@1.0.0'] });
            const b = createCacheKey({ packages: ['@gjsify/node-gi@1.0.0', '@gjsify/example-x@1.0.0'] });
            expect(a).toBe(b);
        });

        await it('separates the gjs tree from the node tree', async () => {
            // `showcase --runtime node` adds `@gjsify/node-gi` via `extraSpecs`,
            // which is part of the key precisely so the two trees never collide
            // (a gjs-only tree has no bridge and would fail the node launch).
            const gjsTree = createCacheKey({ packages: ['@gjsify/example-x@1.0.0'] });
            const nodeTree = createCacheKey({ packages: ['@gjsify/example-x@1.0.0', '@gjsify/node-gi@1.0.0'] });
            expect(gjsTree).not.toBe(nodeTree);
        });

        await it('separates entries by registry', async () => {
            const npmjs = createCacheKey({ packages: ['x@1'], registries: { '': 'https://registry.npmjs.org/' } });
            const other = createCacheKey({ packages: ['x@1'], registries: { '': 'https://other.example/' } });
            expect(npmjs).not.toBe(other);
        });
    });

    await describe('symlinkSwap', async () => {
        await it('points `pkg` at the prepared tree on a first-ever swap', async () => {
            const { cacheDir, prepare, cleanup } = fixture();
            try {
                const first = prepare('tree-a');
                expect(symlinkSwap(cacheDir, first)).toBe(first);
                expect(getValidCachedPkg(cacheDir)).toBe(first);
            } finally {
                cleanup();
            }
        });

        await it('REFRESHES an existing `pkg` on the POSIX path', async () => {
            const { cacheDir, prepare, cleanup } = fixture();
            try {
                symlinkSwap(cacheDir, prepare('tree-a'), { junctions: false });
                const second = prepare('tree-b');
                expect(symlinkSwap(cacheDir, second, { junctions: false })).toBe(second);
                expect(getValidCachedPkg(cacheDir)).toBe(second);
            } finally {
                cleanup();
            }
        });

        await it('REFRESHES an existing `pkg` on the WINDOWS path (junctions forced)', async () => {
            // The regression pin. With the unlink omitted, the rename-over-existing
            // that POSIX guarantees is not one Windows makes for a directory: the
            // rename failed, the catch read EPERM as "race lost", and the function
            // returned the OLD target — a cache that never refreshed, for as long
            // as the 7-day TTL. Asserting the SECOND swap wins is what catches it.
            const { cacheDir, prepare, cleanup } = fixture();
            try {
                const first = prepare('tree-a');
                symlinkSwap(cacheDir, first, { junctions: true });
                const second = prepare('tree-b');
                expect(symlinkSwap(cacheDir, second, { junctions: true })).toBe(second);
                expect(getValidCachedPkg(cacheDir)).toBe(second);
                expect(getValidCachedPkg(cacheDir)).not.toBe(first);
            } finally {
                cleanup();
            }
        });

        await it('leaves no `pkg.tmp-…` link behind on either path', async () => {
            // A leaked tmp link is not inert: `cleanupStalePrepareDirs` is still a
            // stub, so nothing else ever removes it.
            const { cacheDir, prepare, cleanup } = fixture();
            try {
                for (const junctions of [false, true]) {
                    symlinkSwap(cacheDir, prepare(`tree-${junctions}`), { junctions });
                }
                const leftovers = readdirSync(cacheDir).filter((e) => e.startsWith('pkg.tmp-'));
                expect(leftovers.length).toBe(0);
            } finally {
                cleanup();
            }
        });
    });

    await describe('getValidCachedPkg', async () => {
        await it('is a MISS when nothing has been swapped in yet', async () => {
            const { cacheDir, cleanup } = fixture();
            try {
                expect(getValidCachedPkg(cacheDir)).toBe(undefined);
            } finally {
                cleanup();
            }
        });

        await it('is a MISS once the link is older than the TTL', async () => {
            const { cacheDir, prepare, cleanup } = fixture();
            try {
                const tree = prepare('tree-a');
                symlinkSwap(cacheDir, tree);
                // Backdate the LINK itself (lutimes, not utimes — the TTL is read
                // from `lstat`, so touching the target would prove nothing).
                const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
                lutimesSync(join(cacheDir, 'pkg'), twoHoursAgo, twoHoursAgo);
                expect(getValidCachedPkg(cacheDir, 60)).toBe(undefined);
                expect(getValidCachedPkg(cacheDir, 60 * 24)).toBe(tree);
            } finally {
                cleanup();
            }
        });

        await it('is a MISS when the link target has been removed', async () => {
            const { cacheDir, prepare, cleanup } = fixture();
            try {
                const tree = prepare('tree-a');
                symlinkSwap(cacheDir, tree);
                rmSync(tree, { recursive: true, force: true });
                expect(getValidCachedPkg(cacheDir)).toBe(undefined);
            } finally {
                cleanup();
            }
        });
    });
};
