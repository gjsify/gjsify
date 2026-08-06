// Cache for `gjsify dlx` — content-addressable, atomic, parallel-safe.
//
// Pattern adapted from refs/pnpm/exec/commands/src/dlx.ts:
//   - cache key = sha256 over sorted [packages, registries]
//   - cache layout: <root>/<sha>/{pkg,timestamp-pid}/
//   - prepare into a fresh temp dir, then atomically swap a `pkg` symlink
//   - TTL via lstat mtime + maxAgeMinutes (default 7 days)

import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirLinksAreJunctions, linkDirSync } from './dir-link.js';

const ONE_MINUTE_MS = 60_000;
const DEFAULT_TTL_MIN = 60 * 24 * 7; // 7 days

function lexCompare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

interface CacheKeyOpts {
    packages: string[];
    registries?: Record<string, string>;
}

/** Stable, sorted JSON hash of inputs. */
export function createCacheKey(opts: CacheKeyOpts): string {
    const sortedPkgs = [...opts.packages].sort(lexCompare);
    const sortedRegs = Object.entries(opts.registries ?? {}).sort(([a], [b]) => lexCompare(a, b));
    const payload = JSON.stringify([sortedPkgs, sortedRegs]);
    return createHash('sha256').update(payload).digest('hex');
}

/** $XDG_CACHE_HOME/gjsify/dlx — created if missing. */
export function dlxCacheRoot(): string {
    const xdg = process.env.XDG_CACHE_HOME;
    const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
    const root = join(base, 'gjsify', 'dlx');
    mkdirSync(root, { recursive: true });
    return root;
}

