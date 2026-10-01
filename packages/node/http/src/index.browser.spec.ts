// Browser-target conformance spec for @gjsify/http.
//
// Imports the browser entry directly (`./browser.js`) — under `gjsify build
// --app browser` the bundler picks the same file via `ALIASES_NODE_FOR_BROWSER`
// (`node:http` → `@gjsify/http/browser`), so these assertions lock in the
// behaviour exercised in the Playwright/Firefox/SpiderMonkey suite.
//
// Three halves are covered, matching what `src/browser.ts` actually promises:
//
//   1. the fetch-backed CLIENT (`request`/`get` → `ClientRequest` →
//      `IncomingMessage`) against the same http-server that serves the
//      Playwright harness — flowing `'data'`/`'end'`, paused `read()` +
//      `'readable'`, `setEncoding()`, async iteration, status codes;
//   2. the header VALIDATORS re-exported from `./validators.js` — these were
//      empty function bodies until recently, so a browser build silently
//      accepted header names/values Node rejects;
//   3. the SERVER half (`createServer`/`Server`/`ServerResponse`/
//      `OutgoingMessage`), which must throw a structured ENOTSUP rather than
//      pretend a browser can bind a listening socket.
//
// Runs unchanged under plain Node (`node dist/test.browser.mjs`) as long as a
// static server is listening on the fallback origin — every API used here is
// WHATWG (`fetch`, `Blob`, `TextDecoder`, `AbortController`).

import { describe, it, expect } from '@gjsify/unit';
import http, {
    request,
    get,
    createServer,
    Server,
    ServerResponse,
    OutgoingMessage,
    ClientRequest,
    IncomingMessage,
    Agent,
    globalAgent,
    validateHeaderName,
    validateHeaderValue,
    setMaxIdleHTTPParsers,
    METHODS,
    STATUS_CODES,
    maxHeaderSize,
} from './browser.js';

// Same-origin URL served by the Playwright http-server (repo root). The harness
// index.html is guaranteed to exist; a missing path yields a real 404.
const origin = globalThis.location?.origin ?? 'http://localhost:8087';
const OK_URL = `${origin}/tests/browser/harness/index.html`;
const OK_PATH = '/tests/browser/harness/index.html';
const MISSING_URL = `${origin}/tests/browser/__http_nonexistent__.html`;

/** Split the fallback/document origin into the RequestOptions triple. */
function originOptions(): { protocol: string; hostname: string; port: string } {
    const u = new URL(origin);
    return { protocol: u.protocol, hostname: u.hostname, port: u.port };
}

/** Promise-wrap the callback-style client surface. */
function fetchIncoming(url: string): Promise<IncomingMessage> {
    return new Promise<IncomingMessage>((resolve, reject) => {
        const req = get(url, resolve);
        req.on('error', reject);
    });
}

/** Capture the `code` of a thrown error, or `undefined` when nothing threw. */
function codeOf(fn: () => unknown): string | undefined {
    try {
        fn();
    } catch (err) {
        return (err as { code?: string }).code;
    }
    return undefined;
}

