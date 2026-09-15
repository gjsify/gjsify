// SPDX-License-Identifier: MIT
// Unit tests for the content-addressable tarball cache.

import { describe, it, expect } from '@gjsify/unit';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
    cacheRootForLogging,
    getCachedTarball,
    getForeignCachedTarball,
    isCacheHit,
    putCachedTarball,
} from './install-tarball-cache.js';

// The readers VERIFY now, so a sample integrity is no longer free to be any
// well-formed string: it has to be the true digest of the bytes stored under it, or
// every hit in this file is correctly reported as a miss. These three are one triple —
// payload, its real sha512 SRI, and the hex that both our store and npm's cacache
// shard on — pinned together so a change to either side of the path derivation still
// gets caught.
const SAMPLE_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const SAMPLE_INTEGRITY =
    'sha512-GBjMKs0geICgevw2D9Dah+UczxfnxgTE6xa+V4gyJyTCmOH8xm6yk5JpkxQe8IY8Ce2jgxiM9d9JuRCqysF+xQ==';
// `content-v2/sha512/<hex[0:2]>/<hex[2:4]>/<hex[4:]>`.
const SAMPLE_HEX =
    '1818cc2acd207880a07afc36' +
    '0fd0da87e51ccf17e7c604c4' +
    'eb16be5788322724c298e1fc' +
    'c66eb293926993141ef0863c09eda383188cf5df49b910aacac17ec5';

/** The true SRI of `bytes`, via the same WebCrypto primitive `verifyIntegrity` uses. */
const sriFor = async (bytes: Uint8Array): Promise<string> => {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', bytes.slice().buffer));
    let bin = '';
    for (const b of digest) bin += String.fromCharCode(b);
    return `sha512-${btoa(bin)}`;
};

