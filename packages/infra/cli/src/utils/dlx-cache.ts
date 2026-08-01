// Cache for `gjsify dlx` — content-addressable, atomic, parallel-safe.
//
// Pattern adapted from refs/pnpm/exec/commands/src/dlx.ts:
//   - cache key = sha256 over sorted [packages, registries]
//   - cache layout: <root>/<sha>/{pkg,timestamp-pid}/
//   - prepare into a fresh temp dir, then atomically swap a `pkg` symlink
//   - TTL via lstat mtime + maxAgeMinutes (default 7 days)

import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, type Stats } from 'node:fs';
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
 */
export function symlinkSwap(cacheDir: string, prepareDir: string): string {
    const linkPath = join(cacheDir, 'pkg');
    const tmpName = `pkg.tmp-${Date.now().toString(16)}-${process.pid.toString(16)}`;
    const tmpLink = join(cacheDir, tmpName);

    // If we cannot even create the tmp link, give up (the error propagates).
    linkDirSync(tmpLink, prepareDir);

    try {
        if (dirLinksAreJunctions()) {
            // Windows: no rename-over-a-directory. Removing first opens a window
            // in which `pkg` is absent; a concurrent reader treats that as a cache
            // miss and prepares its own, which is correct, just wasteful. force:true
            // keeps a first-ever swap (nothing to remove) from throwing.
            rmSync(linkPath, { force: true, recursive: false });
        }
        renameSync(tmpLink, linkPath);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EEXIST' || code === 'EACCES') {
            // Race lost — clean up our tmp and use whoever won. force:true is
            // the non-throwing spelling of "remove if still there"; any other
            // failure on our own pid-unique link is real and should surface.
            rmSync(tmpLink, { force: true });
            return realpathSync(linkPath);
        }
        throw err;
    }

    return realpathSync(linkPath);
}

/** Clean up `<cacheDir>/<oldPrepareDir>` siblings older than `maxAgeMinutes`. */
export function cleanupStalePrepareDirs(cacheDir: string, _maxAgeMinutes: number = DEFAULT_TTL_MIN): void {
    // Out of scope for Phase 1 — pnpm has the same TODO. Leaving a stub so
    // call sites already exist when we do implement it.
    void cacheDir;
}

/** Resolve absolute path to the installed package's directory inside cache. */
export function resolveInstalledPkgDir(cachedRoot: string, pkgName: string): string {
    return resolve(cachedRoot, 'node_modules', pkgName);
}
