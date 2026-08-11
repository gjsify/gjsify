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
 * The realpath of `<cacheDir>/pkg` when it is a symlink within its TTL; undefined
 * when the link is missing, is not a symlink, has been removed, or has expired.
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
 * WINDOWS breaks both halves:
 *
 *   • A directory SYMLINK needs elevation or Developer Mode, so step 1 goes
 *     through {@link linkDirSync} for an NTFS junction — the choice npm and yarn
 *     make. A raw `symlinkSync(…, 'dir')` died with `EPERM: operation not
 *     permitted, symlink` on a plain `npx @gjsify/cli@latest showcase …`.
 *   • Step 2's rename-over-existing is a POSIX guarantee only: `MoveFileEx` will
 *     not replace an existing DIRECTORY, and a junction is a directory reparse
 *     point. On the second run the rename fails `EPERM`, the catch below reads it
 *     as "race lost", and the OLD target comes back — not a crash, but worse: the
 *     cache silently never refreshes. Windows therefore unlinks first and accepts
 *     a non-atomic window, which the race handling already covers.
 *
 * @param opts.junctions force the Windows link strategy (TESTS ONLY), defaulting to
 *   the host's. A parameter for the same reason `dirLinkTarget` takes `linkKind`:
 *   nothing in CI runs on Windows, so an injected `true` is the ONLY way the
 *   unlink-then-rename ordering is ever EXECUTED. It proves the ORDERING and that a
 *   second swap really refreshes; it cannot prove `MoveFileEx`/junction syscall
 *   behaviour.
 */
export function symlinkSwap(cacheDir: string, prepareDir: string, opts: { junctions?: boolean } = {}): string {
    const junctions = opts.junctions ?? dirLinksAreJunctions();
    const linkPath = join(cacheDir, 'pkg');
    const tmpName = `pkg.tmp-${Date.now().toString(16)}-${process.pid.toString(16)}`;
    const tmpLink = join(cacheDir, tmpName);

    // If the tmp link cannot be created, give up (the error propagates).
    linkDirSync(tmpLink, prepareDir);

    try {
        if (junctions) {
            // Windows: no rename-over-a-directory. Removing first opens a window in
            // which `pkg` is absent; a concurrent reader treats that as a miss and
            // prepares its own — correct, just wasteful. `force:true` keeps a
            // first-ever swap (nothing to remove) from throwing.
            //
            // maxRetries/retryDelay for the same reason `install-backend-native.ts`
            // wraps deletes in `rmWithRetry`: on Windows a delete fails EBUSY/EPERM
            // while ANY process holds a handle (an antivirus scan, a concurrent
            // reader that just realpath'd this link) and then stays PENDING, so
            // without the retry a transient handle takes the "race lost" branch and
            // the cache silently does not refresh. Free on POSIX.
            rmSync(linkPath, { force: true, recursive: false, maxRetries: 10, retryDelay: 100 });
        }
        renameSync(tmpLink, linkPath);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EEXIST' || code === 'EACCES') {
            // Race lost — clean up our tmp and use whoever won. `force:true` is the
            // non-throwing "remove if still there"; any other failure on our own
            // pid-unique link is real and should surface.
            rmSync(tmpLink, { force: true });
            try {
                return realpathSync(linkPath);
            } catch {
                // Windows only, because the junction path unlinks before it renames:
                // "race lost" can also mean the winner is INSIDE that non-atomic
                // window, so `pkg` momentarily does not exist and this would throw
                // ENOENT out to a caller that reports it as `Could not resolve
                // showcase "<name>"`. Our own prepareDir is a complete, correctly
                // installed tree — a truthful answer for THIS run, and the next run
                // reads whichever link won.
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
 * Every `gjsify dlx` miss creates a fresh prepare dir and swaps the `pkg` link onto
 * it, leaving the previous one unreferenced — a full npm tree per miss, the largest
 * thing gjsify writes to a user's cache.
 *
 * Three rules keep it from deleting something it should not:
 *
 *   1. **Only names `makePrepareDir` could have produced** (`<hex>-<hex>`). The
 *      cache dir also holds `pkg` and, briefly, `pkg.tmp-<ts>-<pid>` links from a
 *      concurrent swap; the name-shape guard is what makes "delete the rest" safe
 *      against anything a future version puts here.
 *   2. **Never the LIVE target**, whatever its age — a still-current entry ages
 *      past any TTL precisely because it is used on every run.
 *   3. **Never throws.** Best-effort housekeeping: a lost race against a parallel
 *      dlx, or a read-only cache, must not fail the command the user ran.
 */
export function cleanupStalePrepareDirs(cacheDir: string, maxAgeMinutes: number = DEFAULT_TTL_MIN): void {
    const cutoff = Date.now() - maxAgeMinutes * ONE_MINUTE_MS;

    // An unreadable or absent `pkg` link means nothing is live yet, so every prepare
    // dir is a candidate.
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
            // Lost a race with another dlx, or the entry vanished between readdir and
            // stat. Both mean someone else handled it.
        }
    }
}

/** Resolve absolute path to the installed package's directory inside cache. */
export function resolveInstalledPkgDir(cachedRoot: string, pkgName: string): string {
    return resolve(cachedRoot, 'node_modules', pkgName);
}