export default async () => {
    await describe('install-tarball-cache', async () => {
        // Each test allocates its own XDG_CACHE_HOME so writes don't pollute
        // the user's real cache and so two tests can't observe each other.
        const setup = () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-tarball-cache-'));
            const prev = process.env.XDG_CACHE_HOME;
            process.env.XDG_CACHE_HOME = dir;
            return {
                dir,
                restore: () => {
                    if (prev === undefined) delete process.env.XDG_CACHE_HOME;
                    else process.env.XDG_CACHE_HOME = prev;
                    rmSync(dir, { recursive: true, force: true });
                },
            };
        };

        await it('cacheRootForLogging honours XDG_CACHE_HOME', async () => {
            const { dir, restore } = setup();
            try {
                expect(cacheRootForLogging()).toBe(join(dir, 'gjsify', 'tarballs', 'v1'));
            } finally {
                restore();
            }
        });

        await it('getCachedTarball returns null on a cold cache', async () => {
            const { restore } = setup();
            try {
                expect(await getCachedTarball(SAMPLE_INTEGRITY)).toBe(null);
                expect(isCacheHit(SAMPLE_INTEGRITY)).toBe(false);
            } finally {
                restore();
            }
        });

        await it('putCachedTarball + getCachedTarball round-trips bytes', async () => {
            const { restore } = setup();
            try {
                const bytes = SAMPLE_BYTES;
                putCachedTarball(SAMPLE_INTEGRITY, bytes);
                expect(isCacheHit(SAMPLE_INTEGRITY)).toBe(true);
                const out = await getCachedTarball(SAMPLE_INTEGRITY);
                expect(out).not.toBe(null);
                if (out) {
                    expect(out.length).toBe(bytes.length);
                    for (let i = 0; i < bytes.length; i++) {
                        expect(out[i]).toBe(bytes[i]);
                    }
                }
            } finally {
                restore();
            }
        });

        await it('writes are idempotent — second put is a no-op (does not corrupt)', async () => {
            const { restore } = setup();
            try {
                const first = SAMPLE_BYTES;
                putCachedTarball(SAMPLE_INTEGRITY, first);
                // Re-put a DIFFERENT payload: the cache MUST keep the first
                // write — it's content-addressed and the integrity hash is
                // (intentionally) the only key. A real caller would not call
                // with different bytes for the same integrity, but the cache
                // must defend against the case anyway.
                const second = new Uint8Array([99, 98, 97]);
                putCachedTarball(SAMPLE_INTEGRITY, second);
                const out = await getCachedTarball(SAMPLE_INTEGRITY);
                expect(out).not.toBe(null);
                if (out) {
                    expect(out[0]).toBe(SAMPLE_BYTES[0]);
                    expect(out[1]).toBe(SAMPLE_BYTES[1]);
                    expect(out[2]).toBe(SAMPLE_BYTES[2]);
                }
            } finally {
                restore();
            }
        });

        await it('missing / malformed integrity → no cache, no throw', async () => {
            const { restore } = setup();
            try {
                expect(await getCachedTarball(undefined)).toBe(null);
                expect(await getCachedTarball('')).toBe(null);
                expect(await getCachedTarball('not-a-real-integrity')).toBe(null);
                expect(await getCachedTarball('sha512-')).toBe(null);
                expect(await getCachedTarball('-sha512abc')).toBe(null);
                // Put with bad integrity is a silent no-op
                putCachedTarball(undefined, new Uint8Array([1]));
                putCachedTarball('', new Uint8Array([1]));
                expect(isCacheHit(undefined)).toBe(false);
            } finally {
                restore();
            }
        });

        await it('zero-byte file on disk is treated as MISS (interrupted-write recovery)', async () => {
            const { dir, restore } = setup();
            try {
                // Synthesise the same path the cache would use, but write
                // a zero-byte file there to simulate an interrupted write.
                putCachedTarball(SAMPLE_INTEGRITY, SAMPLE_BYTES);
                // Find the file & truncate it
                const cacheFile = findOnly(join(dir, 'gjsify', 'tarballs', 'v1'));
                writeFileSync(cacheFile, new Uint8Array(0));
                expect(await getCachedTarball(SAMPLE_INTEGRITY)).toBe(null);
                expect(isCacheHit(SAMPLE_INTEGRITY)).toBe(false);
            } finally {
                restore();
            }
        });

        await it('bytes that do not hash to their own name are a MISS, and are deleted', async () => {
            // THE GUARD for the CI tarball cache. The store is a restorable GitHub
            // Actions artifact now, so "content-addressed" can no longer be taken on
            // trust: an entry that is truncated, corrupted or written by another
            // branch's workflow arrives under a name asserting contents it does not
            // have. Seed exactly that — the right path, the wrong bytes.
            const { dir, restore } = setup();
            try {
                putCachedTarball(SAMPLE_INTEGRITY, SAMPLE_BYTES);
                const cacheFile = findOnly(join(dir, 'gjsify', 'tarballs', 'v1'));
                writeFileSync(cacheFile, new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
                // Same length, so only a hash can tell the difference — a size check
                // would pass this and that is the point.
                expect(statSync(cacheFile).size).toBe(SAMPLE_BYTES.length);
                expect(await getCachedTarball(SAMPLE_INTEGRITY)).toBe(null);
                // DELETED, not merely skipped: putCachedTarball is idempotent on
                // existence, so a corrupt blob left behind could never be replaced and
                // every later install would re-download it forever.
                expect(existsSync(cacheFile)).toBe(false);
                // And the entry is reusable again once correct bytes are written.
                putCachedTarball(SAMPLE_INTEGRITY, SAMPLE_BYTES);
                const out = await getCachedTarball(SAMPLE_INTEGRITY);
                expect(out).not.toBe(null);
                if (out) expect(out[0]).toBe(SAMPLE_BYTES[0]);
            } finally {
                restore();
            }
        });

        // --- npm cacache interop (getForeignCachedTarball) ---

        // Build a fake npm `_cacache` content-store entry for a given integrity
        // and return the npm-cache BASE dir (the parent of `_cacache`). Mirrors
        // cacache's `content-v2/<algo>/<hex[0:2]>/<hex[2:4]>/<hex[4:]>` layout.
        const seedNpmCacache = (base: string, hex: string, bytes: Uint8Array) => {
            const file = join(base, '_cacache', 'content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, bytes);
            return file;
        };

        const withForeignEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
            const keys = ['GJSIFY_NPM_CACHE', 'npm_config_cache'] as const;
            const prev: Record<string, string | undefined> = {};
            for (const k of keys) prev[k] = process.env[k];
            for (const k of keys) {
                if (vars[k] === undefined) delete process.env[k];
                else process.env[k] = vars[k];
            }
            try {
                await fn();
            } finally {
                for (const k of keys) {
                    if (prev[k] === undefined) delete process.env[k];
                    else process.env[k] = prev[k];
                }
            }
        };

        await it('getForeignCachedTarball reads npm cacache via GJSIFY_NPM_CACHE', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-npm-cache-'));
            try {
                const payload = SAMPLE_BYTES;
                seedNpmCacache(dir, SAMPLE_HEX, payload);
                await withForeignEnv({ GJSIFY_NPM_CACHE: dir, npm_config_cache: undefined }, async () => {
                    const out = await getForeignCachedTarball(SAMPLE_INTEGRITY);
                    expect(out).not.toBe(null);
                    if (out) {
                        expect(out.length).toBe(payload.length);
                        expect(out[0]).toBe(SAMPLE_BYTES[0]);
                        expect(out[1]).toBe(SAMPLE_BYTES[1]);
                    }
                });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('GJSIFY_NPM_CACHE accepts a path that already ends in _cacache', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-npm-cache-'));
            try {
                seedNpmCacache(dir, SAMPLE_HEX, SAMPLE_BYTES);
                await withForeignEnv(
                    { GJSIFY_NPM_CACHE: join(dir, '_cacache'), npm_config_cache: undefined },
                    async () => {
                        const out = await getForeignCachedTarball(SAMPLE_INTEGRITY);
                        expect(out).not.toBe(null);
                        if (out) expect(out[0]).toBe(SAMPLE_BYTES[0]);
                    },
                );
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('GJSIFY_NPM_CACHE=0 disables the interop even when the entry exists', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-npm-cache-'));
            try {
                seedNpmCacache(dir, SAMPLE_HEX, SAMPLE_BYTES);
                // Point npm_config_cache at the real entry, but disable via the override.
                await withForeignEnv({ GJSIFY_NPM_CACHE: '0', npm_config_cache: dir }, async () => {
                    expect(await getForeignCachedTarball(SAMPLE_INTEGRITY)).toBe(null);
                });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('getForeignCachedTarball returns null on a cacache miss / bad integrity', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-npm-cache-'));
            try {
                await withForeignEnv({ GJSIFY_NPM_CACHE: dir, npm_config_cache: undefined }, async () => {
                    expect(await getForeignCachedTarball(SAMPLE_INTEGRITY)).toBe(null);
                    expect(await getForeignCachedTarball(undefined)).toBe(null);
                    expect(await getForeignCachedTarball('not-a-real-integrity')).toBe(null);
                });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('a foreign cacache entry is verified too, and left in place', async () => {
            // The caller write-throughs a foreign hit into OUR store, so an unchecked
            // blob here would be laundered into a first-class entry. Not deleted
            // though: npm's store is not this code's to edit.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-npm-cache-'));
            try {
                const file = seedNpmCacache(dir, SAMPLE_HEX, new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
                await withForeignEnv({ GJSIFY_NPM_CACHE: dir, npm_config_cache: undefined }, async () => {
                    expect(await getForeignCachedTarball(SAMPLE_INTEGRITY)).toBe(null);
                });
                expect(existsSync(file)).toBe(true);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('different integrities → different cache files', async () => {
            const { dir, restore } = setup();
            try {
                const bytesA = new Uint8Array([1, 2, 3]);
                const bytesB = new Uint8Array([7, 8, 9]);
                const a = await sriFor(bytesA);
                const b = await sriFor(bytesB);
                putCachedTarball(a, bytesA);
                putCachedTarball(b, bytesB);
                const outA = await getCachedTarball(a);
                const outB = await getCachedTarball(b);
                expect(outA).not.toBe(null);
                expect(outB).not.toBe(null);
                if (outA && outB) {
                    expect(outA[0]).toBe(1);
                    expect(outB[0]).toBe(7);
                }
            } finally {
                restore();
            }
        });
    });
};

/**
 * Walk a directory tree and return the path of the single file in it.
 * Throws if there isn't exactly one file — used by the interrupted-write
 * test to find the cache entry's path without depending on the cache's
 * sharding scheme.
 */
function findOnly(root: string): string {
    const queue: string[] = [root];
    while (queue.length > 0) {
        const cur = queue.shift() as string;
        if (!existsSync(cur)) continue;
        const entries = readdirSync(cur);
        for (const e of entries) {
            const full = join(cur, e);
            const s = statSync(full);
            if (s.isDirectory()) queue.push(full);
            else if (s.isFile()) return full;
        }
    }
    throw new Error(`findOnly: no file under ${root}`);
}
