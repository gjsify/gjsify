// Every case runs against a temporary root and an injected fetch: nothing here
// touches the network or the real cache directory.

import { describe, expect, it } from '@gjsify/unit';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

const entry2: ModelEntry = {
    id: 'tiny-too',
    files: [
        {
            file: 'tiny.onnx',
            url: 'https://example.org/tiny-too.onnx',
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

const hfEntry: ModelEntry = {
    id: 'hf-tiny',
    files: [
        {
            file: 'tiny.onnx',
            url: 'https://huggingface.co/org/repo/resolve/main/model.onnx',
            bytes: payload.length,
            sha256: digest,
        },
    ],
    license: 'MIT',
    redistributable: true,
};

const hfMultiEntry: ModelEntry = {
    id: 'hf-multi',
    files: [
        {
            file: 'encoder.onnx',
            url: 'https://huggingface.co/org/repo/resolve/main/encoder.onnx',
            bytes: payload.length,
            sha256: digest,
        },
        {
            file: 'tokens.txt',
            url: 'https://huggingface.co/org/repo/resolve/main/tokens.txt',
            bytes: tokenPayload.length,
            sha256: tokenDigest,
        },
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

function store(
    root: string,
    extra: {
        fetch?: FetchLike;
        appDataDirs?: string[];
        legacyDirs?: string[];
        link?: (a: string, b: string) => void;
    } = {},
) {
    return new ModelStore({ capability: 'speech', models: [entry], root: join(root, 'models'), ...extra });
}

function multiStore(root: string, extra: { fetch?: FetchLike; appDataDirs?: string[]; legacyDirs?: string[] } = {}) {
    return new ModelStore({ capability: 'speech', models: [multiEntry], root: join(root, 'models'), ...extra });
}

function respondFor(url: string): ReturnType<typeof respond> {
    if (url.includes('tokens')) return respond(tokenPayload);
    return respond(payload);
}

function blobPath(root: string, sha256: string): string {
    return join(root, 'models', 'blobs', sha256);
}

function hfHub(root: string): string {
    return join(root, 'hf-hub');
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
                const events: DownloadProgressEvent[] = [];
                const result = await s.install('multi', {
                    monitor: (m) =>
                        m.addEventListener('downloadprogress', (e) => events.push(e as DownloadProgressEvent)),
                });
                expect(calls).toBe(1);
                expect(readFileSync(result.files['encoder.onnx']).length).toBe(payload.length);
                expect(readFileSync(result.files['tokens.txt']).length).toBe(tokenPayload.length);
                expect(events[events.length - 1].loaded).toBe(1);
                expect(events[events.length - 1].receivedBytes).toBe(payload.length + tokenPayload.length);
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

        await it('leaves verified siblings intact and removes only the partial file on a mid-stream failure', async () => {
            await withRoot(async (root) => {
                const s = multiStore(root, {
                    fetch: async (url) => {
                        if (url.includes('encoder')) return respond(payload);
                        let sent = 0;
                        const chunk = 5;
                        return {
                            ...respond(tokenPayload),
                            body: {
                                getReader: () => ({
                                    read: async () => {
                                        if (sent >= 5) throw new Error('mid-stream failure');
                                        if (sent >= tokenPayload.length) return { done: true };
                                        const value = tokenPayload.subarray(sent, sent + chunk);
                                        sent += value.length;
                                        return { done: false, value };
                                    },
                                    cancel: async () => undefined,
                                }),
                            },
                        };
                    },
                });
                const dir = s.cachePath('multi');
                await expect(s.install('multi')).rejects.toThrow(/mid-stream failure/);
                expect(existsSync(join(dir, 'encoder.onnx'))).toBe(true);
                expect(readFileSync(join(dir, 'encoder.onnx')).length).toBe(payload.length);
                expect(existsSync(join(dir, 'tokens.txt'))).toBe(false);
                expect(readdirSync(dir).some((name) => name.includes('.part-'))).toBe(false);
            });
        });

        await it('uninstalls only the cached directory and refuses escaped ids', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload) });
                expect(s.uninstall()).toBe(false);
                await s.install();
                expect(s.uninstall()).toBe(true);
                expect(s.availability()).toBe('downloadable');
                for (const bad of ['', '.', '..', '/abs', 'a/b']) {
                    expect(() => s.uninstall(bad)).toThrow();
                }
            });
        });

        await it('reports 0 and 1 when everything is already present', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload) });
                await s.install();
                const events: DownloadProgressEvent[] = [];
                await s.install('tiny', {
                    monitor: (m) =>
                        m.addEventListener('downloadprogress', (e) => events.push(e as DownloadProgressEvent)),
                });
                expect(events[0].loaded).toBe(0);
                expect(events[events.length - 1].loaded).toBe(1);
            });
        });

        await it('does not dedupe force downloads or downloads with a different fetch', async () => {
            await withRoot(async (root) => {
                let calls = 0;
                const fetchA = async () => {
                    calls++;
                    return respond(payload);
                };
                const fetchB = async () => {
                    calls++;
                    return respond(payload);
                };
                const s = store(root, { fetch: fetchA });
                await Promise.all([s.install('tiny', { force: true }), s.install('tiny', { force: true })]);
                expect(calls).toBe(2);
                s.uninstall('tiny');
                calls = 0;
                await Promise.all([s.install('tiny'), s.install('tiny', { fetch: fetchB })]);
                expect(calls).toBe(2);
            });
        });

        await it('keys in-flight dedupe by path as well as id', async () => {
            await withRoot(async (root) => {
                const pathA = join(root, 'path-a');
                const pathB = join(root, 'path-b');
                mkdirSync(pathA, { recursive: true });
                mkdirSync(pathB, { recursive: true });
                writeFileSync(join(pathA, entry.files[0].file), payload);
                writeFileSync(join(pathB, entry.files[0].file), payload);
                const s = store(root);
                const [a, b] = await Promise.all([
                    s.install('tiny', { path: pathA }),
                    s.install('tiny', { path: pathB }),
                ]);
                expect(a.dir).toBe(pathA);
                expect(b.dir).toBe(pathB);
            });
        });

        await it('cleans up the partial file when aborted between files', async () => {
            await withRoot(async (root) => {
                const controller = new AbortController();
                const s = multiStore(root, {
                    fetch: async (url) => {
                        if (url.includes('encoder')) return respond(payload);
                        controller.abort();
                        return respond(tokenPayload);
                    },
                });
                const dir = s.cachePath('multi');
                await expect(s.install('multi', { signal: controller.signal })).rejects.toThrow();
                expect(existsSync(join(dir, 'encoder.onnx'))).toBe(true);
                expect(readFileSync(join(dir, 'encoder.onnx')).length).toBe(payload.length);
                expect(existsSync(join(dir, 'tokens.txt'))).toBe(false);
                expect(readdirSync(dir).some((name) => name.includes('.part-'))).toBe(false);
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

    await describe('ModelStore content-addressed dedupe', async () => {
        await it('creates a blob after the first install', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload) });
                await s.install('tiny');
                expect(existsSync(blobPath(root, digest))).toBe(true);
                expect(statSync(blobPath(root, digest)).nlink).toBeGreaterThanOrEqual(2);
            });
        });

        await it('links from the blob instead of downloading a second id with the same sha', async () => {
            await withRoot(async (root) => {
                let calls = 0;
                const s = new ModelStore({
                    capability: 'speech',
                    models: [entry, entry2],
                    root: join(root, 'models'),
                    fetch: async () => {
                        calls++;
                        return respond(payload);
                    },
                });
                await s.install('tiny');
                expect(calls).toBe(1);
                calls = 0;
                await s.install('tiny-too');
                expect(calls).toBe(0);
                const blob = blobPath(root, digest);
                expect(statSync(s.cacheFilePath('tiny', 'tiny.onnx')).ino).toBe(statSync(blob).ino);
                expect(statSync(s.cacheFilePath('tiny-too', 'tiny.onnx')).ino).toBe(statSync(blob).ino);
            });
        });

        await it('keeps the blob while another id uses it and removes it with the last', async () => {
            await withRoot(async (root) => {
                const s = new ModelStore({
                    capability: 'speech',
                    models: [entry, entry2],
                    root: join(root, 'models'),
                    fetch: async () => respond(payload),
                });
                await s.install('tiny');
                await s.install('tiny-too');
                const blob = blobPath(root, digest);
                expect(statSync(blob).nlink).toBe(3);
                s.uninstall('tiny');
                expect(existsSync(blob)).toBe(true);
                expect(statSync(blob).nlink).toBe(2);
                s.uninstall('tiny-too');
                expect(existsSync(blob)).toBe(false);
            });
        });

        await it('falls back to a plain file when linking throws', async () => {
            await withRoot(async (root) => {
                let calls = 0;
                const s = store(root, {
                    fetch: async () => {
                        calls++;
                        return respond(payload);
                    },
                    link: () => {
                        throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
                    },
                });
                await s.install('tiny');
                expect(calls).toBe(1);
                expect(existsSync(s.cacheFilePath('tiny', 'tiny.onnx'))).toBe(true);
                expect(existsSync(blobPath(root, digest))).toBe(false);
            });
        });

        await it('dedupe() links two identical legacy plain files and reclaims space', async () => {
            await withRoot(async (root) => {
                const s = new ModelStore({
                    capability: 'speech',
                    models: [entry, entry2],
                    root: join(root, 'models'),
                });
                const dir1 = s.cachePath('tiny');
                const dir2 = s.cachePath('tiny-too');
                mkdirSync(dir1, { recursive: true });
                mkdirSync(dir2, { recursive: true });
                writeFileSync(join(dir1, 'tiny.onnx'), payload);
                writeFileSync(join(dir2, 'tiny.onnx'), payload);

                const result = await s.dedupe();
                expect(result.linked).toBe(2);
                expect(result.reclaimedBytes).toBe(payload.length);
                expect(result.removedOrphans).toBe(0);

                const blob = blobPath(root, digest);
                expect(existsSync(blob)).toBe(true);
                expect(statSync(s.cacheFilePath('tiny', 'tiny.onnx')).ino).toBe(statSync(blob).ino);
                expect(statSync(s.cacheFilePath('tiny-too', 'tiny.onnx')).ino).toBe(statSync(blob).ino);
            });
        });

        await it('dedupe() removes orphan blobs and skips files with a mismatched digest', async () => {
            await withRoot(async (root) => {
                const s = store(root, { fetch: async () => respond(payload) });
                await s.install('tiny');
                s.uninstall('tiny');

                // Recreate the blob as an orphan to exercise orphan cleanup.
                const blob = blobPath(root, digest);
                mkdirSync(dirname(blob), { recursive: true });
                writeFileSync(blob, payload);
                expect(existsSync(blob)).toBe(true);

                // Corrupt the cache for a fresh plain-file entry.
                const dir = s.cachePath('tiny');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'tiny.onnx'), 'wrong content');

                const result = await s.dedupe();
                expect(result.removedOrphans).toBe(1);
                expect(existsSync(blob)).toBe(false);
                expect(readFileSync(join(dir, 'tiny.onnx'), 'utf8')).toBe('wrong content');
            });
        });
    });

    await describe('ModelStore Hugging Face cache source', async () => {
        await it('dedupe() never lets a blob of the right size but other content replace a verified file', async () => {
            await withRoot(async (root) => {
                const s = store(root);
                const dir = s.cachePath('tiny');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'tiny.onnx'), payload);
                const blob = blobPath(root, digest);
                mkdirSync(dirname(blob), { recursive: true });
                writeFileSync(blob, new Uint8Array(payload.length).fill(66));

                await s.dedupe();
                expect(readFileSync(join(dir, 'tiny.onnx'))).toStrictEqual(Buffer.from(payload));
                expect(readFileSync(blob)).toStrictEqual(Buffer.from(payload));
            });
        });

        await it('install() does not link a damaged blob into a new entry', async () => {
            await withRoot(async (root) => {
                let calls = 0;
                const s = new ModelStore({
                    capability: 'speech',
                    models: [entry, entry2],
                    root: join(root, 'models'),
                    fetch: async () => {
                        calls++;
                        return respond(payload);
                    },
                });
                const blob = blobPath(root, digest);
                mkdirSync(dirname(blob), { recursive: true });
                writeFileSync(blob, new Uint8Array(payload.length).fill(66));
                await s.install('tiny');
                expect(calls).toBe(1);
                expect(readFileSync(s.cacheFilePath('tiny', 'tiny.onnx'))).toStrictEqual(Buffer.from(payload));
                expect(readFileSync(blob)).toStrictEqual(Buffer.from(payload));
            });
        });

        await it('install({ force }) fetches again and repairs the blob', async () => {
            await withRoot(async (root) => {
                let calls = 0;
                const s = store(root, {
                    fetch: async () => {
                        calls++;
                        return respond(payload);
                    },
                });
                await s.install('tiny');
                const bad = new Uint8Array(payload.length).fill(66);
                writeFileSync(s.cacheFilePath('tiny', 'tiny.onnx'), bad); // writes through the shared inode
                await s.install('tiny', { force: true });
                expect(calls).toBe(2);
                expect(readFileSync(s.cacheFilePath('tiny', 'tiny.onnx'))).toStrictEqual(Buffer.from(payload));
                expect(readFileSync(blobPath(root, digest))).toStrictEqual(Buffer.from(payload));
            });
        });

        await it('finds a model via url+snapshot path', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const snapshotDir = join(hub, 'models--org--repo', 'snapshots', 'main');
                mkdirSync(snapshotDir, { recursive: true });
                writeFileSync(join(snapshotDir, 'model.onnx'), payload);
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                const located = s.locate('hf-tiny');
                expect(located?.source).toBe('huggingface');
                expect(located?.files['tiny.onnx']).toBe(join(snapshotDir, 'model.onnx'));
                expect(s.availability('hf-tiny')).toBe('available');
            });
        });

        await it('finds a model via blob-by-sha and prefers a snapshot link', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const blobDir = join(hub, 'models--org--repo', 'blobs');
                const snapshotDir = join(hub, 'models--org--repo', 'snapshots', 'main');
                mkdirSync(blobDir, { recursive: true });
                mkdirSync(snapshotDir, { recursive: true });
                writeFileSync(join(blobDir, digest), payload);
                symlinkSync(join(blobDir, digest), join(snapshotDir, 'model.onnx'));
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                const located = s.locate('hf-tiny');
                expect(located?.source).toBe('huggingface');
                expect(located?.files['tiny.onnx']).toBe(join(snapshotDir, 'model.onnx'));
            });
        });

        await it('finds a model via blob-by-sha when no snapshot link exists', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const blobDir = join(hub, 'models--org--repo', 'blobs');
                mkdirSync(blobDir, { recursive: true });
                writeFileSync(join(blobDir, digest), payload);
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                const located = s.locate('hf-tiny');
                expect(located?.source).toBe('huggingface');
                expect(located?.files['tiny.onnx']).toBe(join(blobDir, digest));
            });
        });

        await it('does not find a HF file with the wrong size', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const snapshotDir = join(hub, 'models--org--repo', 'snapshots', 'main');
                mkdirSync(snapshotDir, { recursive: true });
                writeFileSync(join(snapshotDir, 'model.onnx'), 'short');
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                expect(s.locate('hf-tiny')).toBe(undefined);
                expect(s.availability('hf-tiny')).toBe('downloadable');
            });
        });

        await it('does not find a partial HF entry', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const snapshotDir = join(hub, 'models--org--repo', 'snapshots', 'main');
                mkdirSync(snapshotDir, { recursive: true });
                writeFileSync(join(snapshotDir, 'encoder.onnx'), payload);
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfMultiEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                expect(s.locate('hf-multi')).toBe(undefined);
            });
        });

        await it('verifies the digest of a HF file once per process', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const snapshotDir = join(hub, 'models--org--repo', 'snapshots', 'main');
                mkdirSync(snapshotDir, { recursive: true });
                writeFileSync(join(snapshotDir, 'model.onnx'), payload);
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                // A whole-second mtime survives the round trip through utimes exactly.
                const path = join(snapshotDir, 'model.onnx');
                utimesSync(path, 1_700_000_000, 1_700_000_000);
                const first = await s.resolve('hf-tiny');
                // Same size, same mtime, other bytes: only a remembered digest can still say yes.
                writeFileSync(path, new Uint8Array(payload.length).fill(65));
                utimesSync(path, 1_700_000_000, 1_700_000_000);
                const second = await s.resolve('hf-tiny');
                expect(first.files['tiny.onnx']).toBe(second.files['tiny.onnx']);
                // A changed mtime invalidates the memory and the digest is checked again.
                utimesSync(path, 1_700_000_100, 1_700_000_100);
                await expect(s.resolve('hf-tiny')).rejects.toThrow();
            });
        });

        await it('does not follow a snapshot symlink out of the hub', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const snapshotDir = join(hub, 'models--org--repo', 'snapshots', 'main');
                mkdirSync(snapshotDir, { recursive: true });
                const outside = join(root, 'outside.onnx');
                writeFileSync(outside, payload);
                symlinkSync(outside, join(snapshotDir, 'model.onnx'));
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                expect(s.locate('hf-tiny')).toBeUndefined();
                expect(s.availability('hf-tiny')).toBe('downloadable');
            });
        });

        await it('ignores a manifest URL with dot segments instead of throwing', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                mkdirSync(hub, { recursive: true });
                const bad: ModelEntry = {
                    ...hfEntry,
                    id: 'hf-bad',
                    files: [
                        { ...hfEntry.files[0], url: 'https://huggingface.co/org/repo/resolve/main/../../../x.onnx' },
                    ],
                };
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry, bad],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                expect(s.locate('hf-bad')).toBeUndefined();
                expect(s.availability('hf-tiny')).toBe('downloadable');
            });
        });

        await it('prefers the cache over the HF source', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const snapshotDir = join(hub, 'models--org--repo', 'snapshots', 'main');
                mkdirSync(snapshotDir, { recursive: true });
                writeFileSync(join(snapshotDir, 'model.onnx'), payload);
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                });
                const dir = s.cachePath('hf-tiny');
                mkdirSync(dir, { recursive: true });
                writeFileSync(join(dir, 'tiny.onnx'), payload);
                const located = s.locate('hf-tiny');
                expect(located?.source).toBe('cache');
                expect(dirname(located!.files['tiny.onnx'])).toBe(dir);
            });
        });

        await it('never writes to the HF cache from install, uninstall or dedupe', async () => {
            await withRoot(async (root) => {
                const hub = hfHub(root);
                const snapshotDir = join(hub, 'models--org--repo', 'snapshots', 'main');
                mkdirSync(snapshotDir, { recursive: true });
                writeFileSync(join(snapshotDir, 'model.onnx'), payload);
                const s = new ModelStore({
                    capability: 'speech',
                    models: [hfEntry],
                    root: join(root, 'models'),
                    huggingFaceCache: hub,
                    fetch: async () => respond(payload),
                });
                const before = readdirSync(snapshotDir);
                await s.install('hf-tiny');
                await s.install('hf-tiny', { force: true });
                s.uninstall('hf-tiny');
                await s.dedupe();
                expect(readdirSync(snapshotDir)).toStrictEqual(before);
                expect(readFileSync(join(snapshotDir, 'model.onnx')).length).toBe(payload.length);
            });
        });
    });
};
