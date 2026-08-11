// On-disk packument metadata cache for `gjsify install`.
//
// Sibling to the content-addressable tarball cache (install-tarball-cache.ts).
// Stores each package's packument plus the registry `ETag` it came with, so a
// re-resolve (lockfile miss — e.g. a dependency range changed) can send a
// conditional `If-None-Match` and turn the unchanged majority into empty
// `304 Not Modified` responses, on top of the ~4× gzip transfer for the changed
// minority (see `@gjsify/npm-registry` `fetchPackumentConditional`).
//
// Mirrors pnpm's metadata cache + npm's make-fetch-happen HTTP-cache layer.
//
// Layout:
//
//   $XDG_CACHE_HOME/gjsify/metadata/v3/<shard>/<shape>,<encoded-registry>,<encoded-name>.json
//
// Keyed by (SHAPE, registry, name) — NOT name alone — so switching the registry
// for a scope can never serve a packument from the wrong source on a coincidental
// ETag match. `<shard>` is a 2-hex FNV-1a digest of the key, directory fan-out so
// the leaf dir never grows unbounded (as with the tarball cache's hex sharding).
//
// WHY THE SHAPE IS PART OF THE KEY: one packument URL serves TWO documents — the
// abbreviated "corgi" install document and the full one — and only the full one
// carries a version's `libc` (`@gjsify/npm-registry` `FetchOptions.fullMetadata`).
// Keyed per (registry, name) alone, a read is answered by whichever shape was cached
// first, so a musl-only package comes back `libc`-less, is judged compatible on a
// glibc host, and installs — a wrong answer indistinguishable from a cache hit, with
// no failure until something dlopens the binary. pacote prefixes its own key with
// `full:`/`corgi:` for the same reason.
//
// Disabled with `GJSIFY_PACKUMENT_CACHE=0` (or `false`). Honours
// `XDG_CACHE_HOME` like the tarball + dlx caches.

import { join } from 'node:path';

import type { Packument } from '@gjsify/npm-registry';

import { atomicWrite, gjsifyCacheRoot, readCacheFile } from './install-cache-fs.js';

// v2 moved the separator off the Win32-reserved `|` (see `packumentCacheKey`); v3
// made the document SHAPE part of the key. Either change alone makes older entries
// unreachable rather than merely stale, so a new root retires them instead of
// leaving ambiguous orphans under the old one.
const CACHE_LAYOUT_VERSION = 'v3';

/**
 * Which document shape an entry holds. `'corgi'` = the abbreviated
 * `application/vnd.npm.install-v1+json` install document; `'full'` =
 * `application/json`, the only one carrying `libc`. Same names pacote uses.
 */
export type PackumentShape = 'corgi' | 'full';

interface PackumentCacheEntry {
    /** Registry ETag the body was served with (the `If-None-Match` value). */
    etag: string;
    /** The packument body, in the shape the entry's filename names. */
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

/** Root of the packument cache: `$XDG_CACHE_HOME/gjsify/metadata/v3`. */
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
 * The cache key for a (shape, registry, name) triple — exported so the filename
 * rule below is a PROPERTY a test can assert, not a claim in a comment.
 *
 * THE SEPARATOR IS NOT COSMETIC. `|` is a Win32 RESERVED filename character, so
 * while it was the separator every write there failed with `EINVAL` and nothing
 * reported it: `atomicWrite` is best-effort on purpose (a read-only cache volume
 * must not break an install) and `readCacheFile` treats an unreadable path as a
 * MISS. The cache was not broken loudly on Windows, it was silently DEAD, and the
 * `If-None-Match` → `304` revalidation this file exists for never engaged once.
 *
 * `,` is legal on Win32 AND escaped by `encodeURIComponent`, which keeps a flat
 * three-part name injective: an encoded part cannot contain the separator, so
 * exactly one triple maps to any filename. The shape needs no encoding — one of two
 * literals — and LEADS so listing a shard groups by shape.
 *
 * The shard key and the filename must derive from the SAME encoded parts; hashing
 * the raw values while naming with the encoded ones is how a reserved character
 * survived review of a function whose other half looked correct.
 */
export function packumentCacheKey(registry: string, name: string, shape: PackumentShape): string {
    return `${shape},${encodePart(registry)},${encodePart(name)}`;
}

/** Filesystem path for a (shape, registry, name) triple, or `null` when disabled. */
function pathFor(registry: string, name: string, shape: PackumentShape): string | null {
    if (!isEnabled()) return null;
    const key = packumentCacheKey(registry, name, shape);
    return join(cacheRoot(), shardFor(key), `${key}.json`);
}

/**
 * Read a cached packument + its ETag for `(registry, name)` in the given document
 * `shape`. Returns `null` on a miss, when the cache is disabled, or when the entry
 * is unreadable/corrupt (treated as a miss — the caller re-fetches).
 *
 * The `shape` must be the one the body was fetched under: the two documents are
 * different bodies with independently-versioned ETags behind ONE URL, so reading
 * across shapes returns a `libc`-less body that looks exactly like a hit. The
 * install backend resolves with `'full'`; the `'corgi'` default serves callers that
 * do not escalate.
 */
export function getCachedPackument(
    registry: string,
    name: string,
    shape: PackumentShape = 'corgi',
): CachedPackument | null {
    const path = pathFor(registry, name, shape);
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
 * Persist a packument + ETag for `(registry, name)` under its document `shape`.
 * Writes to a `<path>.tmp.<pid>` sibling then atomically renames so a concurrent
 * reader never sees a partial write. No-op when the cache is disabled, the ETag is
 * empty, or the write fails (a read-only / out-of-disk cache volume must not break
 * the install).
 *
 * `shape` must match the `accept` header the body was fetched with.
 */
export function putCachedPackument(
    registry: string,
    name: string,
    etag: string,
    packument: Packument,
    shape: PackumentShape = 'corgi',
): void {
    if (!etag) return;
    const path = pathFor(registry, name, shape);
    if (!path) return;
    const entry: PackumentCacheEntry = { etag, packument };
    atomicWrite(path, JSON.stringify(entry));
}
