// Content-addressable tarball cache for `gjsify install`.
//
// Mirrors pnpm / yarn-berry's store layout: each tarball is stored once on disk
// keyed by its SRI integrity hash (`sha512-…`), so a node whose integrity is
// already cached skips `fetchTarball` and reads the bytes off local disk.
//
// Measured on this monorepo (200+ workspaces, 600+ transitive deps): a cold
// install spends ~20 minutes at 80% CPU, most of it re-downloading tarballs the
// previous run had already fetched. With the cache the second `gjsify install`
// goes straight to extract and drops well under a minute.
//
// Layout, following the pnpm pattern:
//
//   $XDG_CACHE_HOME/gjsify/tarballs/v1/<hex-prefix-2>/<full-hex>.tgz
//
// The 2-byte prefix shards the directory so the leaf never gets pathologically
// large (git's loose-object pattern). `v1` is a layout version, so the file shape
// can change without invalidating the world.
//
// SRI integrity → cache key, by hex-encoding the base64 digest:
//
//   "sha512-AbCd…=="   →  ("sha512", "ab/cdefg….tgz")
//
// Two integrities with the same hex bytes share an entry, the invariant pnpm relies
// on too. Tarballs without an integrity hash (older registries) fall through to a
// no-op cache and download every time.

import { Buffer } from 'node:buffer';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { verifyIntegrity } from '@gjsify/npm-registry';

import { atomicWrite, gjsifyCacheRoot, readCacheFile } from './install-cache-fs.js';

const CACHE_LAYOUT_VERSION = 'v1';

/** Root of the tarball cache: `$XDG_CACHE_HOME/gjsify/tarballs/v1`. */
function cacheRoot(): string {
    return gjsifyCacheRoot('tarballs', CACHE_LAYOUT_VERSION);
}

interface ParsedSri {
    /** SRI algorithm, e.g. `sha512`. */
    algorithm: string;
    /** Hex-encoded digest. */
    hex: string;
}

/**
 * Parse an SRI integrity string (`sha512-AbCd…=`) into its algorithm + hex digest,
 * or `null` for a missing / malformed value (the caller falls back to a fresh
 * download). Shared by the gjsify-store and npm-cacache path derivations below.
 */
function parseSri(integrity: string | undefined): ParsedSri | null {
    if (!integrity) return null;
    const dashIdx = integrity.indexOf('-');
    if (dashIdx <= 0 || dashIdx === integrity.length - 1) return null;
    const algorithm = integrity.slice(0, dashIdx);
    const b64 = integrity.slice(dashIdx + 1).replace(/=+$/, '');
    // Base64 decoding is lenient on every runtime (Node skips invalid chars,
    // @gjsify/buffer's table decode maps them to 0): malformed input yields
    // short/garbage output — caught by the length check below — never a throw.
    const hex = Buffer.from(b64, 'base64').toString('hex');
    if (hex.length < 4) return null;
    return { algorithm, hex };
}

/**
 * Convert an SRI integrity string into a cache file path. Returns `null` for
 * unsupported / malformed integrity values so the caller can fall back to a
 * fresh download.
 */
function pathFor(integrity: string | undefined): string | null {
    const sri = parseSri(integrity);
    if (!sri) return null;
    const shard = sri.hex.slice(0, 2);
    return join(cacheRoot(), sri.algorithm, shard, `${sri.hex}.tgz`);
}

/**
 * Read a cached tarball by SRI integrity — raw bytes on a VERIFIED hit, `null`
 * otherwise. A read failure (e.g. a partial write from an interrupted run) is a MISS,
 * and the file is left untouched so a follow-up writer's atomic rename is not tripped.
 *
 * The bytes are re-hashed against the integrity that named them, through the SAME
 * {@link verifyIntegrity} the download path uses — so both paths agree by
 * construction instead of by comment.
 *
 * This used to trust the path: "content-addressed, so a hash hit is byte-identical to
 * what the registry would return". That is a claim ABOUT the bytes, and nothing read
 * them to check it. It held while the store was a local directory this machine had
 * written itself. It stops holding the moment the store is a restorable CI artifact —
 * a GitHub Actions cache entry that is truncated, corrupted, or written by a workflow
 * on another branch would have been consumed as authentic, because the only thing
 * asserting its contents was its filename. `gjsify-setup` now restores exactly such an
 * artifact, so the check is no longer optional. Yarn re-hashes on every install for
 * this reason (refs/yarn-berry Cache.ts, "we check the file hashes during each install
 * anyway"); measured here, it costs ~0.5 s over this repo's ~420 MB closure, against
 * an extract phase of minutes.
 *
 * A mismatch DELETES the entry rather than merely skipping it. That is not the prune
 * this repo refuses elsewhere — the name asserts the content and the content
 * disproves the name, so the file is garbage by its own definition. It has to go:
 * {@link putCachedTarball} is idempotent on existence, so a corrupt blob left in place
 * would never be replaced and every future install would re-download it forever.
 */
