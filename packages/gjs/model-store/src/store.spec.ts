// Every case runs against a temporary root and an injected fetch: nothing here
// touches the network or the real cache directory.

import { describe, expect, it } from '@gjsify/unit';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelEntry } from './manifest.js';
import type { DownloadProgressEvent } from './progress.js';
import { ModelStore, type FetchLike } from './store.js';

const payload = new TextEncoder().encode('model weights, honestly');
const digest = createHash('sha256').update(payload).digest('hex');

const entry: ModelEntry = {
    id: 'tiny',
    file: 'tiny.onnx',
    url: 'https://example.org/tiny.onnx',
    bytes: payload.length,
    sha256: digest,
    license: 'MIT',
    redistributable: true,
};

/** A response streaming `body` in `chunk`-byte slices, optionally declaring another length. */
function respond(body: Uint8Array, init: { status?: number; contentLength?: string | null; chunk?: number } = {}) {
    const contentLength = init.contentLength === undefined ? String(body.length) : init.contentLength;
    const chunk = init.chunk ?? 5;
    let offset = 0;
    return {
        ok: (init.status ?? 200) < 400,
        status: init.status ?? 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength : null) },
        body: {
            getReader: () => ({
                read: async () => {
                    if (offset >= body.length) return { done: true };
                    const value = body.subarray(offset, offset + chunk);
                    offset += chunk;
                    return { done: false, value };
                },
                cancel: async () => undefined,
            }),
        },
        arrayBuffer: async () => body.slice().buffer,
    };
}

