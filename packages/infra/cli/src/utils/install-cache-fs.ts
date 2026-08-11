// SPDX-License-Identifier: MIT
// Shared filesystem primitives for `gjsify install`'s on-disk caches and its
// lockfile writer.
//
// The tarball cache (install-tarball-cache.ts) and the packument metadata cache
// (install-packument-cache.ts) need the same three things: an `XDG_CACHE_HOME`-honouring
// root, an atomic write (so a concurrent install never observes a half-written entry), and a
// read treating missing / zero-byte / unreadable as a MISS. The `gjsify-lock.json` writer
// shares the tmp+rename pattern via the strict variant, so an interrupted install cannot
// leave a torn lockfile.
//
// Out of scope: the dlx cache (`dlx-cache.ts`) has a different layout (`gjsify/dlx`, sha256 +
// symlink-swap) and its own TTL concerns — a precedent for the XDG helper, not a reuse target.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve `$XDG_CACHE_HOME/gjsify/<kind>/<layoutVersion>` (falling back to
 * `~/.cache` when `XDG_CACHE_HOME` is unset/empty). `kind` is the cache area
 * (`tarballs`, `metadata`); `layoutVersion` lets one cache evolve its on-disk
 * shape without invalidating its siblings.
 */
export function gjsifyCacheRoot(kind: string, layoutVersion: string): string {
    const xdg = process.env.XDG_CACHE_HOME;
    const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
    return join(base, 'gjsify', kind, layoutVersion);
}

/**
 * Write `bytes` to `path` atomically via a `<path>.tmp.<pid>` sibling + `rename`. Best-effort:
 * any failure (read-only / out-of-disk cache volume) is swallowed so a cache hiccup never
 * breaks the install — the caller proceeds with its in-memory copy.
 */
export function atomicWrite(path: string, bytes: Uint8Array | string): void {
    try {
        atomicWriteStrict(path, bytes);
    } catch {
        /* best-effort — a cache-write failure must not break the install */
    }
}

/**
 * Strict sibling of {@link atomicWrite}: same tmp+`rename` pattern, but failures PROPAGATE.
 * Use for files whose loss must abort the operation (the `gjsify-lock.json` writer) rather
 * than degrade silently like a cache entry. `rename` over the destination is atomic on POSIX,
 * so a concurrent reader — or a crash mid-write — sees the old or the new file, never a torn one.
 */
export function atomicWriteStrict(path: string, bytes: Uint8Array | string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
}

/**
 * Read a cache file: bytes on a HIT, `null` on a MISS. Missing, zero-byte (an interrupted
 * previous write) and unreadable all count as a MISS, and the file is left untouched so a
 * follow-up writer's atomic rename isn't disturbed.
 */
export function readCacheFile(path: string): Buffer | null {
    if (!existsSync(path)) return null;
    try {
        const buf = readFileSync(path);
        if (buf.length === 0) return null;
        return buf;
    } catch {
        return null;
    }
}
