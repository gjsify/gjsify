// SPDX-License-Identifier: MIT
// Shared filesystem primitives for `gjsify install`'s on-disk caches and its
// lockfile writer.
//
// Both the content-addressable tarball cache (install-tarball-cache.ts) and the
// packument metadata cache (install-packument-cache.ts) need the same three
// things: an `XDG_CACHE_HOME`-honouring cache root, an atomic write (so a
// concurrent install never observes a half-written entry), and a read that
// treats a missing / zero-byte / unreadable file as a MISS. Centralising them
// here keeps the two caches byte-for-byte consistent. The lockfile writer
// (`gjsify-lock.json`) shares the same tmp+rename pattern via the strict
// variant so an interrupted install can never leave a torn lockfile behind.
//
// Out of scope: the dlx cache (`dlx-cache.ts`) has a different layout
// (`gjsify/dlx`, sha256 + symlink-swap) and its own TTL/prepare-dir concerns —
// it is a precedent for the XDG helper, not a reuse target.

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
 * Write `bytes` to `path` atomically: write a `<path>.tmp.<pid>` sibling, then
 * `rename` it into place, so a concurrent reader never observes a half-written
 * file. Creates the parent directory. Best-effort — any failure (read-only /
 * out-of-disk cache volume) is swallowed so a cache hiccup never breaks the
 * install; the caller proceeds with its in-memory copy.
 */
export function atomicWrite(path: string, bytes: Uint8Array | string): void {
    try {
        atomicWriteStrict(path, bytes);
    } catch {
        /* best-effort — a cache-write failure must not break the install */
    }
}

/**
 * Strict sibling of {@link atomicWrite}: identical tmp+`rename` pattern, but
 * failures PROPAGATE to the caller. Use for files whose corruption/loss must
 * abort the operation (the `gjsify-lock.json` writer) rather than degrade
 * silently like a cache entry. `rename` over the destination is atomic on
 * POSIX, so a concurrent reader (or a crash mid-write) sees either the old
 * complete file or the new complete file — never a torn one.
 */
export function atomicWriteStrict(path: string, bytes: Uint8Array | string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
}

/**
 * Read a cache file, returning its bytes on a HIT or `null` on a MISS. A
 * missing file, a zero-byte file (an interrupted previous write), or any read
 * error are all treated as a MISS — the file is left untouched so a follow-up
 * writer's atomic rename isn't disturbed.
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
