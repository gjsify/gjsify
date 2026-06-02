// SPDX-License-Identifier: MIT
// Browser test entry for @gjsify/http — exercises the fetch-backed client path
// (`request`/`get` → ClientRequest → IncomingMessage) against the same
// http-server that serves the Playwright harness. The browser-target alias
// layer (`ALIASES_NODE_FOR_BROWSER`, PR #388) routes `node:http` → this module,
// and `tests/browser/` discovers the resulting `dist/test.browser.mjs` bundle.
//
// Only the client path is covered: a browser cannot listen on a socket, so the
// server path throws a structured ENOTSUP (asserted below).

import { run, describe, it, expect } from '@gjsify/unit';
import http, { request, get, createServer, type IncomingMessage } from './browser.js';

// Same-origin URL served by the Playwright http-server (repo root). The harness
// index.html is guaranteed to exist; a missing path yields a real 404.
const origin = globalThis.location?.origin ?? 'http://localhost:8087';
const OK_URL = `${origin}/tests/browser/harness/index.html`;
const MISSING_URL = `${origin}/tests/browser/__http_nonexistent__.html`;

run({
    async HttpBrowserClientTest() {
        await describe('http.get — response event + status', async () => {
            await it('resolves a 200 with a status message and headers', async () => {
                const res = await new Promise<IncomingMessage>((resolve, reject) => {
                    const req = get(OK_URL, resolve);
                    req.on('error', reject);
                });
                expect(res.statusCode).toBe(200);
                expect(typeof res.statusMessage).toBe('string');
                // fetch always exposes content-type for a served HTML file.
                expect(typeof res.headers['content-type']).toBe('string');
            });
        });

        await describe('IncomingMessage — flowing-mode data/end', async () => {
            await it("concatenates 'data' chunks and fires 'end'", async () => {
                const body = await new Promise<string>((resolve, reject) => {
                    get(OK_URL, (res) => {
                        const chunks: Uint8Array[] = [];
                        res.on('data', (c: unknown) => chunks.push(c as Uint8Array));
                        res.on('end', () => {
                            const total = chunks.reduce((n, c) => n + c.length, 0);
                            const merged = new Uint8Array(total);
                            let off = 0;
                            for (const c of chunks) { merged.set(c, off); off += c.length; }
                            resolve(new TextDecoder().decode(merged));
                        });
                        res.on('error', reject);
                    });
                });
                expect(body).toContain('<!DOCTYPE html>');
            });
        });

        await describe('IncomingMessage — setEncoding decodes to string', async () => {
            await it("emits string chunks after setEncoding('utf8')", async () => {
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
        });

        await describe('IncomingMessage — async iteration', async () => {
            await it('yields body chunks via for-await', async () => {
                const res = await new Promise<IncomingMessage>((resolve, reject) => {
                    const req = get(OK_URL, resolve);
                    req.on('error', reject);
                });
                let bytes = 0;
                for await (const chunk of res) {
                    bytes += (chunk as Uint8Array).length;
                }
                expect(bytes).toBeGreaterThan(0);
            });
        });

        await describe('http.request — non-existent path is a 404', async () => {
            await it('reports statusCode 404', async () => {
                const res = await new Promise<IncomingMessage>((resolve, reject) => {
                    const req = request(MISSING_URL, resolve);
                    req.on('error', reject);
                    req.end();
                });
                expect(res.statusCode).toBe(404);
            });
        });

        await describe('http.request — write body before end', async () => {
            await it('accepts a written body and still resolves a response', async () => {
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
        });

        await describe('http.createServer — ENOTSUP in the browser', async () => {
            await it('throws a structured ENOTSUP error', async () => {
                let code: string | undefined;
                try {
                    createServer();
                } catch (err) {
                    code = (err as { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });
        });

        await describe('default export shape', async () => {
            await it('exposes request/get/createServer', async () => {
                expect(typeof http.request).toBe('function');
                expect(typeof http.get).toBe('function');
                expect(typeof http.createServer).toBe('function');
            });
        });
    },
});
