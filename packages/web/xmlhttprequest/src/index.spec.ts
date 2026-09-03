// Coverage for the XMLHttpRequest this package actually ships — `src/index.ts`.
//
// WHY THE IMPORT IS RELATIVE, and why it has to stay that way.
// Every non-relative spelling of this package's own name reaches a DIFFERENT
// XMLHttpRequest. `@gjsify/resolve-npm` maps both `xmlhttprequest` and
// `@gjsify/xmlhttprequest` to `@gjsify/fetch` on the gjs target, to
// `@gjsify/empty` on node, and to this package's `globals.mjs` (the runtime's
// native XHR) on browser. A bare specifier here would therefore measure
// `packages/web/fetch/src/xhr.ts` — a second, fuller XHR — and report green
// while the class in THIS package stayed unmeasured. That is not hypothetical:
// the pre-existing `src/test.browser.mts` measures the browser's native global
// and says so in its own header, so a tier-1 package went its whole life at
// zero coverage with a test file sitting next to it.
//
// WHY THERE IS NO `test:node`. `src/index.ts` imports the default export AND
// `resolveRootRelativeUrl` from `@gjsify/fetch`; on `--app node` that specifier
// routes to `fetch/globals.mjs`, which exports neither, and the build stops at
// MISSING_EXPORT before a test can run. That is exactly what this package's
// `gjsify.runtimes.node: "none"` declares, and it is the same shape as the
// sibling GJS-only web packages (websocket, webaudio, gamepad, webrtc).

import { describe, expect, it } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';

import { FakeBlob, XMLHttpRequest, installObjectURLSupport } from './index.js';

let tempCounter = 0;

/** A fresh temp file plus the `file://` URL that addresses it. */
function tempFile(name: string, body: string | Uint8Array): { path: string; url: string } {
    const path = GLib.build_filenamev([GLib.get_tmp_dir(), `gjsify-xhr-spec-${tempCounter++}-${name}`]);
    GLib.file_set_contents(path, typeof body === 'string' ? new TextEncoder().encode(body) : body);
    return { path, url: `file://${path}` };
}

/** A path under the temp dir that is guaranteed NOT to exist. */
function missingPath(): string {
    return GLib.build_filenamev([GLib.get_tmp_dir(), `gjsify-xhr-spec-absent-${tempCounter++}`]);
}

interface DriveResult {
    xhr: XMLHttpRequest;
    /** Event types in dispatch order, recorded through `addEventListener`. */
    events: string[];
}

/**
 * Drive one request to its terminal `loadend` and hand back the request plus the
 * event order. `_emit` calls the `on<type>` property BEFORE the listeners, so the
 * settle hook is registered as the LAST `loadend` listener — a `xhr.onloadend`
 * resolver would win the race against the recorder and report `loadend` missing.
 *
 * A GLib timeout is the guard rather than `setTimeout`: this file is GJS-only and
 * GLib is already the transport's dependency, so the guard adds no import that the
 * subject does not already carry. Without it a request that never settles hangs the
 * whole run instead of failing one test.
 */
function drive(configure: (xhr: XMLHttpRequest) => void): Promise<DriveResult> {
    return new Promise<DriveResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const events: string[] = [];
        for (const type of ['loadstart', 'progress', 'load', 'error', 'abort', 'loadend']) {
            xhr.addEventListener(type, (event: { type: string }) => events.push(event.type));
        }

        const guard = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10_000, () => {
            reject(new Error(`XMLHttpRequest never reached loadend; saw [${events.join(', ')}]`));
            return GLib.SOURCE_REMOVE;
        });

        xhr.addEventListener('loadend', () => {
            GLib.source_remove(guard);
            resolve({ xhr, events });
        });

        configure(xhr);
        xhr.send();
    });
}