/** Per-key cache directory: <root>/<sha>. */
export function cacheDirFor(cacheKey: string): string {
    const dir = join(dlxCacheRoot(), cacheKey);
    mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * The exact shape {@link makePrepareDir} produces — two lowercase-hex fields.
 * {@link cleanupStalePrepareDirs} deletes ONLY names matching this, so the
 * two must move together.
 */
const PREPARE_DIR_NAME = /^[0-9a-f]+-[0-9a-f]+$/;

/** A fresh prepare directory under the per-key cache, named timestamp-pid. */
export function makePrepareDir(cacheDir: string): string {
    const name = `${Date.now().toString(16)}-${process.pid.toString(16)}`;
    const dir = join(cacheDir, name);
    mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * If <cacheDir>/pkg points to a target whose mtime + maxAge < now, return its
 * realpath. Returns undefined when the link doesn't exist, isn't a symlink,
 * has been removed, or has expired.
 */
export function getValidCachedPkg(cacheDir: string, maxAgeMinutes: number = DEFAULT_TTL_MIN): string | undefined {
    const linkPath = join(cacheDir, 'pkg');
    let stats: Stats;
    try {
        stats = lstatSync(linkPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw err;
    }
    if (!stats.isSymbolicLink()) return undefined;

    let target: string;
    try {
        target = realpathSync(linkPath);
    } catch {
        return undefined;
    }

    const ageMs = Date.now() - stats.mtime.getTime();
    return ageMs <= maxAgeMinutes * ONE_MINUTE_MS ? target : undefined;
}

/**
 * Atomically swap `<cacheDir>/pkg` to point at `prepareDir`.
 *
 * Strategy:
 *   1. Create new link `<cacheDir>/pkg.tmp-<ts>-<pid>` → prepareDir.
 *   2. `rename(pkg.tmp-…, pkg)` — POSIX guarantees rename-over-existing is atomic.
 *
 * Returns the realpath of the new live target. EBUSY/EEXIST indicates a race
 * — a parallel process won, return its realpath.
 *
 * WINDOWS, both halves of which shipped broken:
 *
 *   • Step 1 used `symlinkSync(…, 'dir')`, and a directory SYMLINK needs
 *     elevation or Developer Mode there, so a plain
 *     `npx @gjsify/cli@latest showcase …` died with `EPERM: operation not
 *     permitted, symlink`. It now goes through {@link linkDirSync}, which picks
 *     an NTFS junction — the same choice npm and yarn make, and the one
 *     `commands/install.ts` already made for workspace links without sharing it.
 *   • Step 2's rename-over-existing is a POSIX guarantee, not a Windows one:
 *     `MoveFileEx` will not replace an existing DIRECTORY, and a junction is a
 *     directory reparse point. So on the second run — when `pkg` already exists
 *     — the rename failed with `EPERM`, the catch below read that as "race
 *     lost", and the function returned the OLD target. That is not a crash but
 *     it is worse than one: the cache silently never refreshed. Windows
 *     therefore unlinks first and accepts the non-atomic window, which the
 *     existing race handling already covers.
 *
 * @param opts.junctions force the Windows link strategy (TESTS ONLY). Defaults
 *   to the host's. It is a parameter for the same reason `dirLinkTarget` takes
 *   `linkType`: nothing in CI runs on Windows, so an injected `true` is the ONLY
 *   way the unlink-then-rename ordering above is ever EXECUTED, and an
 *   unexecutable Windows branch is exactly how the `'dir'` bug shipped. What the
 *   injection proves off-host is the ORDERING and that the second swap really
 *   refreshes; what it cannot prove is `MoveFileEx`/junction syscall behaviour.
 */
export function symlinkSwap(cacheDir: string, prepareDir: string, opts: { junctions?: boolean } = {}): string {
    const junctions = opts.junctions ?? dirLinksAreJunctions();
    const linkPath = join(cacheDir, 'pkg');
    const tmpName = `pkg.tmp-${Date.now().toString(16)}-${process.pid.toString(16)}`;
    const tmpLink = join(cacheDir, tmpName);

    // If we cannot even create the tmp link, give up (the error propagates).
    linkDirSync(tmpLink, prepareDir);

    try {
        if (junctions) {
            // Windows: no rename-over-a-directory. Removing first opens a window
            // in which `pkg` is absent; a concurrent reader treats that as a cache
            // miss and prepares its own, which is correct, just wasteful. force:true
            // keeps a first-ever swap (nothing to remove) from throwing.
            //
            // maxRetries/retryDelay for the same reason `install-backend-native.ts`
            // wraps every delete in `rmWithRetry`: on Windows a delete fails with
            // EBUSY/EPERM while ANY process holds a handle (an antivirus scan, a
            // concurrent reader that just realpath'd this very link), and the
            // deletion then stays PENDING — so without the retry a transient
            // handle sends us down the "race lost" branch and the cache silently
            // does not refresh. Free on POSIX, where the first attempt succeeds.
            rmSync(linkPath, { force: true, recursive: false, maxRetries: 10, retryDelay: 100 });
        }
        renameSync(tmpLink, linkPath);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EEXIST' || code === 'EACCES') {
            // Race lost — clean up our tmp and use whoever won. force:true is
            // the non-throwing spelling of "remove if still there"; any other
            // failure on our own pid-unique link is real and should surface.
            rmSync(tmpLink, { force: true });
            try {
                return realpathSync(linkPath);
            } catch {
                // Windows only, and only because the junction path unlinks before
                // it renames: "race lost" can also mean the winner is INSIDE that
                // non-atomic window, so `pkg` momentarily does not exist and this
                // would throw ENOENT out of a function whose caller reports it to
                // the user as `Could not resolve showcase "<name>"`. Our own
                // prepareDir is a complete, correctly installed tree — a truthful
                // answer for THIS run. The next run reads whichever link won.
                return realpathSync(prepareDir);
            }
        }
        throw err;
    }

    return realpathSync(linkPath);
}

/**
 * Remove `<cacheDir>/<oldPrepareDir>` siblings older than `maxAgeMinutes`.
 *
 * Every `gjsify dlx` miss creates a fresh prepare dir and swaps the `pkg` link
 * onto it; the previous one is then unreferenced and stayed on disk forever,
 * because this function accepted a TTL and did nothing with it. A full npm tree
 * per miss makes that the largest thing gjsify writes to a user's cache.
 *
 * Three rules keep it from deleting something it should not:
 *
 *   1. **Only names `makePrepareDir` could have produced** (`<hex>-<hex>`). The
 *      cache dir also holds `pkg` and, briefly, `pkg.tmp-<ts>-<pid>` links from
 *      a concurrent swap — and a name-shape guard is what makes "delete the
 *      rest" safe against anything a future version puts here.
 *   2. **Never the LIVE target**, whatever its age. A long-lived cache entry
 *      that is still current is exactly the one worth keeping, and it ages past
 *      any TTL while being used on every run.
 *   3. **Never throws.** This is housekeeping on a best-effort path: a losing
 *      race (a parallel dlx removing the same dir) or a read-only cache must not
 *      fail the command the user actually ran.
 */
export function cleanupStalePrepareDirs(cacheDir: string, maxAgeMinutes: number = DEFAULT_TTL_MIN): void {
    const cutoff = Date.now() - maxAgeMinutes * ONE_MINUTE_MS;

    // The live target, resolved once. An unreadable or absent `pkg` link simply
    // means nothing is live yet — every prepare dir is then a candidate.
    let live: string | undefined;
    try {
        live = realpathSync(join(cacheDir, 'pkg'));
    } catch {
        live = undefined;
    }

    let entries: string[];
    try {
        entries = readdirSync(cacheDir);
    } catch {
        return;
    }

    for (const name of entries) {
        if (!PREPARE_DIR_NAME.test(name)) continue;
        const dir = join(cacheDir, name);
        try {
            if (live !== undefined && realpathSync(dir) === live) continue;
            if (lstatSync(dir).mtimeMs >= cutoff) continue;
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
            // Lost a race with another dlx, or the entry vanished between the
            // readdir and the stat. Both mean "someone else handled it".
        }
    }
}

/** Resolve absolute path to the installed package's directory inside cache. */
export function resolveInstalledPkgDir(cachedRoot: string, pkgName: string): string {
    return resolve(cachedRoot, 'node_modules', pkgName);
}