export async function getCachedTarball(integrity: string | undefined): Promise<Uint8Array | null> {
    const path = pathFor(integrity);
    if (!path || !integrity) return null;
    const bytes = readCacheFile(path);
    if (!bytes) return null;
    if (await verifyIntegrity(bytes, integrity)) return bytes;
    // Best-effort: a read-only cache volume must not break the install, and the
    // caller falls through to a verifying download either way.
    try {
        unlinkSync(path);
    } catch {
        /* keep going — the download path replaces the value we return as a MISS */
    }
    return null;
}

/**
 * Persist a tarball to the cache, via a `<path>.tmp.<pid>` sibling and an atomic
 * rename so concurrent installs never observe a half-written entry. No-op when
 * `integrity` is missing/malformed, when the destination already exists
 * (content-addressed, so immutable), or when the write fails — a read-only cache
 * volume must not break the install itself.
 */
export function putCachedTarball(integrity: string | undefined, bytes: Uint8Array): void {
    const path = pathFor(integrity);
    if (!path) return;
    // Idempotent: content-addressed entries are immutable, never rewritten.
    if (existsSync(path)) return;
    atomicWrite(path, bytes);
}

/** The cache root, for diagnostics. Not probed — the directory may not exist yet. */
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

// Foreign cache interop — read npm's cacache content store.
//
// npm keys its content-addressable store on the SAME SRI integrity as ours and
// holds the raw `.tgz` bytes verbatim, so anyone who has run `npm install` already
// has these tarballs on disk and reading them turns a cold `gjsify install` into a
// near-warm one with no network round-trip. Layout (cacache `content-v2`):
//
//   <npm-cache>/_cacache/content-v2/<algo>/<hex[0:2]>/<hex[2:4]>/<hex[4:]>
//
// Identical derivation to our own `pathFor`, with a different root and no `.tgz`
// extension.
//
// pnpm/yarn/bun stores are deliberately NOT read: pnpm and bun store *unpacked*
// per-file content (no tarball to hand the extractor) and yarn berry stores zips
// under its own non-SRI key, so none map to a tarball-by-integrity lookup.

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
    const contentDir = npmCacacheContentDir();
    if (!contentDir) return null;
    const sri = parseSri(integrity);
    if (!sri) return null;
    // cacache shards the hex digest into [0:2]/[2:4]/[4:] with NO extension.
    return join(contentDir, sri.algorithm, sri.hex.slice(0, 2), sri.hex.slice(2, 4), sri.hex.slice(4));
}

/**
 * Read a tarball from npm's cacache content store by SRI integrity — raw `.tgz`
 * bytes on a VERIFIED hit, `null` on a MISS, disabled interop or read failure.
 *
 * Re-hashed like {@link getCachedTarball}, and with more reason: these bytes come
 * from ANOTHER tool's store, on a path this code does not control and cannot assume
 * was written by a cacache that verified anything. The old note argued cacache
 * verified on write and a corrupt tarball would fail loudly in the extractor — but
 * "the next stage will probably notice" is not verification, and the caller
 * write-throughs a foreign hit into OUR store, which would launder an unchecked blob
 * into a first-class entry. A mismatch is left alone here rather than deleted: this
 * store belongs to npm, and removing another tool's files is not this code's call.
 */
export async function getForeignCachedTarball(integrity: string | undefined): Promise<Uint8Array | null> {
    const path = npmCachePathFor(integrity);
    if (!path || !integrity) return null;
    const bytes = readCacheFile(path);
    if (!bytes) return null;
    return (await verifyIntegrity(bytes, integrity)) ? bytes : null;
}
