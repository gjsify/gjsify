// SPDX-License-Identifier: MIT
// Unit tests for the on-disk packument metadata cache.

import { describe, it, expect } from '@gjsify/unit';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Packument } from '@gjsify/npm-registry';

import { getCachedPackument, putCachedPackument } from './install-packument-cache.js';

const REGISTRY = 'https://registry.npmjs.org/';
// Minimal but schema-valid packument shape.
const PACKUMENT = {
    name: 'lodash',
    'dist-tags': { latest: '4.17.21' },
    versions: {
        '4.17.21': {
            name: 'lodash',
            version: '4.17.21',
            dist: { tarball: 'https://r/lodash-4.17.21.tgz' },
        },
    },
} as unknown as Packument;

export default async () => {
    await describe('install-packument-cache', async () => {
        // Each test gets its own XDG_CACHE_HOME so it can't observe another's
        // writes or pollute the user's real cache.
        const setup = () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-packument-cache-'));
            const prevXdg = process.env.XDG_CACHE_HOME;
            const prevFlag = process.env.GJSIFY_PACKUMENT_CACHE;
            process.env.XDG_CACHE_HOME = dir;
            delete process.env.GJSIFY_PACKUMENT_CACHE;
            return {
                dir,
                restore: () => {
                    if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
                    else process.env.XDG_CACHE_HOME = prevXdg;
                    if (prevFlag === undefined) delete process.env.GJSIFY_PACKUMENT_CACHE;
                    else process.env.GJSIFY_PACKUMENT_CACHE = prevFlag;
                    rmSync(dir, { recursive: true, force: true });
                },
            };
        };

        await it('returns null on a cold cache', async () => {
            const { restore } = setup();
            try {
                expect(getCachedPackument(REGISTRY, 'lodash')).toBe(null);
            } finally {
                restore();
            }
        });

        await it('put + get round-trips the packument and ETag', async () => {
            const { restore } = setup();
            try {
                putCachedPackument(REGISTRY, 'lodash', '"etag-1"', PACKUMENT);
                const got = getCachedPackument(REGISTRY, 'lodash');
                expect(got).not.toBe(null);
                if (got) {
                    expect(got.etag).toBe('"etag-1"');
                    expect(got.packument.name).toBe('lodash');
                    expect(got.packument['dist-tags'].latest).toBe('4.17.21');
                }
            } finally {
                restore();
            }
        });

        await it('scoped + slashed names round-trip (filename encoding)', async () => {
            const { restore } = setup();
            try {
                putCachedPackument(REGISTRY, '@girs/glib-2.0', '"e"', PACKUMENT);
                const got = getCachedPackument(REGISTRY, '@girs/glib-2.0');
                expect(got?.etag).toBe('"e"');
            } finally {
                restore();
            }
        });

        await it('keys by registry — same name, different registry is a different entry', async () => {
            const { restore } = setup();
            try {
                putCachedPackument(REGISTRY, 'lodash', '"npmjs"', PACKUMENT);
                // A different registry must MISS even for the same package name.
                expect(getCachedPackument('https://other-registry.example.com/', 'lodash')).toBe(null);
                // The original registry still hits.
                expect(getCachedPackument(REGISTRY, 'lodash')?.etag).toBe('"npmjs"');
            } finally {
                restore();
            }
        });

        await it('empty ETag → put is a no-op', async () => {
            const { restore } = setup();
            try {
                putCachedPackument(REGISTRY, 'lodash', '', PACKUMENT);
                expect(getCachedPackument(REGISTRY, 'lodash')).toBe(null);
            } finally {
                restore();
            }
        });

        await it('GJSIFY_PACKUMENT_CACHE=0 disables both read and write', async () => {
            const { restore } = setup();
            try {
                // Seed with the cache enabled.
                putCachedPackument(REGISTRY, 'lodash', '"e"', PACKUMENT);
                expect(getCachedPackument(REGISTRY, 'lodash')).not.toBe(null);
                // Now disable: reads MISS and writes no-op.
                process.env.GJSIFY_PACKUMENT_CACHE = '0';
                expect(getCachedPackument(REGISTRY, 'lodash')).toBe(null);
                putCachedPackument(REGISTRY, 'other', '"x"', PACKUMENT);
                process.env.GJSIFY_PACKUMENT_CACHE = '1';
                expect(getCachedPackument(REGISTRY, 'other')).toBe(null);
            } finally {
                restore();
            }
        });
    });
};
