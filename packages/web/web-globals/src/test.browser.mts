// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/web-globals.
//
// `@gjsify/web-globals` aggregates Web API globals that GJS lacks but a
// browser provides natively. This entry verifies the native browser platform
// exposes the same surface our GJS aggregator registers — using the globals
// directly, never importing the GJS register chain (which pulls in `gi://`
// bindings with no browser equivalent).

import { run, describe, it, expect } from '@gjsify/unit';

run({
    async WebGlobalsTest() {
        await describe('DOMException', async () => {
            await it('is a global constructor', async () => {
                expect(typeof globalThis.DOMException).toBe('function');
            });

            await it('carries standard error codes', async () => {
                expect(new DOMException('test', 'AbortError').code).toBe(20);
                expect(new DOMException('', 'NotFoundError').code).toBe(8);
                expect(new DOMException('', 'SyntaxError').code).toBe(12);
            });

            await it('is an instance of Error', async () => {
                expect(new DOMException('test') instanceof Error).toBe(true);
            });
        });

        await describe('DOM events', async () => {
            await it('Event / EventTarget are globals', async () => {
                expect(typeof globalThis.Event).toBe('function');
                expect(typeof globalThis.EventTarget).toBe('function');
            });

            await it('EventTarget dispatches events', async () => {
                const target = new EventTarget();
                let called = false;
                target.addEventListener('test', () => {
                    called = true;
                });
                target.dispatchEvent(new Event('test'));
                expect(called).toBe(true);
            });
        });

        await describe('AbortController / AbortSignal', async () => {
            await it('are globals', async () => {
                expect(typeof globalThis.AbortController).toBe('function');
                expect(typeof globalThis.AbortSignal).toBe('function');
            });

            await it('abort() flips signal.aborted', async () => {
                const ac = new AbortController();
                expect(ac.signal.aborted).toBe(false);
                ac.abort();
                expect(ac.signal.aborted).toBe(true);
            });
        });

        await describe('Web Streams', async () => {
            await it('stream constructors are globals', async () => {
                expect(typeof globalThis.ReadableStream).toBe('function');
                expect(typeof globalThis.WritableStream).toBe('function');
                expect(typeof globalThis.TransformStream).toBe('function');
            });

            await it('ReadableStream yields enqueued chunks', async () => {
                const rs = new ReadableStream<string>({
                    start(controller) {
                        controller.enqueue('test');
                        controller.close();
                    },
                });
                const reader = rs.getReader();
                const { value } = await reader.read();
                expect(value).toBe('test');
            });
        });

        await describe('Encoding / Compression streams', async () => {
            await it('TextEncoderStream / TextDecoderStream are globals', async () => {
                expect(typeof globalThis.TextEncoderStream).toBe('function');
                expect(typeof globalThis.TextDecoderStream).toBe('function');
            });

            await it('CompressionStream / DecompressionStream are globals', async () => {
                expect(typeof globalThis.CompressionStream).toBe('function');
                expect(typeof globalThis.DecompressionStream).toBe('function');
            });
        });

        await describe('WebCrypto', async () => {
            await it('crypto + crypto.subtle are available', async () => {
                expect(typeof globalThis.crypto).toBe('object');
                expect(globalThis.crypto.subtle).toBeDefined();
            });

            await it('getRandomValues fills a buffer', async () => {
                const buf = new Uint8Array(16);
                crypto.getRandomValues(buf);
                expect(buf.some((b) => b !== 0)).toBe(true);
            });

            await it('randomUUID returns a 36-char UUID', async () => {
                const uuid = crypto.randomUUID();
                expect(typeof uuid).toBe('string');
                expect(uuid.length).toBe(36);
                expect(uuid[8]).toBe('-');
            });
        });

        await describe('URL / URLSearchParams', async () => {
            await it('are globals and parse correctly', async () => {
                expect(typeof globalThis.URL).toBe('function');
                expect(typeof globalThis.URLSearchParams).toBe('function');
                const u = new URL('https://example.com:8080/path?q=1#hash');
                expect(u.hostname).toBe('example.com');
                expect(u.port).toBe('8080');
                expect(new URLSearchParams('a=1&b=2').get('a')).toBe('1');
            });
        });

        await describe('Blob / File / FormData', async () => {
            await it('Blob reports size and type', async () => {
                expect(typeof globalThis.Blob).toBe('function');
                const blob = new Blob(['hello']);
                expect(blob.size).toBe(5);
                expect(new Blob(['{}'], { type: 'application/json' }).type).toBe('application/json');
            });

            await it('File is a global', async () => {
                expect(typeof (globalThis as { File?: unknown }).File).toBe('function');
            });

            await it('FormData supports append / get', async () => {
                expect(typeof globalThis.FormData).toBe('function');
                const fd = new FormData();
                fd.append('key', 'value');
                expect(fd.get('key')).toBe('value');
            });
        });

        await describe('Performance', async () => {
            await it('performance global exposes now() / timeOrigin', async () => {
                expect(globalThis.performance).toBeDefined();
                expect(typeof performance.now()).toBe('number');
                expect(typeof performance.timeOrigin).toBe('number');
            });
        });
    },
});