export default async () => {
    await describe('http (browser)', async () => {
        await describe('exports', async () => {
            await it('should export the client surface as functions', async () => {
                expect(typeof request).toBe('function');
                expect(typeof get).toBe('function');
                expect(typeof ClientRequest).toBe('function');
                expect(typeof IncomingMessage).toBe('function');
                expect(typeof Agent).toBe('function');
                expect(typeof setMaxIdleHTTPParsers).toBe('function');
            });

            await it('should mirror the public surface on the default export', async () => {
                expect(typeof http.request).toBe('function');
                expect(typeof http.get).toBe('function');
                expect(typeof http.createServer).toBe('function');
                expect(typeof http.validateHeaderName).toBe('function');
                expect(typeof http.validateHeaderValue).toBe('function');
                expect(http.METHODS).toBe(METHODS);
                expect(http.STATUS_CODES).toBe(STATUS_CODES);
            });

            await it('should expose the HTTP constants', async () => {
                expect(METHODS).toContain('GET');
                expect(METHODS).toContain('POST');
                expect(STATUS_CODES[200]).toBe('OK');
                expect(STATUS_CODES[404]).toBe('Not Found');
                expect(maxHeaderSize).toBe(16384);
            });

            await it('should expose an Agent stub instance as globalAgent', async () => {
                expect(globalAgent instanceof Agent).toBe(true);
                expect(typeof globalAgent.destroy).toBe('function');
                // Never throws — the browser has no socket pool to tear down.
                globalAgent.destroy();
            });
        });

        // These re-export `./validators.js`. Empty bodies here meant a browser
        // build accepted header names/values Node rejects, so the assertions
        // below are the regression gate for that.
        await describe('validateHeaderName', async () => {
            await it('should accept valid HTTP tokens', async () => {
                validateHeaderName('content-type');
                validateHeaderName('X-Custom-Header');
                validateHeaderName("!#$%&'*+-.^_`|~");
            });

            await it('should throw ERR_INVALID_HTTP_TOKEN for invalid names', async () => {
                for (const bad of ['', 'has space', 'colon:', 'new\nline', 'quote"']) {
                    expect(codeOf(() => validateHeaderName(bad))).toBe('ERR_INVALID_HTTP_TOKEN');
                }
            });

            await it('should throw a TypeError instance', async () => {
                let err: unknown;
                try {
                    validateHeaderName('bad header');
                } catch (e) {
                    err = e;
                }
                expect(err instanceof TypeError).toBe(true);
            });
        });

        await describe('validateHeaderValue', async () => {
            await it('should accept printable values', async () => {
                validateHeaderValue('x-test', 'plain value');
                validateHeaderValue('x-test', 'tab\tseparated');
                validateHeaderValue('x-test', 42);
            });

            await it('should throw ERR_HTTP_INVALID_HEADER_VALUE for undefined', async () => {
                expect(codeOf(() => validateHeaderValue('x-test', undefined))).toBe('ERR_HTTP_INVALID_HEADER_VALUE');
            });

            await it('should throw ERR_INVALID_CHAR for control characters', async () => {
                expect(codeOf(() => validateHeaderValue('x-test', 'bad\nvalue'))).toBe('ERR_INVALID_CHAR');
                expect(codeOf(() => validateHeaderValue('x-test', 'bad\rvalue'))).toBe('ERR_INVALID_CHAR');
                expect(codeOf(() => validateHeaderValue('x-test', 'nul\0byte'))).toBe('ERR_INVALID_CHAR');
            });
        });

        // A browser cannot bind a TCP listening socket. Faking a server would
        // hide the platform limit, so every server entry throws.
        await describe('server paths are ENOTSUP', async () => {
            await it('should throw a structured ENOTSUP from createServer', async () => {
                let err: (Error & { code?: string; errno?: number; syscall?: string }) | undefined;
                try {
                    createServer();
                } catch (e) {
                    err = e as Error & { code?: string; errno?: number; syscall?: string };
                }
                expect(err instanceof Error).toBe(true);
                expect(err?.code).toBe('ENOTSUP');
                // posix-literal-ok: the browser shim SYNTHESIZES this error, so -45 is our own constant on every host, not a kernel errno
                expect(err?.errno).toBe(-45);
                expect(err?.syscall).toBe('createServer');
                expect(err?.message).toContain('not supported in the browser');
            });

            await it('should throw ENOTSUP from the server constructors', async () => {
                expect(codeOf(() => new Server())).toBe('ENOTSUP');
                expect(codeOf(() => new ServerResponse())).toBe('ENOTSUP');
                expect(codeOf(() => new OutgoingMessage())).toBe('ENOTSUP');
            });

            await it('should still expose them as constructors (module-init probes)', async () => {
                expect(typeof Server).toBe('function');
                expect(typeof ServerResponse).toBe('function');
                expect(typeof OutgoingMessage).toBe('function');
            });
        });

        await describe('ClientRequest header accessors', async () => {
            await it('should set, read and remove headers before the request flushes', async () => {
                const req = request({ ...originOptions(), path: OK_PATH });
                req.setHeader('X-Test', 'value');
                expect(req.getHeader('X-Test')).toBe('value');
                req.setHeader('X-List', ['a', 'b']);
                expect((req.getHeader('X-List') as string[]).length).toBe(2);
                req.removeHeader('X-Test');
                expect(req.getHeader('X-Test')).toBeUndefined();
                req.abort();
            });

            await it('should default the method to GET and expose the path', async () => {
                const req = request({ ...originOptions(), path: OK_PATH });
                expect(req.method).toBe('GET');
                expect(req.path).toBe(OK_PATH);
                req.abort();
            });

            await it('should uppercase a lowercase method', async () => {
                const req = request({ ...originOptions(), path: OK_PATH, method: 'post' });
                expect(req.method).toBe('POST');
                req.abort();
            });

            await it('should expose no-op socket tuning methods', async () => {
                const req = request({ ...originOptions(), path: OK_PATH });
                req.setNoDelay(true);
                req.setSocketKeepAlive(true, 1000);
                req.flushHeaders();
                req.abort();
            });
        });

        await describe('http.get', async () => {
            await it('should resolve a 200 with a status message and headers', async () => {
                const res = await fetchIncoming(OK_URL);
                expect(res.statusCode).toBe(200);
                expect(typeof res.statusMessage).toBe('string');
                // fetch always exposes content-type for a served HTML file.
                expect(typeof res.headers['content-type']).toBe('string');
                expect(res.httpVersion).toBe('1.1');
                expect(res.method).toBe('GET');
            });

            await it('should lower-case header names and keep rawHeaders pairs', async () => {
                const res = await fetchIncoming(OK_URL);
                for (const key of Object.keys(res.headers)) {
                    expect(key).toBe(key.toLowerCase());
                }
                expect(res.rawHeaders.length % 2).toBe(0);
                expect(res.rawHeaders.length).toBeGreaterThan(0);
            });

            await it('should accept a URL instance', async () => {
                const res = await new Promise<IncomingMessage>((resolve, reject) => {
                    const req = get(new URL(OK_URL), resolve);
                    req.on('error', reject);
                });
                expect(res.statusCode).toBe(200);
            });
        });

        await describe('IncomingMessage flowing mode', async () => {
            await it("should concatenate 'data' chunks and fire 'end'", async () => {
                const body = await new Promise<string>((resolve, reject) => {
                    get(OK_URL, (res) => {
                        const chunks: Uint8Array[] = [];
                        res.on('data', (c: unknown) => chunks.push(c as Uint8Array));
                        res.on('end', () => {
                            const total = chunks.reduce((n, c) => n + c.length, 0);
                            const merged = new Uint8Array(total);
                            let off = 0;
                            for (const c of chunks) {
                                merged.set(c, off);
                                off += c.length;
                            }
                            resolve(new TextDecoder().decode(merged));
                        });
                        res.on('error', reject);
                    });
                });
                expect(body).toContain('<!DOCTYPE html>');
            });

            await it('should mark the message complete once ended', async () => {
                const res = await fetchIncoming(OK_URL);
                await new Promise<void>((resolve, reject) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve());
                    res.on('error', reject);
                });
                expect(res.complete).toBe(true);
                expect(res.readable).toBe(false);
            });

            await it('should stream through addListener as well as on', async () => {
                // The flowing-mode entry is `on`; a consumer that subscribes
                // with `addListener` (what `@xmpp/events`' onoff() resolves for a
                // non-DOM target) must reach the same drain path.
                const res = await fetchIncoming(OK_URL);
                let delivered = 0;
                await new Promise<void>((resolve, reject) => {
                    res.addListener('data', (c: unknown) => {
                        delivered += (c as Uint8Array).length;
                    });
                    res.on('end', () => resolve());
                    res.on('error', reject);
                });
                expect(delivered > 0).toBe(true);
            });

            await it('should alias addListener to on', async () => {
                const proto = IncomingMessage.prototype as unknown as Record<string, unknown>;
                expect(proto.addListener).toBe(proto.on);
            });

            await it("should emit string chunks after setEncoding('utf8')", async () => {
                const body = await new Promise<string>((resolve, reject) => {
                    get(OK_URL, (res) => {
                        res.setEncoding('utf8');
                        let acc = '';
                        let allStrings = true;
                        res.on('data', (c: unknown) => {
                            if (typeof c !== 'string') allStrings = false;
                            acc += c as string;
                        });
                        res.on('end', () => {
                            expect(allStrings).toBe(true);
                            resolve(acc);
                        });
                        res.on('error', reject);
                    });
                });
                expect(body).toContain('<!DOCTYPE html>');
            });

            await it('should pipe into a writable-shaped sink', async () => {
                const res = await fetchIncoming(OK_URL);
                const written: unknown[] = [];
                const done = new Promise<void>((resolve) => {
                    res.pipe({
                        write(c: unknown) {
                            written.push(c);
                            return true;
                        },
                        end() {
                            resolve();
                        },
                    });
                });
                await done;
                expect(written.length).toBeGreaterThan(0);
            });
        });

        await describe('IncomingMessage paused mode', async () => {
            await it("should buffer chunks for read() and still fire 'end'", async () => {
                const res = await fetchIncoming(OK_URL);
                const chunks: Uint8Array[] = [];
                await new Promise<void>((resolve, reject) => {
                    res.on('readable', () => {
                        let chunk: Uint8Array | string | null;
                        while ((chunk = res.read()) !== null) {
                            chunks.push(chunk as Uint8Array);
                        }
                    });
                    res.on('end', () => resolve());
                    res.on('error', reject);
                });
                expect(chunks.length).toBeGreaterThan(0);
                const total = chunks.reduce((n, c) => n + c.length, 0);
                expect(total).toBeGreaterThan(0);
            });

            await it("should still fire 'end' when the drain is deferred a turn", async () => {
                // Regression: `_push(null)` can only emit 'end' while the buffer
                // is already empty, so a reader that drains on a LATER turn (the
                // usual paused shape) never saw 'end' at all. read() now
                // re-checks once it empties the buffer.
                const res = await fetchIncoming(OK_URL);
                let bytes = 0;
                await new Promise<void>((resolve, reject) => {
                    res.on('readable', () => {
                        setTimeout(() => {
                            let chunk: Uint8Array | string | null;
                            while ((chunk = res.read()) !== null) {
                                bytes += (chunk as Uint8Array).length;
                            }
                        }, 0);
                    });
                    res.on('end', () => resolve());
                    res.on('error', reject);
                });
                expect(bytes).toBeGreaterThan(0);
            });

            await it('should return null from read() on an empty buffer', async () => {
                const res = await fetchIncoming(MISSING_URL);
                // Nothing consumed yet on a fresh message.
                expect(res.read()).toBeNull();
            });
        });

        await describe('IncomingMessage async iteration', async () => {
            await it('should yield body chunks via for-await', async () => {
                const res = await fetchIncoming(OK_URL);
                let bytes = 0;
                for await (const chunk of res) {
                    bytes += (chunk as Uint8Array).length;
                }
                expect(bytes).toBeGreaterThan(0);
            });
        });

        await describe('http.request', async () => {
            await it('should report statusCode 404 for a non-existent path', async () => {
                const res = await new Promise<IncomingMessage>((resolve, reject) => {
                    const req = request(MISSING_URL, resolve);
                    req.on('error', reject);
                    req.end();
                });
                expect(res.statusCode).toBe(404);
            });

            await it('should accept a written body and still resolve a response', async () => {
                const res = await new Promise<IncomingMessage>((resolve, reject) => {
                    const req = request(OK_URL, { method: 'POST' }, resolve);
                    req.on('error', reject);
                    req.write('hello');
                    req.end();
                });
                // The static server may reject POST (405) or accept it — either way
                // the client path produced a real IncomingMessage with a status.
                expect(typeof res.statusCode).toBe('number');
            });

            await it('should build the URL from a RequestOptions object', async () => {
                const res = await new Promise<IncomingMessage>((resolve, reject) => {
                    const req = request({ ...originOptions(), path: OK_PATH }, resolve);
                    req.on('error', reject);
                    req.end();
                });
                expect(res.statusCode).toBe(200);
            });

            await it('should invoke the end() callback once flushed', async () => {
                await new Promise<void>((resolve, reject) => {
                    const req = request(OK_URL, () => {});
                    req.on('error', reject);
                    req.end(undefined, () => resolve());
                });
            });

            await it('should ignore a second end() call', async () => {
                const res = await new Promise<IncomingMessage>((resolve, reject) => {
                    const req = request(OK_URL, resolve);
                    req.on('error', reject);
                    req.end();
                    req.end();
                });
                expect(res.statusCode).toBe(200);
            });

            await it('should refuse writes after end()', async () => {
                const req = request(OK_URL, () => {});
                req.on('error', () => {});
                req.end();
                expect(req.write('late')).toBe(false);
            });
        });

        await describe('ClientRequest abort', async () => {
            await it("should emit 'abort' and 'close' and never surface an error", async () => {
                const req = request(OK_URL, () => {});
                let errored = false;
                req.on('error', () => {
                    errored = true;
                });
                const aborted = new Promise<void>((resolve) => req.on('abort', () => resolve()));
                req.end();
                req.abort();
                await aborted;
                expect(req.aborted).toBe(true);
                expect(req.writable).toBe(false);
                // Give the swallowed fetch rejection a turn to land.
                await new Promise<void>((r) => setTimeout(r, 20));
                expect(errored).toBe(false);
            });

            await it('should abort when a pre-aborted AbortSignal is passed', async () => {
                const ctrl = new AbortController();
                ctrl.abort();
                const req = request(OK_URL, { signal: ctrl.signal }, () => {});
                req.on('error', () => {});
                const aborted = new Promise<void>((resolve) => req.on('abort', () => resolve()));
                req.end();
                await aborted;
                expect(req.aborted).toBe(true);
            });
        });
    });
};
