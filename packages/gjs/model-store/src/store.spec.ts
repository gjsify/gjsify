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
    files: [
        {
            file: 'tiny.onnx',
            url: 'https://example.org/tiny.onnx',
            bytes: payload.length,
            sha256: digest,
        },
    ],
    license: 'MIT',
    redistributable: true,
};

const tokenPayload = new TextEncoder().encode('tokens');
const tokenDigest = createHash('sha256').update(tokenPayload).digest('hex');

const multiEntry: ModelEntry = {
    id: 'multi',
    files: [
        { file: 'encoder.onnx', url: 'https://example.org/encoder.onnx', bytes: payload.length, sha256: digest },
        { file: 'tokens.txt', url: 'https://example.org/tokens.txt', bytes: tokenPayload.length, sha256: tokenDigest },
    ],
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

function multiStore(root: string, extra: { fetch?: FetchLike; appDataDirs?: string[]; legacyDirs?: string[] } = {}) {
    return new ModelStore({ capability: 'speech', models: [multiEntry], root: join(root, 'models'), ...extra });
}

function respondFor(url: string): ReturnType<typeof respond> {
    if (url.includes('tokens')) return respond(tokenPayload);
    return respond(payload);
}

export default async () => {
    await describe('ModelStore layout', async () => {
        await it('caches under <root>/<capability>/<id>', async () => {
            await withRoot(async (root) => {
                const s = store(root);
                expect(s.cacheDir).toBe(join(root, 'models', 'speech'));
                expect(s.cachePath()).toBe(join(root, 'models', 'speech', 'tiny'));
                expect(s.cacheFilePath('tiny', 'tiny.onnx')).toBe(join(root, 'models', 'speech', 'tiny', 'tiny.onnx'));
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
                const result = await s.install('tiny', {
                    monitor: (m) =>
                        m.addEventListener('downloadprogress', (e) =>
                            fractions.push((e as DownloadProgressEvent).loaded),
                        ),
                });
                const path = result.files['tiny.onnx'];
                expect(path).toBe(s.cacheFilePath('tiny', 'tiny.onnx'));
                expect(readFileSync(path).length).toBe(payload.length);
                expect(fractions[0]).toBe(0);
                expect(fractions[fractions.length - 1]).toBe(1);
                expect(readdirSync(s.cacheDir).length).toBe(1);
                expect(s.availability()).toBe('available');
                expect(s.installed()).toStrictEqual(['tiny']);
            });
        });

        await it('downloads a multi-file entry and reports summed progress', async () => {
            await withRoot(async (root) => {
                let requestedUrls: string[] = [];
                const s = multiStore(root, {
                    fetch: async (_url, init) => {
                        requestedUrls.push(init.headers?.['X-Test'] ?? String(_url));
                        return respondFor(String(_url));
                    },
                });
                const events: DownloadProgressEvent[] = [];
                const result = await s.install('multi', {
                    monitor: (m) =>
                        m.addEventListener('downloadprogress', (e) => events.push(e as DownloadProgressEvent)),
                });
                expect(Object.keys(result.files).sort()).toStrictEqual(['encoder.onnx', 'tokens.txt']);
                expect(readFileSync(result.files['encoder.onnx']).length).toBe(payload.length);
                expect(readFileSync(result.files['tokens.txt']).length).toBe(tokenPayload.length);
                expect(events[0].receivedBytes).toBe(0);
                expect(events[events.length - 1].receivedBytes).toBe(payload.length + tokenPayload.length);
                expect(events[events.length - 1].totalBytes).toBe(payload.length + tokenPayload.length);
                expect(events[events.length - 1].loaded).toBe(1);
            });
        });

        await it('downloads only the missing files of a partially present entry', async () => {
            await withRoot(async (root) => {
                let calls = 0;
                const s = multiStore(root, {
                    fetch: async (url) => {
                        calls++;
                        return respondFor(url);
                    },
                });
                const dir = s.cachePath('multi');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'encoder.onnx'), payload);
                const result = await s.install('multi');
                expect(calls).toBe(1);
                expect(readFileSync(result.files['encoder.onnx']).length).toBe(payload.length);
                expect(readFileSync(result.files['tokens.txt']).length).toBe(tokenPayload.length);
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
                expect(a.dir).toBe(b.dir);
                expect(Object.keys(a.files)).toStrictEqual(Object.keys(b.files));
                expect(calls).toBe(1);
            });
        });

        await it('refuses a wrong Content-Length before reading the body', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload, { contentLength: '123' }) });
                await expect(s.install()).rejects.toThrow(/declares 123 bytes/);
                expect(existsSync(s.cacheFilePath('tiny', 'tiny.onnx'))).toBe(false);
            });
        });

        await it('stops a body that runs past the manifest size, leaving no part file', async () => {
            await withRoot(async (root) => {
                const long = new Uint8Array(payload.length + 10);
                const s = store(root, { fetch: async () => respond(long, { contentLength: null }) });
                await expect(s.install()).rejects.toThrow(/more than/);
                expect(readdirSync(s.cachePath()).length).toBe(0);
            });
        });

        await it('refuses a body with the right size and the wrong digest', async () => {
            await withRoot(async (root) => {
                const wrong = new Uint8Array(payload.length);
                const s = store(root, { fetch: async () => respond(wrong) });
                await expect(s.install()).rejects.toThrow(/sha256/);
                expect(readdirSync(s.cachePath()).length).toBe(0);
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
                expect(readdirSync(s.cachePath()).length).toBe(0);
            });
        });

        await it('leaves verified siblings intact and removes only the partial file on failure', async () => {
            await withRoot(async (root) => {
                const s = multiStore(root, {
                    fetch: async (url) => {
                        if (url.includes('tokens')) return respond(tokenPayload);
                        return respond(payload, { status: 500 });
                    },
                });
                const dir = s.cachePath('multi');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'tokens.txt'), tokenPayload);
                await expect(s.install('multi')).rejects.toThrow(/HTTP 500/);
                expect(existsSync(join(dir, 'tokens.txt'))).toBe(true);
                expect(existsSync(join(dir, 'encoder.onnx'))).toBe(false);
                expect(readdirSync(dir).some((name) => name.startsWith('.'))).toBe(false);
            });
        });

        await it('uninstalls only the cached directory', async () => {
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
                const appEntryDir = join(appDir, entry.id);
                mkdirSync(appEntryDir, { recursive: true });
                writeFileSync(join(appEntryDir, entry.files[0].file), payload);
                const ownDir = join(root, 'own');
                mkdirSync(ownDir, { recursive: true });
                writeFileSync(join(ownDir, entry.files[0].file), payload);
                const s = store(root, { appDataDirs: [appDir] });
                expect(s.locate()?.source).toBe('app-data');
                expect(s.locate('tiny', { path: ownDir })?.source).toBe('configured');
                expect((await s.resolve('tiny', { path: ownDir })).dir).toBe(ownDir);
                expect((await s.resolve()).files[entry.files[0].file]).toBe(join(appEntryDir, entry.files[0].file));
            });
        });

        await it('checks the digest of a non-cache source', async () => {
            await withRoot(async (root) => {
                const ownDir = join(root, 'own');
                mkdirSync(ownDir, { recursive: true });
                writeFileSync(join(ownDir, entry.files[0].file), new Uint8Array(payload.length));
                const s = store(root);
                await expect(s.resolve('tiny', { path: ownDir })).rejects.toThrow(/sha256/);
            });
        });

        await it('throws for a configured path that is missing a file or has the wrong size', async () => {
            await withRoot(async (root) => {
                const s = store(root);
                expect(() => s.locate('tiny', { path: join(root, 'missing') })).toThrow(/does not contain/);
                const shortDir = join(root, 'short');
                mkdirSync(shortDir, { recursive: true });
                writeFileSync(join(shortDir, entry.files[0].file), 'x');
                expect(() => s.locate('tiny', { path: shortDir })).toThrow(/does not contain/);
            });
        });

        await it('moves a model from a legacy directory into the cache once', async () => {
            await withRoot(async (root) => {
                const legacy = join(root, 'speech-models');
                mkdirSync(legacy, { recursive: true });
                writeFileSync(join(legacy, entry.files[0].file), payload);
                const s = store(root, { legacyDirs: [legacy] });
                const located = s.locate();
                expect(located?.source).toBe('cache');
                expect(located?.dir).toBe(s.cachePath());
                expect(existsSync(join(legacy, entry.files[0].file))).toBe(false);
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

        await it('reports a partially present entry as not ready', async () => {
            await withRoot(async (root) => {
                const s = multiStore(root);
                const dir = s.cachePath('multi');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'encoder.onnx'), payload);
                expect(s.locate('multi')).toBe(undefined);
                expect(s.availability('multi')).toBe('downloadable');
                await expect(s.resolve('multi')).rejects.toThrow(/not installed/);
            });
        });
    });
};
