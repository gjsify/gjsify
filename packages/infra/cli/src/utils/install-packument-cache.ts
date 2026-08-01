// On-disk packument metadata cache for `gjsify install`.
//
// Sibling to the content-addressable tarball cache (install-tarball-cache.ts).
// Stores each package's abbreviated packument plus the registry `ETag` it came
// with, so a re-resolve (lockfile miss — e.g. a dependency range changed) can
// send a conditional `If-None-Match` and turn the unchanged majority into empty
// `304 Not Modified` responses — a real bandwidth + parse saving on repeated /
// dep-churn installs, on top of the ~4× gzip transfer for the changed minority
// (packuments are fetched gzip-compressed and decoded by the fetch layer; see
// `@gjsify/npm-registry` `fetchPackumentConditional`).
//
// Mirrors pnpm's metadata cache + npm's make-fetch-happen HTTP-cache layer.
//
// Layout:
//
//   $XDG_CACHE_HOME/gjsify/metadata/v2/<shard>/<encoded-registry>,<encoded-name>.json
//
// The cache is keyed by (registry, name) — NOT name alone — so switching the
// registry for a scope can never serve a packument from the wrong source on a
// coincidental ETag match. `<shard>` is a 2-hex FNV-1a digest of the key, a
// directory-fan-out step so the leaf dir never grows unbounded (same rationale
// as the tarball cache's hex sharding). `v2` is a layout version.
//
// Disabled with `GJSIFY_PACKUMENT_CACHE=0` (or `false`). Honours
// `XDG_CACHE_HOME` like the tarball + dlx caches.

import { join } from 'node:path';

import type { Packument } from '@gjsify/npm-registry';

import { atomicWrite, gjsifyCacheRoot, readCacheFile } from './install-cache-fs.js';

// v2: the separator changed from the Win32-reserved `|` to `,` (see `pathFor`),
// so every v1 entry is unreachable rather than merely stale — a new root retires
// them instead of leaving orphans under the old one.
const CACHE_LAYOUT_VERSION = 'v2';

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

/** Root of the packument cache: `$XDG_CACHE_HOME/gjsify/metadata/v2`. */
function cacheRoot(): string {
    return gjsifyCacheRoot('metadata', CACHE_LAYOUT_VERSION);
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

/**
 * One path part, made safe for EVERY filesystem we run on.
 *
 * `encodeURIComponent` alone is not enough: it deliberately leaves `*` (and
 * `!'()`) unescaped, and `*` is one of Win32's reserved filename characters.
 * A scoped package never contains one today, but a registry URL can, and the
 * failure mode is the silent one described on {@link pathFor}.
 */
function encodePart(part: string): string {
    return encodeURIComponent(part).replace(/\*/g, '%2A');
}

/**
 * The cache key for a (registry, name) pair — exported so the filename rule
 * below is a PROPERTY a test can assert, not a claim in a comment.
 *
 * THE SEPARATOR IS NOT COSMETIC. It used to be `|`, producing names like
 * `corgi|https%3A%2F%2Fregistry.npmjs.org%2F|%40gjsify%2Fnode-gi.json` — and `|`
 * is a Win32 RESERVED filename character, so every write failed with `EINVAL`.
 * Nothing reported it: `atomicWrite` is best-effort on purpose (a read-only
 * cache volume must not break an install) and `readCacheFile` reads an
 * unreadable path as a MISS. So on Windows this cache was never broken loudly —
 * it was silently DEAD, and the `If-None-Match` → `304` revalidation that is the
 * entire reason this file exists never engaged once.
 *
 * `,` is legal on Win32 AND escaped by `encodeURIComponent`, which is what keeps
 * a flat two-part name injective: an encoded part cannot contain the separator,
 * so exactly one `(registry, name)` pair maps to any given filename.
 *
 * The shard key and the filename are derived from the SAME encoded parts. They
 * used to disagree — the key hashed the raw pair while the name used the encoded
 * one — which is how a reserved character in the name survived review of a
 * function whose other half looked correct.
 */
export function packumentCacheKey(registry: string, name: string): string {
    return `${encodePart(registry)},${encodePart(name)}`;
}

function pathFor(registry: string, name: string): string | null {
    if (!isEnabled()) return null;
    const key = packumentCacheKey(registry, name);
    return join(cacheRoot(), shardFor(key), `${key}.json`);
}

/**
 * Read a cached packument + its ETag for `(registry, name)`. Returns `null` on
 * a miss, when the cache is disabled, or when the entry is unreadable/corrupt
 * (treated as a miss — the caller just re-fetches).
 */
export function getCachedPackument(registry: string, name: string): CachedPackument | null {
    const path = pathFor(registry, name);
    if (!path) return null;
    const buf = readCacheFile(path);
    if (!buf) return null;
    try {
        const parsed = JSON.parse(buf.toString('utf-8')) as Partial<PackumentCacheEntry>;
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
    const entry: PackumentCacheEntry = { etag, packument };
    atomicWrite(path, JSON.stringify(entry));
}
