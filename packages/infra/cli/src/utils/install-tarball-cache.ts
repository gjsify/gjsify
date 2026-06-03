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

// ---------------------------------------------------------------------------
// Foreign cache interop — read npm's cacache content store.
//
// npm stores downloaded tarballs in a content-addressable store
// (`cacache`) keyed by the SAME SRI integrity we key our own store on, and
// holds the raw `.tgz` bytes verbatim. Layout (cacache `content-v2`):
//
//   <npm-cache>/_cacache/content-v2/<algo>/<hex[0:2]>/<hex[2:4]>/<hex[4:]>
//
// `<algo>` is the SRI algorithm (`sha512`), `<hex>` the hex-encoded digest —
// identical derivation to our own `pathFor`, just a different root and no
// `.tgz` extension. So anyone who has run `npm install` before already has
// these tarballs on disk; reading them turns a cold `gjsify install` into a
// near-warm one without a single network round-trip.
//
// pnpm/yarn/bun stores are deliberately NOT read here: pnpm/bun store
// *unpacked* per-file content (no tarball to hand to the extractor) and yarn
// berry stores zip archives under its own (non-SRI) cache key — none map to a
// tarball-by-integrity lookup the way npm's cacache does.
// ---------------------------------------------------------------------------

/**
 * Resolve npm's `content-v2` directory, honouring `GJSIFY_NPM_CACHE`
 * (full path to a `_cacache` dir; `0`/`false`/empty disables the interop),
 * then `npm_config_cache`, then the platform default `~/.npm`. Returns `null`
 * when the interop is disabled or no plausible cache root exists.
 */
function npmCacacheContentDir(): string | null {
    const override = process.env.GJSIFY_NPM_CACHE;
    if (override !== undefined) {
        const trimmed = override.trim();
        if (trimmed === '' || trimmed === '0' || trimmed === 'false') return null;
        // Accept either the `_cacache` dir itself or its parent npm cache dir.
        const base = trimmed.endsWith('_cacache') ? trimmed : join(trimmed, '_cacache');
        return join(base, 'content-v2');
    }
    const npmConfigCache = process.env.npm_config_cache;
    const cacheBase = npmConfigCache && npmConfigCache.length > 0 ? npmConfigCache : join(homedir(), '.npm');
    return join(cacheBase, '_cacache', 'content-v2');
}

/** Map an SRI integrity to its npm cacache content-store path, or `null`. */
function npmCachePathFor(integrity: string | undefined): string | null {
    if (!integrity) return null;
    const contentDir = npmCacacheContentDir();
    if (!contentDir) return null;
    const dashIdx = integrity.indexOf('-');
    if (dashIdx <= 0 || dashIdx === integrity.length - 1) return null;
    const algo = integrity.slice(0, dashIdx);
    const b64 = integrity.slice(dashIdx + 1).replace(/=+$/, '');
    let hex: string;
    try {
        hex = Buffer.from(b64, 'base64').toString('hex');
    } catch {
        return null;
    }
    if (hex.length < 4) return null;
    // cacache shards the hex digest into [0:2]/[2:4]/[4:] with NO extension.
    return join(contentDir, algo, hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
}

/**
 * Read a tarball from npm's cacache content store by SRI integrity. Returns
 * the raw `.tgz` bytes on a HIT, `null` on a MISS / disabled interop / read
 * failure. Like {@link getCachedTarball}, this trusts the content-addressed
 * path rather than re-hashing — the extractor surfaces any genuinely corrupt
 * tarball loudly, and cacache verified the bytes on write.
 */
export function getForeignCachedTarball(integrity: string | undefined): Uint8Array | null {
    const path = npmCachePathFor(integrity);
    if (!path) return null;
    if (!existsSync(path)) return null;
    try {
        const buf = readFileSync(path);
        if (buf.length === 0) return null;
        return buf;
    } catch {
        return null;
    }
}
