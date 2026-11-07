// Every case runs against a temporary directory and an injected fetch: nothing
// here touches the network or the real cache directory.

import { describe, expect, it } from '@gjsify/unit';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { downloadVerified } from './download.js';
import type { DownloadProgressEvent } from './progress.js';

const payload = new TextEncoder().encode('model weights, honestly');
const digest = createHash('sha256').update(payload).digest('hex');

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
    });
};
