// SPDX-License-Identifier: MIT
// Unit tests for the shared install-cache FS primitives.

import { describe, it, expect } from '@gjsify/unit';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { atomicWrite, gjsifyCacheRoot, readCacheFile } from './install-cache-fs.js';

export default async () => {
    await describe('install-cache-fs', async () => {
        const withXdg = (dir: string | undefined, fn: () => void) => {
            const prev = process.env.XDG_CACHE_HOME;
            if (dir === undefined) delete process.env.XDG_CACHE_HOME;
            else process.env.XDG_CACHE_HOME = dir;
            try {
                fn();
            } finally {
                if (prev === undefined) delete process.env.XDG_CACHE_HOME;
                else process.env.XDG_CACHE_HOME = prev;
            }
        };

        await it('gjsifyCacheRoot honours XDG_CACHE_HOME', async () => {
            withXdg('/tmp/xdg-test', () => {
                // `join`, exactly like the `~/.cache` row below — `gjsifyCacheRoot`
                // joins with the HOST separator, so the `/`-literal spelling only
                // ever matched on POSIX.
                expect(gjsifyCacheRoot('tarballs', 'v1')).toBe(join('/tmp/xdg-test', 'gjsify', 'tarballs', 'v1'));
                expect(gjsifyCacheRoot('metadata', 'v2')).toBe(join('/tmp/xdg-test', 'gjsify', 'metadata', 'v2'));
            });
        });

        await it('gjsifyCacheRoot falls back to ~/.cache when XDG is unset/empty', async () => {
            const home = homedir();
            withXdg(undefined, () => {
                expect(gjsifyCacheRoot('tarballs', 'v1')).toBe(join(home, '.cache', 'gjsify', 'tarballs', 'v1'));
            });
            withXdg('', () => {
                expect(gjsifyCacheRoot('tarballs', 'v1')).toBe(join(home, '.cache', 'gjsify', 'tarballs', 'v1'));
            });
        });

        await it('atomicWrite creates the file (+ parent) and leaves no .tmp sibling', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-cache-fs-'));
            try {
                const target = join(dir, 'nested', 'sub', 'entry.bin');
                atomicWrite(target, new Uint8Array([1, 2, 3, 4]));
                expect(existsSync(target)).toBe(true);
                expect(Array.from(readFileSync(target))).toStrictEqual([1, 2, 3, 4]);
                // No leftover temp files anywhere under the leaf dir.
                const leaf = join(dir, 'nested', 'sub');
                expect(readdirSync(leaf).some((f) => f.includes('.tmp.'))).toBe(false);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('atomicWrite round-trips a string payload', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-cache-fs-'));
            try {
                const target = join(dir, 'entry.json');
                atomicWrite(target, JSON.stringify({ a: 1 }));
                expect(JSON.parse(readFileSync(target, 'utf-8'))).toStrictEqual({ a: 1 });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('atomicWrite is a silent no-op on an un-writable target', async () => {
            // A path whose parent cannot be created (a file stands where a dir
            // segment is expected) must not throw.
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-cache-fs-'));
            try {
                const blocker = join(dir, 'blocker');
                writeFileSync(blocker, 'i am a file');
                // `blocker/child` — mkdir of the parent fails because `blocker` is a file.
                atomicWrite(join(blocker, 'child.bin'), new Uint8Array([9]));
                expect(existsSync(join(blocker, 'child.bin'))).toBe(false);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('readCacheFile returns bytes on a hit, null on miss / zero-byte', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-cache-fs-'));
            try {
                expect(readCacheFile(join(dir, 'absent'))).toBe(null);

                const full = join(dir, 'full.bin');
                writeFileSync(full, new Uint8Array([7, 8, 9]));
                const got = readCacheFile(full);
                expect(got).not.toBe(null);
                if (got) expect(Array.from(got)).toStrictEqual([7, 8, 9]);

                const empty = join(dir, 'empty.bin');
                writeFileSync(empty, new Uint8Array(0));
                expect(readCacheFile(empty)).toBe(null);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
