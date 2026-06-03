// On-disk packument metadata cache for `gjsify install`.
//
// Sibling to the content-addressable tarball cache (install-tarball-cache.ts).
// Stores each package's abbreviated packument plus the registry `ETag` it came
// with, so a re-resolve (lockfile miss — e.g. a dependency range changed) can
// send a conditional `If-None-Match` and skip re-downloading the body for every
// unchanged package. Packuments are fetched with `accept-encoding: identity`
// (a libsoup chunked-gzip workaround), so each is ~60–98 KB uncompressed —
// turning the unchanged majority into empty `304 Not Modified` responses is a
// real bandwidth + parse saving on repeated/dep-churn installs.
//
// Mirrors pnpm's metadata cache + npm's make-fetch-happen HTTP-cache layer.
//
// Layout:
//
//   $XDG_CACHE_HOME/gjsify/metadata/v1/<shard>/<encoded-registry>|<encoded-name>.json
//
// The cache is keyed by (registry, name) — NOT name alone — so switching the
// registry for a scope can never serve a packument from the wrong source on a
// coincidental ETag match. `<shard>` is a 2-hex FNV-1a digest of the key, a
// directory-fan-out step so the leaf dir never grows unbounded (same rationale
// as the tarball cache's hex sharding). `v1` is a layout version.
//
// Disabled with `GJSIFY_PACKUMENT_CACHE=0` (or `false`). Honours
// `XDG_CACHE_HOME` like the tarball + dlx caches.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Packument } from '@gjsify/npm-registry';

const CACHE_LAYOUT_VERSION = 'v1';

interface PackumentCacheEntry {
    /** Registry ETag the body was served with (the `If-None-Match` value). */
    etag: string;
    /** The abbreviated packument, as returned + validated by the registry. */
    packument: Packument;
}

export interface CachedPackument {
    etag: string;
    packument: Packument;
}

/** `true` unless `GJSIFY_PACKUMENT_CACHE` is `0` / `false` / empty. */
function isEnabled(): boolean {
    const flag = process.env.GJSIFY_PACKUMENT_CACHE;
    if (flag === undefined) return true;
    const trimmed = flag.trim();
    return !(trimmed === '0' || trimmed === 'false' || trimmed === '');
}

/** Root of the packument cache, honouring `XDG_CACHE_HOME`. */
function cacheRoot(): string {
    const xdg = process.env.XDG_CACHE_HOME;
    const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
    return join(base, 'gjsify', 'metadata', CACHE_LAYOUT_VERSION);
}

/** FNV-1a 32-bit → 2 hex chars. Directory-fan-out only; not security-sensitive. */
function shardFor(key: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return ((h >>> 0) & 0xff).toString(16).padStart(2, '0');
}

/** Filesystem path for a (registry, name) pair, or `null` when disabled. */
function pathFor(registry: string, name: string): string | null {
    if (!isEnabled()) return null;
    const key = `${registry}|${name}`;
    // encodeURIComponent makes both halves filesystem-safe (`/` → `%2F`, etc.)
    // while staying a stable, reversible, single path segment.
    const file = `${encodeURIComponent(registry)}|${encodeURIComponent(name)}.json`;
    return join(cacheRoot(), shardFor(key), file);
}

/**
 * Read a cached packument + its ETag for `(registry, name)`. Returns `null` on
 * a miss, when the cache is disabled, or when the entry is unreadable/corrupt
 * (treated as a miss — the caller just re-fetches).
 */
export function getCachedPackument(registry: string, name: string): CachedPackument | null {
    const path = pathFor(registry, name);
    if (!path) return null;
    if (!existsSync(path)) return null;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PackumentCacheEntry>;
        if (typeof parsed.etag !== 'string' || !parsed.etag) return null;
        if (!parsed.packument || typeof parsed.packument !== 'object') return null;
        return { etag: parsed.etag, packument: parsed.packument as Packument };
    } catch {
        return null;
    }
}

/**
 * Persist a packument + ETag for `(registry, name)`. Writes to a `<path>.tmp.<pid>`
 * sibling then atomically renames so a concurrent reader never sees a partial
 * write. No-op when the cache is disabled, the ETag is empty, or the write
 * fails (read-only / out-of-disk cache volume must not break the install).
 */
export function putCachedPackument(registry: string, name: string, etag: string, packument: Packument): void {
    if (!etag) return;
    const path = pathFor(registry, name);
    if (!path) return;
    try {
        mkdirSync(join(path, '..'), { recursive: true });
        const entry: PackumentCacheEntry = { etag, packument };
        const tmp = `${path}.tmp.${process.pid}`;
        writeFileSync(tmp, JSON.stringify(entry));
        renameSync(tmp, path);
    } catch {
        // Best-effort — a cache-write failure leaves the install to proceed
        // with the in-memory packument; we just won't get a 304 next run.
    }
}
