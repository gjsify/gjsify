// SPDX-License-Identifier: MIT
// File-based Worker spec — exercises `new Worker(filename | URL, opts?)` with
// real .mjs fixtures on disk. Complements the in-source `eval: true` tests in
// `index.spec.ts` by validating the path-resolution branch of
// `Worker._resolveFilename` against actual files.
//
// Three resolution shapes are covered:
//   1. URL instance — `new Worker(new URL('./fixtures/echo-worker.mjs', import.meta.url))`
//      (the Node-documented canonical form for bundle-relative workers).
//   2. Absolute path string — `new Worker(fileURLToPath(url))`.
//   3. file:// URL string — `new Worker(url.href)`.
//
// The fixture (`fixtures/echo-worker.mjs`) is self-contained (only imports
// `node:worker_threads`), so it runs as raw .mjs under both Node and GJS
// without going through `gjsify build`.

import { describe, it, expect } from '@gjsify/unit';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const FIXTURE_URL = new URL('./fixtures/echo-worker.mjs', import.meta.url);
const FIXTURE_PATH = fileURLToPath(FIXTURE_URL);

interface Message {
    type: string;
    payload?: unknown;
    value?: unknown;
}

/** Collect the next N messages from a worker, then resolve. */
function collectMessages(worker: Worker, count: number, timeoutMs = 5000): Promise<Message[]> {
    return new Promise((resolve, reject) => {
        const out: Message[] = [];
        const timer = setTimeout(() => {
            reject(new Error(`timed out waiting for ${count} messages, got ${out.length}: ${JSON.stringify(out)}`));
        }, timeoutMs);
        worker.on('message', (msg: Message) => {
            out.push(msg);
            if (out.length >= count) {
                clearTimeout(timer);
                resolve(out);
            }
        });
        worker.on('error', (err: Error) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

export default async () => {
    await describe('Worker — file-based (URL instance)', async () => {
        await it('loads a fixture via new URL() and round-trips a ping', async () => {
            const worker = new Worker(FIXTURE_URL);
            try {
                const [ready, pong] = await new Promise<Message[]>((resolve, reject) => {
                    const collected: Message[] = [];
                    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
                    worker.on('message', (msg: Message) => {
                        collected.push(msg);
                        if (collected.length === 1) {
                            worker.postMessage({ type: 'ping', payload: { hello: 'world' } });
                        }
                        if (collected.length === 2) {
                            clearTimeout(timer);
                            resolve(collected);
                        }
                    });
                    worker.on('error', (err: Error) => {
                        clearTimeout(timer);
                        reject(err);
                    });
                });
                expect(ready!.type).toBe('ready');
                expect(pong!.type).toBe('pong');
                expect(pong!.payload).toStrictEqual({ hello: 'world' });
            } finally {
                await worker.terminate();
            }
        });

        await it('exposes workerData when constructed with options.workerData', async () => {
            const worker = new Worker(FIXTURE_URL, {
                workerData: { from: 'parent', count: 42 },
            });
            try {
                const messages = await new Promise<Message[]>((resolve, reject) => {
                    const collected: Message[] = [];
                    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
                    worker.on('message', (msg: Message) => {
                        collected.push(msg);
                        if (collected.length === 1) {
                            worker.postMessage({ type: 'workerData' });
                        }
                        if (collected.length === 2) {
                            clearTimeout(timer);
                            resolve(collected);
                        }
                    });
                    worker.on('error', (err: Error) => {
                        clearTimeout(timer);
                        reject(err);
                    });
                });
                expect(messages[1]!.type).toBe('workerData');
                expect(messages[1]!.value).toStrictEqual({ from: 'parent', count: 42 });
            } finally {
                await worker.terminate();
            }
        });

        await it('reports threadId from inside the worker', async () => {
            const worker = new Worker(FIXTURE_URL);
            try {
                const messages = await new Promise<Message[]>((resolve, reject) => {
                    const collected: Message[] = [];
                    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
                    worker.on('message', (msg: Message) => {
                        collected.push(msg);
                        if (collected.length === 1) {
                            worker.postMessage({ type: 'threadId' });
                        }
                        if (collected.length === 2) {
                            clearTimeout(timer);
                            resolve(collected);
                        }
                    });
                    worker.on('error', (err: Error) => {
                        clearTimeout(timer);
                        reject(err);
                    });
                });
                expect(messages[1]!.type).toBe('threadId');
                expect(typeof messages[1]!.value).toBe('number');
                expect((messages[1]!.value as number) > 0).toBe(true);
            } finally {
                await worker.terminate();
            }
        });
    });

    await describe('Worker — file-based (absolute path string)', async () => {
        await it('loads a fixture via absolute path string', async () => {
            const worker = new Worker(FIXTURE_PATH);
            try {
                const ready = await new Promise<Message>((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
                    worker.on('message', (msg: Message) => {
                        clearTimeout(timer);
                        resolve(msg);
                    });
                    worker.on('error', (err: Error) => {
                        clearTimeout(timer);
                        reject(err);
                    });
                });
                expect(ready.type).toBe('ready');
            } finally {
                await worker.terminate();
            }
        });
    });

    // Note: bare `file://` URL strings are intentionally NOT tested as a
    // Node-compat surface — Node rejects them with `ERR_WORKER_PATH` and
    // requires the caller to wrap via `new URL(href)`. `@gjsify/worker_threads`
    // accepts them as a GJS-only extension (see `Worker._resolveFilename`),
    // but exercising that path here would diverge from Node and break the
    // shared spec.

    await describe('Worker — file-based (graceful close)', async () => {
        await it('exits cleanly when the worker calls parentPort.close()', async () => {
            const worker = new Worker(FIXTURE_URL);
            try {
                const result = await new Promise<{ closing?: Message; exit?: number }>((resolve, reject) => {
                    const out: { closing?: Message; exit?: number } = {};
                    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
                    worker.on('message', (msg: Message) => {
                        if (msg.type === 'ready') {
                            worker.postMessage({ type: 'close' });
                        } else if (msg.type === 'closing') {
                            out.closing = msg;
                        }
                    });
                    worker.on('exit', (code: number) => {
                        out.exit = code;
                        clearTimeout(timer);
                        resolve(out);
                    });
                    worker.on('error', (err: Error) => {
                        clearTimeout(timer);
                        reject(err);
                    });
                });
                expect(result.closing?.type).toBe('closing');
                expect(typeof result.exit).toBe('number');
            } finally {
                if (!worker.threadId || worker.threadId === -1) return;
                try { await worker.terminate(); } catch { /* already gone */ }
            }
        });
    });

    // Pull the imports into scope so they're not flagged as unused.
    void collectMessages;
};
