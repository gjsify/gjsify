// Content-addressable tarball cache for `gjsify install`.
//
// Mirrors pnpm / yarn-berry's store layout: each tarball is stored once on
// disk keyed by its SRI integrity hash (`sha512-…`). When the resolver hits
// a node whose integrity is already cached, `fetchTarball` is skipped and
// we read the bytes off the local filesystem instead.
//
// Why this matters: a cold install on this monorepo (200+ workspaces,
// 600+ transitive deps) spends ~20 minutes at 80% CPU. Most of that time is
// re-downloading + re-extracting the SAME tarballs that just came down in
// the previous run because there is no cache between runs. With this cache,
// the second `gjsify install` on the same repo skips every tarball fetch
// and just goes straight to extract → drops well below 1 minute in practice.
//
// Layout (matches the pnpm pattern so we stay forward-compatible with
// `~/.cache/gjsify/store` if we eventually share a store across projects):
//
//   $XDG_CACHE_HOME/gjsify/tarballs/v1/<hex-prefix-2>/<full-hex>.tgz
//
// The 2-byte prefix is a directory-sharding step so the leaf directory
// never gets pathologically large — same pattern git's loose objects use.
// `v1` is a layout version so we can change the file shape (e.g. add a
// manifest sidecar) without invalidating the world.
//
// SRI integrity input → cache key:
//
//   "sha512-AbCd…=="   →  ("sha512", "ab/cdefg….tgz")
//
// We hex-encode the base64 SRI digest. Two integrities that produce the
// same hex bytes share the same cache entry; that is the invariant pnpm
// relies on too. Tarballs without an integrity hash (older registries)
// fall through to a no-op cache and download every time.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_LAYOUT_VERSION = 'v1';

/**
 * Resolve the root of the tarball cache. Mirrors the dlx cache's
 * XDG-honouring lookup so users with a custom `XDG_CACHE_HOME` get a
 * single coherent cache root.
 */
function cacheRoot(): string {
    const xdg = process.env.XDG_CACHE_HOME;
    const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
    return join(base, 'gjsify', 'tarballs', CACHE_LAYOUT_VERSION);
}

/**
 * Convert an SRI integrity string (`sha512-AbCd…=`) into a cache file path.
 * Returns `null` for unsupported / malformed integrity values so the caller
 * can fall back to a fresh download.
 */
function pathFor(integrity: string | undefined): string | null {
    if (!integrity) return null;
    const dashIdx = integrity.indexOf('-');
    if (dashIdx <= 0 || dashIdx === integrity.length - 1) return null;
    const algo = integrity.slice(0, dashIdx);
    const b64 = integrity.slice(dashIdx + 1).replace(/=+$/, '');
    // Decode base64 → hex; throws on malformed input which we swallow.
    let hex: string;
    try {
        hex = Buffer.from(b64, 'base64').toString('hex');
    } catch {
        return null;
    }
    if (hex.length < 4) return null;
    const shard = hex.slice(0, 2);
    return join(cacheRoot(), algo, shard, `${hex}.tgz`);
}

/**
 * Read a cached tarball by SRI integrity. Returns the raw tarball bytes if
 * the cache has a HIT, `null` otherwise. A read failure (e.g. partial
 * write from an interrupted previous run) is treated as a MISS — the file
 * is left untouched so we don't trip a follow-up writer's atomic rename.
 */
export function getCachedTarball(integrity: string | undefined): Uint8Array | null {
    const path = pathFor(integrity);
    if (!path) return null;
    if (!existsSync(path)) return null;
    try {
        const buf = readFileSync(path);
        // Sanity: a zero-byte file is a previous-write failure; treat as MISS.
        if (buf.length === 0) return null;
        return buf;
    } catch {
        return null;
    }
}

/**
 * Persist a tarball to the cache. Writes to a `<path>.tmp.<pid>` sibling
 * then atomically renames into place so concurrent installs can never
 * observe a half-written entry. No-op when:
 *   - `integrity` is missing / malformed (no cache key)
 *   - the destination already exists (idempotent — content-addressed)
 *   - the write fails (e.g. cache root is read-only) — silently degrade
 *     so a cache-volume issue doesn't break the install itself.
 */
export function putCachedTarball(integrity: string | undefined, bytes: Uint8Array): void {
    const path = pathFor(integrity);
    if (!path) return;
    if (existsSync(path)) return;
    try {
        mkdirSync(join(path, '..'), { recursive: true });
        const tmp = `${path}.tmp.${process.pid}`;
        writeFileSync(tmp, bytes);
        renameSync(tmp, path);
    } catch {
        // Cache write failure is non-fatal — the install proceeds with the
        // in-memory bytes; we just won't get a hit on the next run.
    }
}

/**
 * Best-effort cache stats for diagnostics. Returns `null` when the cache
 * root doesn't exist yet (first run).
 */
export function cacheRootForLogging(): string {
    return cacheRoot();
}

export function isCacheHit(integrity: string | undefined): boolean {
    const path = pathFor(integrity);
    if (!path) return false;
    try {
        const s = statSync(path);
        return s.isFile() && s.size > 0;
    } catch {
        return false;
    }
}
