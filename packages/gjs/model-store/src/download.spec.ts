// Every case runs against a temporary directory and an injected fetch: nothing
// here touches the network or the real cache directory.

import { describe, expect, it } from '@gjsify/unit';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { downloadVerified } from './download.js';
import type { DownloadProgressEvent } from './progress.js';

const payload = new TextEncoder().encode('model weights, honestly');
const digest = createHash('sha256').update(payload).digest('hex');

function sameBytes(a: Uint8Array | Buffer, b: Uint8Array | Buffer): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** A response streaming `body` in `chunk`-byte slices, optionally declaring another length or range. */
function respond(
    body: Uint8Array,
    init: { status?: number; contentLength?: string | null; contentRange?: string | null; chunk?: number } = {},
) {
    const contentLength = init.contentLength === undefined ? String(body.length) : init.contentLength;
    const chunk = init.chunk ?? 5;
    let offset = 0;
    return {
        ok: (init.status ?? 200) < 400,
        status: init.status ?? 200,
        headers: {
            get: (name: string) => {
                const key = name.toLowerCase();
                if (key === 'content-length') return contentLength;
                if (key === 'content-range') return init.contentRange ?? null;
                return null;
            },
        },
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
    const root = mkdtempSync(join(tmpdir(), 'model-download-'));
    return body(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

export default async () => {
    await describe('downloadVerified', async () => {
        await it('streams and renames into place without digest checks', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'nested', 'model.onnx');
                const result = await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    fetch: async () => respond(payload),
                });
                expect(existsSync(dest)).toBe(true);
                expect(readFileSync(dest).length).toBe(payload.length);
                expect(result.bytes).toBe(payload.length);
                expect(result.sha256).toBe(digest);
            });
        });

        await it('succeeds when bytes and sha256 match', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    bytes: payload.length,
                    sha256: digest,
                    fetch: async () => respond(payload),
                });
                expect(readFileSync(dest).length).toBe(payload.length);
            });
        });

        await it('rejects a size mismatch', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                await expect(
                    downloadVerified({
                        url: 'https://example.org/model.onnx',
                        dest,
                        bytes: payload.length + 1,
                        fetch: async () => respond(payload, { contentLength: null }),
                    }),
                ).rejects.toThrow(/got 23 bytes, expected 24/);
                expect(existsSync(dest)).toBe(false);
                expect(readdirSync(root).length).toBe(0);
            });
        });

        await it('rejects a sha256 mismatch', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const wrong = new Uint8Array(payload.length);
                await expect(
                    downloadVerified({
                        url: 'https://example.org/model.onnx',
                        dest,
                        sha256: digest,
                        fetch: async () => respond(wrong),
                    }),
                ).rejects.toThrow(/sha256/);
                expect(existsSync(dest)).toBe(false);
            });
        });

        await it('leaves no partial file after failure', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                await expect(
                    downloadVerified({
                        url: 'https://example.org/model.onnx',
                        dest,
                        fetch: async () => respond(payload, { status: 500 }),
                    }),
                ).rejects.toThrow();
                expect(readdirSync(root).length).toBe(0);
            });
        });

        await it('forwards custom headers', async () => {
            await withRoot(async (root) => {
                let receivedHeaders: Record<string, string> | undefined;
                const dest = join(root, 'model.onnx');
                await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    headers: { Authorization: 'Bearer token' },
                    fetch: async (_url, init) => {
                        receivedHeaders = init.headers;
                        return respond(payload);
                    },
                });
                expect(receivedHeaders?.Authorization).toBe('Bearer token');
            });
        });

        await it('stops when the signal aborts', async () => {
            await withRoot(async (root) => {
                const controller = new AbortController();
                controller.abort();
                const dest = join(root, 'model.onnx');
                await expect(
                    downloadVerified({
                        url: 'https://example.org/model.onnx',
                        dest,
                        signal: controller.signal,
                        fetch: async () => respond(payload),
                    }),
                ).rejects.toThrow();
                expect(existsSync(dest)).toBe(false);
            });
        });

        await it('emits downloadprogress events', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const events: DownloadProgressEvent[] = [];
                await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    bytes: payload.length,
                    fetch: async () => respond(payload, { chunk: 5 }),
                    monitor: (m) =>
                        m.addEventListener('downloadprogress', (e) => events.push(e as DownloadProgressEvent)),
                });
                expect(events.length).toBeGreaterThanOrEqual(2);
                expect(events[0].loaded).toBe(0);
                expect(events[events.length - 1].loaded).toBe(1);
                expect(events[events.length - 1].receivedBytes).toBe(payload.length);
            });
        });

        await it('creates the parent directory', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'a', 'b', 'c', 'model.onnx');
                await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    fetch: async () => respond(payload),
                });
                expect(existsSync(dest)).toBe(true);
            });
        });

        await it('resumes a partial download with Range and appends a 206', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const partial = `${dest}.part`;
                writeFileSync(partial, payload.subarray(0, 10));
                let rangeHeader: string | undefined;
                const result = await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    bytes: payload.length,
                    sha256: digest,
                    fetch: async (_url, init) => {
                        rangeHeader = init.headers?.Range;
                        return respond(payload.subarray(10), {
                            status: 206,
                            contentRange: `bytes 10-${payload.length - 1}/${payload.length}`,
                            chunk: 5,
                        });
                    },
                });
                expect(rangeHeader).toBe('bytes=10-');
                expect(sameBytes(readFileSync(dest), payload)).toBe(true);
                expect(existsSync(partial)).toBe(false);
                expect(result.bytes).toBe(payload.length);
                expect(result.sha256).toBe(digest);
            });
        });

        await it('restarts from scratch when the server ignores Range and returns 200', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const partial = `${dest}.part`;
                writeFileSync(partial, new TextEncoder().encode('stale-data'));
                const result = await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    bytes: payload.length,
                    sha256: digest,
                    fetch: async () => respond(payload, { chunk: 5 }),
                });
                expect(sameBytes(readFileSync(dest), payload)).toBe(true);
                expect(existsSync(partial)).toBe(false);
                expect(result.bytes).toBe(payload.length);
                expect(result.sha256).toBe(digest);
            });
        });

        await it('verifies a complete partial on 416 and restarts when it is incomplete', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const partial = `${dest}.part`;
                writeFileSync(partial, payload);
                let calls = 0;
                const result = await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    bytes: payload.length,
                    sha256: digest,
                    fetch: async () => {
                        calls += 1;
                        return respond(new Uint8Array(0), { status: 416 });
                    },
                });
                expect(calls).toBe(1);
                expect(sameBytes(readFileSync(dest), payload)).toBe(true);
                expect(existsSync(partial)).toBe(false);
                expect(result.bytes).toBe(payload.length);

                // Incomplete partial: 416 discards it and a second fetch returns 200.
                const dest2 = join(root, 'model2.onnx');
                const partial2 = `${dest2}.part`;
                writeFileSync(partial2, payload.subarray(0, 10));
                let calls2 = 0;
                await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest: dest2,
                    bytes: payload.length,
                    sha256: digest,
                    fetch: async () => {
                        calls2 += 1;
                        return calls2 === 1
                            ? respond(new Uint8Array(0), { status: 416 })
                            : respond(payload, { chunk: 5 });
                    },
                });
                expect(calls2).toBe(2);
                expect(sameBytes(readFileSync(dest2), payload)).toBe(true);
            });
        });

        await it('deletes the partial when a resumed download fails sha256 verification', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const partial = `${dest}.part`;
                const wrongTail = new TextEncoder().encode('x'.repeat(13));
                const wrong = new Uint8Array(payload.length);
                writeFileSync(partial, payload.subarray(0, 10));
                let calls = 0;
                await expect(
                    downloadVerified({
                        url: 'https://example.org/model.onnx',
                        dest,
                        bytes: payload.length,
                        sha256: digest,
                        fetch: async () => {
                            calls += 1;
                            return calls === 1
                                ? respond(wrongTail, {
                                      status: 206,
                                      contentRange: `bytes 10-${payload.length - 1}/${payload.length}`,
                                  })
                                : respond(wrong);
                        },
                    }),
                ).rejects.toThrow(/sha256/);
                expect(calls).toBe(2);
                expect(existsSync(dest)).toBe(false);
                expect(existsSync(partial)).toBe(false);
            });
        });

        await it('retries once from scratch when a stale partial fails verification', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const partial = `${dest}.part`;
                const stalePrefix = new TextEncoder().encode('stale prefix here!');
                writeFileSync(partial, stalePrefix);
                let calls = 0;
                const result = await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    bytes: payload.length,
                    sha256: digest,
                    fetch: async (_url, init) => {
                        calls += 1;
                        if (calls === 1) {
                            expect(init.headers?.Range).toBe(`bytes=${stalePrefix.length}-`);
                            return respond(payload.subarray(stalePrefix.length), {
                                status: 206,
                                contentRange: `bytes ${stalePrefix.length}-${payload.length - 1}/${payload.length}`,
                            });
                        }
                        expect(init.headers?.Range).toBeUndefined();
                        return respond(payload);
                    },
                });
                expect(calls).toBe(2);
                expect(sameBytes(readFileSync(dest), payload)).toBe(true);
                expect(existsSync(partial)).toBe(false);
                expect(result.sha256).toBe(digest);
            });
        });

        await it('fails immediately on a fresh download with a wrong hash', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const wrong = new Uint8Array(payload.length);
                let calls = 0;
                await expect(
                    downloadVerified({
                        url: 'https://example.org/model.onnx',
                        dest,
                        bytes: payload.length,
                        sha256: digest,
                        fetch: async () => {
                            calls += 1;
                            return respond(wrong);
                        },
                    }),
                ).rejects.toThrow(/sha256/);
                expect(calls).toBe(1);
                expect(existsSync(dest)).toBe(false);
            });
        });

        await it('keeps the partial file when the signal aborts mid-download', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const partial = `${dest}.part`;
                const controller = new AbortController();
                let reads = 0;
                const body = payload;
                const chunk = 5;
                let offset = 0;
                await expect(
                    downloadVerified({
                        url: 'https://example.org/model.onnx',
                        dest,
                        bytes: payload.length,
                        sha256: digest,
                        signal: controller.signal,
                        fetch: async () => ({
                            ok: true,
                            status: 200,
                            headers: { get: () => null },
                            body: {
                                getReader: () => ({
                                    read: async () => {
                                        reads += 1;
                                        if (reads === 2) controller.abort();
                                        if (offset >= body.length) return { done: true };
                                        const value = body.subarray(offset, offset + chunk);
                                        offset += chunk;
                                        return { done: false, value };
                                    },
                                    cancel: async () => undefined,
                                }),
                            },
                            arrayBuffer: async () => body.slice().buffer,
                        }),
                    }),
                ).rejects.toThrow();
                expect(existsSync(dest)).toBe(false);
                expect(existsSync(partial)).toBe(true);
            });
        });

        await it('reports progress from the resumed offset', async () => {
            await withRoot(async (root) => {
                const dest = join(root, 'model.onnx');
                const partial = `${dest}.part`;
                writeFileSync(partial, payload.subarray(0, 10));
                const events: DownloadProgressEvent[] = [];
                await downloadVerified({
                    url: 'https://example.org/model.onnx',
                    dest,
                    bytes: payload.length,
                    sha256: digest,
                    fetch: async () =>
                        respond(payload.subarray(10), {
                            status: 206,
                            contentRange: `bytes 10-${payload.length - 1}/${payload.length}`,
                            chunk: 5,
                        }),
                    monitor: (m) =>
                        m.addEventListener('downloadprogress', (e) => events.push(e as DownloadProgressEvent)),
                });
                expect(events[0].receivedBytes).toBe(10);
                expect(events[events.length - 1].receivedBytes).toBe(payload.length);
            });
        });
    });
};
