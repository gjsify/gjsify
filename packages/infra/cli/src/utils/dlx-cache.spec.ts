// SPDX-License-Identifier: MIT
//
// Both Windows defects lived in what the cache does on the SECOND run — swap the
// live `pkg` link to a freshly prepared tree: a directory *symlink* Windows
// refuses without elevation (EPERM), and a rename-over-existing Windows performs
// for files but not for directories, which made the swap silently return the OLD
// target instead of failing. The second is the dangerous shape — not a crash, a
// cache that never refreshes.
//
// The Windows ORDERING therefore runs here, on Linux, by injecting
// `{ junctions: true }`, the only way that branch executes in a repo whose CI has
// no Windows leg. NOT coverable off-host: whether Windows accepts the junction and
// whether `MoveFileEx` behaves as assumed. What IS covered is that the swap
// REFRESHES on both paths.

import { describe, it, expect } from '@gjsify/unit';
import {
    existsSync,
    lutimesSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    cleanupStalePrepareDirs,
    createCacheKey,
    getValidCachedPkg,
    makePrepareDir,
    symlinkSwap,
} from './dlx-cache.js';

/** A cache dir plus two prepared trees, each tagged so we can tell them apart. */
function fixture() {
    // `realpathSync` is load-bearing. `prepare()` returns a CANONICAL path, while
    // `os.tmpdir()` on macOS is `/var/folders/…` and `/var` symlinks to
    // `/private/var`. POSIX dir links are deliberately RELATIVE (`dirLinkTarget`),
    // computed from the link's own directory, so mixing the two spaces makes the
    // relative path resolve from the link's REAL parent and land nowhere —
    // `realpathSync(linkPath)` then throws ENOENT out of `symlinkSwap`.
    // Canonicalising the root is a no-op wherever `/tmp` is already real.
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
            // `showcase --runtime node` adds `@gjsify/node-gi` via `extraSpecs`, which
            // is part of the key so the two trees never collide — a gjs-only tree has
            // no bridge and would fail the node launch.
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

        await it.failing(
            'REFRESHES an existing `pkg` on the POSIX path',
            async () => {
                const { cacheDir, prepare, cleanup } = fixture();
                try {
                    symlinkSwap(cacheDir, prepare('tree-a'), { junctions: false });
                    const second = prepare('tree-b');
                    expect(symlinkSwap(cacheDir, second, { junctions: false })).toBe(second);
                    expect(getValidCachedPkg(cacheDir)).toBe(second);
                } finally {
                    cleanup();
                }
            },
            // `junctions: false` FORCES the POSIX strategy, whose atomic
            // rename-over-an-existing-symlink win32 does not provide: there the rename
            // fails, the catch reads it as "race lost", and the OLD target comes back
            // (measured on the Windows leg as `tree-a` where `tree-b` was expected).
            // Declared rather than skipped or guarded: the combination never occurs in
            // production — the CLI picks junctions on win32 — but the assertion still
            // RUNS there and fails the day Windows honours it.
            'the POSIX rename-over-existing-symlink refresh is not a guarantee win32 makes for a directory entry',
            { when: process.platform === 'win32' },
        );

        await it('REFRESHES an existing `pkg` on the WINDOWS path (junctions forced)', async () => {
            // The regression pin: with the unlink omitted the rename failed, the catch
            // read EPERM as "race lost", and the function returned the OLD target — a
            // cache that never refreshed for the whole 7-day TTL.
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
            // Nothing else removes a leaked tmp link: `cleanupStalePrepareDirs`
            // deliberately skips `pkg.tmp-…`, because a name matching a concurrent
            // swap mid-flight is the one thing a sweeper must not touch.
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
    await describe('cleanupStalePrepareDirs', async () => {
        /** Age a directory by rewriting its own mtime. */
        const age = (dir: string, minutes: number) => {
            const when = new Date(Date.now() - minutes * 60_000);
            utimesSync(dir, when, when);
        };

        await it('removes an unreferenced prepare dir past the TTL', async () => {
            const { cacheDir, cleanup } = fixture();
            try {
                const stale = makePrepareDir(cacheDir);
                age(stale, 120);
                cleanupStalePrepareDirs(cacheDir, 60);
                expect(existsSync(stale)).toBe(false);
            } finally {
                cleanup();
            }
        });

        await it('keeps one inside the TTL', async () => {
            const { cacheDir, cleanup } = fixture();
            try {
                const fresh = makePrepareDir(cacheDir);
                age(fresh, 10);
                cleanupStalePrepareDirs(cacheDir, 60);
                expect(existsSync(fresh)).toBe(true);
            } finally {
                cleanup();
            }
        });

        await it('never removes the LIVE target, however old it is', async () => {
            // An entry still pointed at by `pkg` ages past any TTL precisely BECAUSE
            // it keeps being reused; deleting it turns a warm cache into a guaranteed
            // miss plus a dangling link.
            const { cacheDir, cleanup } = fixture();
            try {
                const live = makePrepareDir(cacheDir);
                symlinkSwap(cacheDir, live);
                age(live, 60 * 24 * 400);
                cleanupStalePrepareDirs(cacheDir, 60);
                expect(existsSync(live)).toBe(true);
                expect(getValidCachedPkg(cacheDir, 60 * 24 * 500)).toBe(live);
            } finally {
                cleanup();
            }
        });

        await it('touches nothing whose name it did not create', async () => {
            // `pkg` is the live link, `pkg.tmp-…` a concurrent swap mid-flight, and
            // `tree-a` anything a future version might put here — a stale-by-mtime
            // sweep with no name guard would take all three.
            const { cacheDir, prepare, cleanup } = fixture();
            try {
                const foreign = prepare('tree-a');
                const tmpLink = join(cacheDir, 'pkg.tmp-deadbeef-1');
                mkdirSync(tmpLink, { recursive: true });
                age(foreign, 60 * 24 * 30);
                age(tmpLink, 60 * 24 * 30);
                cleanupStalePrepareDirs(cacheDir, 60);
                expect(existsSync(foreign)).toBe(true);
                expect(existsSync(tmpLink)).toBe(true);
            } finally {
                cleanup();
            }
        });

        await it('is silent on a cache dir that does not exist', async () => {
            // Best-effort housekeeping must never fail the command the user ran.
            cleanupStalePrepareDirs(join(tmpdir(), 'gjsify-dlx-cache-absent-xyz'), 60);
        });
    });
};
