// Cache for `gjsify dlx` — content-addressable, atomic, parallel-safe.
//
// Pattern adapted from refs/pnpm/exec/commands/src/dlx.ts:
//   - cache key = sha256 over sorted [packages, registries]
//   - cache layout: <root>/<sha>/{pkg,timestamp-pid}/
//   - prepare into a fresh temp dir, then atomically swap a `pkg` symlink
//   - TTL via lstat mtime + maxAgeMinutes (default 7 days)

import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

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
export function getValidCachedPkg(
    cacheDir: string,
    maxAgeMinutes: number = DEFAULT_TTL_MIN,
): string | undefined {
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
 *   1. Create new symlink `<cacheDir>/pkg-<rand>` → prepareDir.
 *   2. `rename(pkg-<rand>, pkg)` — POSIX guarantees rename-over-existing is atomic.
 *
 * Returns the realpath of the new live target. EBUSY/EEXIST indicates a race
 * — a parallel process won, return its realpath.
 */
export function symlinkSwap(cacheDir: string, prepareDir: string): string {
    const linkPath = join(cacheDir, 'pkg');
    const tmpName = `pkg.tmp-${Date.now().toString(16)}-${process.pid.toString(16)}`;
    const tmpLink = join(cacheDir, tmpName);

    try {
        symlinkSync(prepareDir, tmpLink, 'dir');
    } catch (err) {
        // If we cannot even create the tmp link, give up.
        throw err;
    }

    try {
        renameSync(tmpLink, linkPath);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EEXIST') {
            // Race lost — clean up our tmp and use whoever won.
            try { rmSync(tmpLink); } catch {}
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