function withRoot<T>(body: (root: string) => Promise<T>): Promise<T> {
    const root = mkdtempSync(join(tmpdir(), 'model-store-'));
    return body(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

function store(root: string, extra: { fetch?: FetchLike; appDataDirs?: string[]; legacyDirs?: string[] } = {}) {
    return new ModelStore({ capability: 'speech', models: [entry], root: join(root, 'models'), ...extra });
}

export default async () => {
    await describe('ModelStore layout', async () => {
        await it('caches under <root>/<capability>', async () => {
            await withRoot(async (root) => {
                const s = store(root);
                expect(s.cacheDir).toBe(join(root, 'models', 'speech'));
                expect(s.cachePath()).toBe(join(root, 'models', 'speech', 'tiny.onnx'));
            });
        });

        await it('refuses a capability that is not a plain directory name', async () => {
            expect(() => new ModelStore({ capability: '../x', models: [entry] })).toThrow(/capability/);
            expect(() => new ModelStore({ capability: 'speech', models: [] })).toThrow(/no models/);
        });

        await it('names the known ids for an unknown one, and rejects install()', async () => {
            await withRoot(async (root) => {
                const s = store(root);
                expect(() => s.require('nope')).toThrow(/tiny/);
                await expect(s.install('nope')).rejects.toThrow(RangeError);
            });
        });
    });

    await describe('ModelStore install', async () => {
        await it('streams, verifies, renames into place and reports progress', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload) });
                expect(s.availability()).toBe('downloadable');
                const fractions: number[] = [];
                const path = await s.install('tiny', {
                    monitor: (m) =>
                        m.addEventListener('downloadprogress', (e) =>
                            fractions.push((e as DownloadProgressEvent).loaded),
                        ),
                });
                expect(path).toBe(s.cachePath());
                expect(readFileSync(path).length).toBe(payload.length);
                expect(fractions[0]).toBe(0);
                expect(fractions[fractions.length - 1]).toBe(1);
                expect(readdirSync(s.cacheDir).length).toBe(1);
                expect(s.availability()).toBe('available');
                expect(s.installed()).toStrictEqual(['tiny']);
            });
        });

        await it('shares one download between overlapping calls', async () => {
            await withRoot(async (root) => {
                let calls = 0;
                const s = store(root, {
                    fetch: async () => {
                        calls++;
                        return respond(payload);
                    },
                });
                const first = s.install();
                expect(s.availability()).toBe('downloading');
                const [a, b] = await Promise.all([first, s.install()]);
                expect(a).toBe(b);
                expect(calls).toBe(1);
            });
        });

        await it('refuses a wrong Content-Length before reading the body', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload, { contentLength: '123' }) });
                await expect(s.install()).rejects.toThrow(/declares 123 bytes/);
                expect(existsSync(s.cachePath())).toBe(false);
            });
        });

        await it('stops a body that runs past the manifest size, leaving no part file', async () => {
            await withRoot(async (root) => {
                const long = new Uint8Array(payload.length + 10);
                const s = store(root, { fetch: async () => respond(long, { contentLength: null }) });
                await expect(s.install()).rejects.toThrow(/more than/);
                expect(readdirSync(s.cacheDir).length).toBe(0);
            });
        });

        await it('refuses a body with the right size and the wrong digest', async () => {
            await withRoot(async (root) => {
                const wrong = new Uint8Array(payload.length);
                const s = store(root, { fetch: async () => respond(wrong) });
                await expect(s.install()).rejects.toThrow(/sha256/);
                expect(readdirSync(s.cacheDir).length).toBe(0);
            });
        });

        await it('reports an HTTP error', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload, { status: 404 }) });
                await expect(s.install()).rejects.toThrow(/HTTP 404/);
            });
        });

        await it('stops when the signal aborts', async () => {
            await withRoot(async (root) => {
                const controller = new AbortController();
                controller.abort();
                const s = store(root, { fetch: async () => respond(payload) });
                await expect(s.install('tiny', { signal: controller.signal })).rejects.toThrow();
                expect(readdirSync(s.cacheDir).length).toBe(0);
            });
        });

        await it('uninstalls only the cached file', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload) });
                expect(s.uninstall()).toBe(false);
                await s.install();
                expect(s.uninstall()).toBe(true);
                expect(s.availability()).toBe('downloadable');
            });
        });
    });

    await describe('ModelStore sources', async () => {
        await it('prefers a configured path, then the app data dir, then the cache', async () => {
            await withRoot(async (root) => {
                const appDir = join(root, 'app');
                mkdirSync(appDir);
                writeFileSync(join(appDir, entry.file), payload);
                const own = join(root, 'own.onnx');
                writeFileSync(own, payload);
                const s = store(root, { appDataDirs: [appDir] });
                expect(s.locate()?.source).toBe('app-data');
                expect(s.locate('tiny', { path: own })?.source).toBe('configured');
                expect(await s.resolve('tiny', { path: own })).toBe(own);
                expect(await s.resolve()).toBe(join(appDir, entry.file));
            });
        });

        await it('checks the digest of a non-cache source', async () => {
            await withRoot(async (root) => {
                const own = join(root, 'own.onnx');
                writeFileSync(own, new Uint8Array(payload.length));
                const s = store(root);
                await expect(s.resolve('tiny', { path: own })).rejects.toThrow(/sha256/);
            });
        });

        await it('throws for a configured path that is missing or the wrong size', async () => {
            await withRoot(async (root) => {
                const s = store(root);
                expect(() => s.locate('tiny', { path: join(root, 'missing') })).toThrow(/no file/);
                writeFileSync(join(root, 'short'), 'x');
                expect(() => s.locate('tiny', { path: join(root, 'short') })).toThrow(/1 bytes/);
            });
        });

        await it('moves a model from a legacy directory into the cache once', async () => {
            await withRoot(async (root) => {
                const legacy = join(root, 'speech-models');
                mkdirSync(legacy);
                writeFileSync(join(legacy, entry.file), payload);
                const s = store(root, { legacyDirs: [legacy] });
                const located = s.locate();
                expect(located?.source).toBe('cache');
                expect(located?.path).toBe(s.cachePath());
                expect(existsSync(join(legacy, entry.file))).toBe(false);
            });
        });

        await it('resolve() never downloads', async () => {
            await withRoot(async (root) => {
                const s = store(root, {
                    fetch: async () => {
                        throw new Error('fetched');
                    },
                });
                await expect(s.resolve()).rejects.toThrow(/not installed/);
            });
        });
    });
};
