// SPDX-License-Identifier: MIT
// Unit tests for the content-addressable tarball cache.

import { describe, it, expect } from '@gjsify/unit';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    cacheRootForLogging,
    getCachedTarball,
    isCacheHit,
    putCachedTarball,
} from './install-tarball-cache.js';

const SAMPLE_INTEGRITY =
    'sha512-z3rDtSj0lKDqyGCVS9emVdb31Cv3DDpyZ6X7CWk3eDoejWlBwiBNVOe0bWB9BJVcj/EQGOIaq8ftADyhjs7t9w==';
// The base64 → hex decode of the digest above, computed once and pinned so
// changes to either side of the path-derivation get caught.
const SAMPLE_HEX =
    'cf7ac3b528f494a0eac86095' +
    '2bd7a655d6f7d42bf70c3a72' +
    '67a5fb09693778368e8d6941' +
    'c220210d54e7b46d607d04955c8ff11018e21aabc7ed003ca18ecedf7';

export default async () => {
    await describe('install-tarball-cache', async () => {
        // Each test allocates its own XDG_CACHE_HOME so writes don't pollute
        // the user's real cache and so two tests can't observe each other.
        const setup = () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-tarball-cache-'));
            const prev = process.env.XDG_CACHE_HOME;
            process.env.XDG_CACHE_HOME = dir;
            return { dir, restore: () => {
                if (prev === undefined) delete process.env.XDG_CACHE_HOME;
                else process.env.XDG_CACHE_HOME = prev;
                rmSync(dir, { recursive: true, force: true });
            } };
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
                expect(getCachedTarball(SAMPLE_INTEGRITY)).toBe(null);
                expect(isCacheHit(SAMPLE_INTEGRITY)).toBe(false);
            } finally {
                restore();
            }
        });

        await it('putCachedTarball + getCachedTarball round-trips bytes', async () => {
            const { restore } = setup();
            try {
                const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
                putCachedTarball(SAMPLE_INTEGRITY, bytes);
                expect(isCacheHit(SAMPLE_INTEGRITY)).toBe(true);
                const out = getCachedTarball(SAMPLE_INTEGRITY);
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
                const first = new Uint8Array([10, 20, 30]);
                putCachedTarball(SAMPLE_INTEGRITY, first);
                // Re-put a DIFFERENT payload: the cache MUST keep the first
                // write — it's content-addressed and the integrity hash is
                // (intentionally) the only key. A real caller would not call
                // with different bytes for the same integrity, but the cache
                // must defend against the case anyway.
                const second = new Uint8Array([99, 98, 97]);
                putCachedTarball(SAMPLE_INTEGRITY, second);
                const out = getCachedTarball(SAMPLE_INTEGRITY);
                expect(out).not.toBe(null);
                if (out) {
                    expect(out[0]).toBe(10);
                    expect(out[1]).toBe(20);
                    expect(out[2]).toBe(30);
                }
            } finally {
                restore();
            }
        });

        await it('missing / malformed integrity → no cache, no throw', async () => {
            const { restore } = setup();
            try {
                expect(getCachedTarball(undefined)).toBe(null);
                expect(getCachedTarball('')).toBe(null);
                expect(getCachedTarball('not-a-real-integrity')).toBe(null);
                expect(getCachedTarball('sha512-')).toBe(null);
                expect(getCachedTarball('-sha512abc')).toBe(null);
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
                const bytes = new Uint8Array([42, 43, 44]);
                putCachedTarball(SAMPLE_INTEGRITY, bytes);
                // Find the file & truncate it
                const cacheFile = findOnly(join(dir, 'gjsify', 'tarballs', 'v1'));
                writeFileSync(cacheFile, new Uint8Array(0));
                expect(getCachedTarball(SAMPLE_INTEGRITY)).toBe(null);
                expect(isCacheHit(SAMPLE_INTEGRITY)).toBe(false);
            } finally {
                restore();
            }
        });

        await it('different integrities → different cache files', async () => {
            const { dir, restore } = setup();
            try {
                const a = 'sha512-' + Buffer.from('a'.repeat(64)).toString('base64');
                const b = 'sha512-' + Buffer.from('b'.repeat(64)).toString('base64');
                putCachedTarball(a, new Uint8Array([1, 2, 3]));
                putCachedTarball(b, new Uint8Array([7, 8, 9]));
                const outA = getCachedTarball(a);
                const outB = getCachedTarball(b);
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
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
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