export default async () => {
    await describe('XMLHttpRequest — interface constants', async () => {
        await it('exposes the readyState constants on an instance', async () => {
            const xhr = new XMLHttpRequest();
            expect(xhr.UNSENT).toBe(0);
            expect(xhr.OPENED).toBe(1);
            expect(xhr.HEADERS_RECEIVED).toBe(2);
            expect(xhr.LOADING).toBe(3);
            expect(xhr.DONE).toBe(4);
        });

        await it('exposes the readyState constants on the interface object', async () => {
            // WebIDL puts an interface's constants on the interface OBJECT as well as
            // on the prototype, so `XMLHttpRequest.DONE` is how most code spells the
            // comparison. This package shipped only the instance half — which is why
            // its own `src/test.browser.mts` could assert `XMLHttpRequest.UNSENT` and
            // pass: in a browser it was reading the native global, never this class.
            expect(XMLHttpRequest.UNSENT).toBe(0);
            expect(XMLHttpRequest.OPENED).toBe(1);
            expect(XMLHttpRequest.HEADERS_RECEIVED).toBe(2);
            expect(XMLHttpRequest.LOADING).toBe(3);
            expect(XMLHttpRequest.DONE).toBe(4);
        });
    });

    await describe('XMLHttpRequest — initial state', async () => {
        await it('starts UNSENT with every response field empty', async () => {
            const xhr = new XMLHttpRequest();
            expect(xhr.readyState).toBe(xhr.UNSENT);
            expect(xhr.status).toBe(0);
            expect(xhr.statusText).toBe('');
            expect(xhr.response).toBeNull();
            expect(xhr.responseText).toBe('');
            expect(xhr.responseType).toBe('');
            expect(xhr.responseURL).toBe('');
            expect(xhr.timeout).toBe(0);
            expect(xhr.withCredentials).toBe(false);
        });

        await it('starts with every event-handler property null', async () => {
            const xhr = new XMLHttpRequest();
            expect(xhr.onloadstart).toBeNull();
            expect(xhr.onprogress).toBeNull();
            expect(xhr.onload).toBeNull();
            expect(xhr.onloadend).toBeNull();
            expect(xhr.onerror).toBeNull();
            expect(xhr.onabort).toBeNull();
            expect(xhr.ontimeout).toBeNull();
            expect(xhr.onreadystatechange).toBeNull();
        });
    });

    await describe('XMLHttpRequest#open', async () => {
        await it('moves UNSENT → OPENED', async () => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'file:///dev/null');
            expect(xhr.readyState).toBe(xhr.OPENED);
        });

        await it('stays OPENED when called twice', async () => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'file:///dev/null');
            xhr.open('POST', 'file:///dev/null');
            expect(xhr.readyState).toBe(xhr.OPENED);
        });

        await it('clears a previous abort so the instance is reusable', async () => {
            // `abort()` latches a flag that makes the completion handlers return early.
            // `open()` clears it — without that, a reused instance silently never
            // reports again, which is the shape a pooled/retrying caller hits.
            const file = tempFile('reuse.txt', 'second');
            const xhr = new XMLHttpRequest();
            xhr.open('GET', file.url);
            xhr.abort();

            const settled = new Promise<void>((resolve, reject) => {
                const guard = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10_000, () => {
                    reject(new Error('reused XMLHttpRequest never loaded'));
                    return GLib.SOURCE_REMOVE;
                });
                xhr.onload = () => {
                    GLib.source_remove(guard);
                    resolve();
                };
            });

            xhr.open('GET', file.url);
            xhr.responseType = 'text';
            xhr.send();
            await settled;
            expect(xhr.responseText).toBe('second');
            GLib.unlink(file.path);
        });
    });

    await describe('XMLHttpRequest — event dispatch', async () => {
        // `abort()` emits synchronously, so it is the cheapest probe for the dispatch
        // rules that every other event shares.
        await it('hands the event type to the handler property and to the listeners', async () => {
            const xhr = new XMLHttpRequest();
            const seen: string[] = [];
            xhr.onabort = (event: { type: string }) => seen.push(`property:${event.type}`);
            xhr.addEventListener('abort', (event: { type: string }) => seen.push(`listener:${event.type}`));
            xhr.abort();
            expect(seen).toStrictEqual(['property:abort', 'listener:abort']);
        });

        await it('calls listeners in registration order', async () => {
            const xhr = new XMLHttpRequest();
            const seen: string[] = [];
            xhr.addEventListener('abort', () => seen.push('first'));
            xhr.addEventListener('abort', () => seen.push('second'));
            xhr.abort();
            expect(seen).toStrictEqual(['first', 'second']);
        });

        await it('binds `this` to the request', async () => {
            // Compared inside the callbacks rather than captured into a variable:
            // `typescript/no-this-alias` is an oxlint error, and the comparison
            // answers the same question.
            const xhr = new XMLHttpRequest();
            let handlerBound = false;
            let listenerBound = false;
            xhr.onabort = function (this: unknown) {
                handlerBound = this === xhr;
            };
            xhr.addEventListener('abort', function (this: unknown) {
                listenerBound = this === xhr;
            });
            xhr.abort();
            expect(handlerBound).toBe(true);
            expect(listenerBound).toBe(true);
        });

        await it('stops calling a removed listener', async () => {
            const xhr = new XMLHttpRequest();
            let calls = 0;
            const listener = () => {
                calls++;
            };
            xhr.addEventListener('abort', listener);
            xhr.removeEventListener('abort', listener);
            xhr.abort();
            expect(calls).toBe(0);
        });

        await it('ignores removeEventListener for a type with no listeners', async () => {
            const xhr = new XMLHttpRequest();
            const neverRegistered = () => {};
            xhr.removeEventListener('progress', neverRegistered);
            expect(xhr.readyState).toBe(xhr.UNSENT);
        });
    });

    await describe('XMLHttpRequest#abort', async () => {
        await it('emits abort then loadend and lands on DONE', async () => {
            const xhr = new XMLHttpRequest();
            const events: string[] = [];
            xhr.addEventListener('abort', () => events.push('abort'));
            xhr.addEventListener('loadend', () => events.push('loadend'));
            xhr.open('GET', 'file:///dev/null');
            xhr.abort();
            expect(events).toStrictEqual(['abort', 'loadend']);
            expect(xhr.readyState).toBe(xhr.DONE);
        });

        await it('suppresses the completion of an in-flight request', async () => {
            const file = tempFile('suppressed.txt', 'never delivered');
            const xhr = new XMLHttpRequest();
            let loads = 0;
            let errors = 0;
            xhr.addEventListener('load', () => loads++);
            xhr.addEventListener('error', () => errors++);
            xhr.open('GET', file.url);
            xhr.responseType = 'text';
            xhr.send();
            xhr.abort();

            // The transport settles on a microtask; drain a main-loop turn so the
            // suppressed continuation has actually had its chance to run.
            await new Promise<void>((resolve) =>
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                }),
            );

            expect(loads).toBe(0);
            expect(errors).toBe(0);
            expect(xhr.responseText).toBe('');
            GLib.unlink(file.path);
        });
    });

    await describe('XMLHttpRequest#send — file:// transport', async () => {
        await it('reads a file:// URL as text and reports 200/OK', async () => {
            const file = tempFile('text.txt', 'hello gjs');
            const { xhr } = await drive((x) => {
                x.open('GET', file.url);
                x.responseType = 'text';
            });
            expect(xhr.readyState).toBe(xhr.DONE);
            expect(xhr.status).toBe(200);
            expect(xhr.statusText).toBe('OK');
            expect(xhr.responseText).toBe('hello gjs');
            expect(xhr.response).toBe('hello gjs');
            GLib.unlink(file.path);
        });

        await it('emits loadstart, progress, load and loadend in that order', async () => {
            const file = tempFile('order.txt', 'ordered');
            const { events } = await drive((x) => {
                x.open('GET', file.url);
                x.responseType = 'text';
            });
            expect(events).toStrictEqual(['loadstart', 'progress', 'load', 'loadend']);
            GLib.unlink(file.path);
        });

        await it("treats the default responseType '' as text", async () => {
            // XHR §response: an empty `responseType` behaves as `"text"`. Getting this
            // wrong is invisible at the call site — `xhr.responseText` just stays `''`
            // for the most common spelling of the API there is.
            const file = tempFile('default.txt', 'default is text');
            const { xhr } = await drive((x) => {
                x.open('GET', file.url);
            });
            expect(xhr.responseText).toBe('default is text');
            expect(xhr.response).toBe('default is text');
            GLib.unlink(file.path);
        });

        await it('reports progress totals that match the payload length', async () => {
            const file = tempFile('progress.txt', 'abcdefghij');
            const xhr = new XMLHttpRequest();
            const progress: Array<{ loaded: number; total: number; lengthComputable: boolean }> = [];
            xhr.addEventListener('progress', (event: { loaded: number; total: number; lengthComputable: boolean }) =>
                progress.push(event),
            );
            await new Promise<void>((resolve) => {
                xhr.addEventListener('loadend', () => resolve());
                xhr.open('GET', file.url);
                xhr.responseType = 'text';
                xhr.send();
            });
            expect(progress.length).toBe(1);
            expect(progress[0]?.loaded).toBe(10);
            expect(progress[0]?.total).toBe(10);
            expect(progress[0]?.lengthComputable).toBe(true);
            GLib.unlink(file.path);
        });

        await it("yields an ArrayBuffer for responseType 'arraybuffer'", async () => {
            const file = tempFile('bytes.bin', new Uint8Array([1, 2, 3, 4]));
            const { xhr } = await drive((x) => {
                x.open('GET', file.url);
                x.responseType = 'arraybuffer';
            });
            expect(xhr.response instanceof ArrayBuffer).toBe(true);
            expect((xhr.response as ArrayBuffer).byteLength).toBe(4);
            expect([...new Uint8Array(xhr.response as ArrayBuffer)]).toStrictEqual([1, 2, 3, 4]);
            GLib.unlink(file.path);
        });

        await it("parses the body for responseType 'json'", async () => {
            const file = tempFile('data.json', '{"answer":42,"tags":["a","b"]}');
            const { xhr } = await drive((x) => {
                x.open('GET', file.url);
                x.responseType = 'json';
            });
            expect((xhr.response as { answer: number }).answer).toBe(42);
            expect((xhr.response as { tags: string[] }).tags).toStrictEqual(['a', 'b']);
            GLib.unlink(file.path);
        });

        await it("yields a FakeBlob backed by a temp file for responseType 'blob'", async () => {
            const file = tempFile('image.png', new Uint8Array([137, 80, 78, 71]));
            const { xhr } = await drive((x) => {
                x.open('GET', file.url);
                x.responseType = 'blob';
            });
            const blob = xhr.response as FakeBlob;
            expect(blob instanceof FakeBlob).toBe(true);
            expect(blob.size).toBe(4);
            // The MIME type is guessed from the URL extension, not from a header —
            // there is no header to read on the `file://` path.
            expect(blob.type).toBe('image/png');
            expect(typeof blob._tmpPath).toBe('string');
            expect([...new Uint8Array(await blob.arrayBuffer())]).toStrictEqual([137, 80, 78, 71]);
            if (blob._tmpPath) GLib.unlink(blob._tmpPath);
            GLib.unlink(file.path);
        });

        await it('emits error then loadend for a file:// URL that does not exist', async () => {
            const { xhr, events } = await drive((x) => {
                x.open('GET', `file://${missingPath()}`);
                x.responseType = 'text';
            });
            expect(events).toStrictEqual(['loadstart', 'error', 'loadend']);
            expect(xhr.readyState).toBe(xhr.DONE);
            expect(xhr.responseText).toBe('');
        });

        await it('runs onreadystatechange when a request completes', async () => {
            // Deliberately `>= 1` and not an exact count: this implementation calls the
            // hook once, after DONE, rather than on each readyState transition. Pinning
            // the count would freeze that deviation into the suite.
            const file = tempFile('rsc.txt', 'ok');
            const xhr = new XMLHttpRequest();
            let calls = 0;
            xhr.onreadystatechange = () => calls++;
            await new Promise<void>((resolve) => {
                xhr.addEventListener('loadend', () => resolve());
                xhr.open('GET', file.url);
                xhr.responseType = 'text';
                xhr.send();
            });
            expect(calls).toBeGreaterThan(0);
            expect(xhr.readyState).toBe(xhr.DONE);
            GLib.unlink(file.path);
        });
    });

    await describe('XMLHttpRequest#send — HTTP transport', async () => {
        // The Soup-backed leg, driven against a local `node:http` server (which is
        // `@gjsify/http` here) exactly as `@gjsify/eventsource`'s suite does. `file://`
        // never touches `@gjsify/fetch`, so without this leg `status`, `statusText`,
        // `responseURL` and the request method are all unmeasured.
        const { createServer } = await import('node:http');

        async function withServer<T>(
            handler: (method: string | undefined, url: string | undefined) => { status: number; body: string },
            use: (origin: string, seen: { method?: string }) => Promise<T>,
        ): Promise<T> {
            const seen: { method?: string } = {};
            const server = createServer((req, res) => {
                seen.method = req.method;
                const { status, body } = handler(req.method, req.url);
                res.writeHead(status, { 'Content-Type': 'text/plain' });
                res.end(body);
            });
            const port = await new Promise<number>((resolve) => {
                server.listen(0, () => {
                    const address = server.address();
                    if (!address || typeof address === 'string') throw new Error('expected an AddressInfo');
                    resolve(address.port);
                });
            });
            try {
                return await use(`http://127.0.0.1:${port}`, seen);
            } finally {
                server.close();
            }
        }

        await it('exposes status, statusText and responseURL from the response', async () => {
            await withServer(
                () => ({ status: 200, body: 'from the server' }),
                async (origin) => {
                    const { xhr } = await drive((x) => {
                        x.open('GET', `${origin}/hello`);
                        x.responseType = 'text';
                    });
                    expect(xhr.status).toBe(200);
                    expect(xhr.responseText).toBe('from the server');
                    expect(xhr.responseURL).toBe(`${origin}/hello`);
                },
            );
        });

        await it('uppercases the method handed to open()', async () => {
            await withServer(
                () => ({ status: 200, body: 'ok' }),
                async (origin, seen) => {
                    await drive((x) => {
                        x.open('post', `${origin}/upper`);
                        x.responseType = 'text';
                    });
                    expect(seen.method).toBe('POST');
                },
            );
        });

        await it('surfaces a 404 as a status rather than as an error', async () => {
            await withServer(
                () => ({ status: 404, body: 'nope' }),
                async (origin) => {
                    const { xhr, events } = await drive((x) => {
                        x.open('GET', `${origin}/missing`);
                        x.responseType = 'text';
                    });
                    expect(xhr.status).toBe(404);
                    expect(events).toContain('load');
                    expect(events).not.toContain('error');
                },
            );
        });
    });

    await describe('XMLHttpRequest — the header surface is a deliberate stub', async () => {
        // Pinned, not aspirational: this class answers the XHR→Blob→Image chain and
        // says so in its source. The full header implementation lives in
        // `@gjsify/fetch`'s XHR, which is what the alias layer hands every bundled
        // consumer. Asserting the stub keeps the day someone implements it a
        // DELIBERATE edit here rather than a silent behaviour change.
        await it('accepts setRequestHeader and overrideMimeType without recording them', async () => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'file:///dev/null');
            xhr.setRequestHeader('X-Custom', 'value');
            xhr.overrideMimeType('text/plain');
            expect(xhr.getAllResponseHeaders()).toBe('');
        });

        await it('returns null from getResponseHeader for any name', async () => {
            const xhr = new XMLHttpRequest();
            expect(xhr.getResponseHeader('content-type')).toBeNull();
            expect(xhr.getResponseHeader('anything-at-all')).toBeNull();
        });
    });

    await describe('FakeBlob', async () => {
        await it('carries the type and size it was constructed with', async () => {
            const blob = new FakeBlob('image/png', 42);
            expect(blob.type).toBe('image/png');
            expect(blob.size).toBe(42);
        });

        await it('reads its temp file as an ArrayBuffer', async () => {
            const file = tempFile('blob.bin', new Uint8Array([9, 8, 7]));
            const blob = new FakeBlob('application/octet-stream', 3);
            blob._tmpPath = file.path;
            expect([...new Uint8Array(await blob.arrayBuffer())]).toStrictEqual([9, 8, 7]);
            GLib.unlink(file.path);
        });

        await it('decodes its temp file as text', async () => {
            const file = tempFile('blob.txt', 'blob text');
            const blob = new FakeBlob('text/plain', 9);
            blob._tmpPath = file.path;
            expect(await blob.text()).toBe('blob text');
            GLib.unlink(file.path);
        });

        await it('streams its bytes through a ReadableStream', async () => {
            const file = tempFile('stream.bin', new Uint8Array([1, 2]));
            const blob = new FakeBlob('application/octet-stream', 2);
            blob._tmpPath = file.path;
            const reader = blob.stream().getReader();
            const first = await reader.read();
            expect(first.done).toBe(false);
            expect([...(first.value as Uint8Array)]).toStrictEqual([1, 2]);
            expect((await reader.read()).done).toBe(true);
            GLib.unlink(file.path);
        });

        await it('yields an empty ArrayBuffer when it has no temp file', async () => {
            const blob = new FakeBlob('text/plain', 0);
            expect((await blob.arrayBuffer()).byteLength).toBe(0);
            expect(await blob.text()).toBe('');
        });
    });

    await describe('installObjectURLSupport', async () => {
        interface ObjectURLPatch {
            createObjectURL: (blob: FakeBlob) => string;
            revokeObjectURL: (url: string) => void;
            __gjsify_objecturl?: boolean;
        }
        const patched = () => URL as unknown as ObjectURLPatch;

        await it('installs createObjectURL and revokeObjectURL on URL', async () => {
            installObjectURLSupport();
            expect(typeof patched().createObjectURL).toBe('function');
            expect(typeof patched().revokeObjectURL).toBe('function');
            expect(patched().__gjsify_objecturl).toBe(true);
        });

        await it("turns a FakeBlob's temp path into a file:// URL", async () => {
            installObjectURLSupport();
            const file = tempFile('object.png', new Uint8Array([1]));
            const blob = new FakeBlob('image/png', 1);
            blob._tmpPath = file.path;
            const url = patched().createObjectURL(blob);
            expect(url).toBe(`file://${file.path}`);
            GLib.unlink(file.path);
        });

        await it('unlinks the temp file on revoke', async () => {
            installObjectURLSupport();
            const file = tempFile('revoke.png', new Uint8Array([1]));
            const blob = new FakeBlob('image/png', 1);
            blob._tmpPath = file.path;
            const url = patched().createObjectURL(blob);
            expect(GLib.file_test(file.path, GLib.FileTest.EXISTS)).toBe(true);
            patched().revokeObjectURL(url);
            expect(GLib.file_test(file.path, GLib.FileTest.EXISTS)).toBe(false);
        });

        await it('leaves an unknown URL alone on revoke', async () => {
            installObjectURLSupport();
            const file = tempFile('untracked.png', new Uint8Array([1]));
            patched().revokeObjectURL(`file://${file.path}`);
            expect(GLib.file_test(file.path, GLib.FileTest.EXISTS)).toBe(true);
            GLib.unlink(file.path);
        });

        await it('falls back for a blob that carries no temp path', async () => {
            installObjectURLSupport();
            expect(patched().createObjectURL(new FakeBlob('text/plain', 0))).toBe('file:///dev/null');
        });

        await it('is idempotent — a second call keeps the installed functions', async () => {
            installObjectURLSupport();
            const first = patched().createObjectURL;
            installObjectURLSupport();
            expect(patched().createObjectURL).toBe(first);
        });
    });
};
