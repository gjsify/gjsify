// SPDX-License-Identifier: MIT
// Ported from npm undici tests — the suite at the npm package's `test/fetch/`
// directory is the canonical reference for `undici.fetch()` behavior (the
// npm tarball ships only `lib/` + `index.js`, not the test directory, so the
// upstream cases are re-derived from
// https://github.com/nodejs/undici/blob/v7.x/test/fetch/ — `fetch.js`,
// `request.js`, `response.js` — against the same public API).
// Original: Copyright (c) Matteo Collina + undici contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { fetch } from 'undici';
import { startServer, respondJson, respondText, type TestServer } from './server.js';
import type { ServerResponse, IncomingMessage } from 'node:http';

export default async () => {
    await describe('undici.fetch() — basic verbs + headers + body shapes', async () => {
        let server: TestServer;

        // Set up a single multi-route server for the whole describe block.
        server = await startServer({
            'GET /text': (_req, res) => respondText(res, 200, 'hello world'),
            'GET /json': (_req, res) => respondJson(res, 200, { ok: true, n: 42 }),
            'GET /status/404': (_req, res) => respondText(res, 404, 'gone'),
            'GET /status/500': (_req, res) => respondText(res, 500, 'boom'),
            'GET /headers': (req: IncomingMessage, res: ServerResponse) => {
                res.statusCode = 200;
                res.setHeader('content-type', 'application/json');
                res.setHeader('x-echo-ua', String(req.headers['user-agent'] ?? ''));
                res.setHeader('x-echo-custom', String(req.headers['x-custom'] ?? ''));
                res.end(JSON.stringify({ method: req.method }));
            },
            'POST /echo': (_req, res, body) => {
                res.statusCode = 200;
                res.setHeader('content-type', 'application/octet-stream');
                res.end(body);
            },
            'PUT /echo': (_req, res, body) => {
                res.statusCode = 200;
                res.setHeader('content-type', 'application/octet-stream');
                res.end(body);
            },
            'DELETE /resource': (_req, res) => {
                res.statusCode = 204;
                res.end();
            },
            'GET /bytes': (_req, res) => {
                res.statusCode = 200;
                res.setHeader('content-type', 'application/octet-stream');
                res.end(Buffer.from([0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255]));
            },
        });

        await it('GET returns 200 + text body via response.text()', async () => {
            const r = await fetch(`${server.url}/text`);
            expect(r.status).toBe(200);
            expect(r.ok).toBe(true);
            expect(await r.text()).toBe('hello world');
        });

        await it('GET returns parseable JSON via response.json()', async () => {
            const r = await fetch(`${server.url}/json`);
            expect(r.status).toBe(200);
            expect(r.headers.get('content-type')).toBe('application/json');
            const body = await r.json();
            expect(body).toStrictEqual({ ok: true, n: 42 });
        });

        await it('GET 404 — response.ok is false, status code surfaced', async () => {
            const r = await fetch(`${server.url}/status/404`);
            expect(r.status).toBe(404);
            expect(r.ok).toBe(false);
            expect(await r.text()).toBe('gone');
        });

        await it('GET 500 — does not reject, surfaces server error', async () => {
            const r = await fetch(`${server.url}/status/500`);
            expect(r.status).toBe(500);
            expect(r.ok).toBe(false);
            expect(await r.text()).toBe('boom');
        });

        await it('custom request headers reach the server (case-insensitive)', async () => {
            const r = await fetch(`${server.url}/headers`, {
                headers: { 'x-custom': 'gjsify' },
            });
            expect(r.status).toBe(200);
            expect(r.headers.get('x-echo-custom')).toBe('gjsify');
        });

        await it('POST with string body — echoed back as bytes', async () => {
            const payload = 'hello, undici';
            const r = await fetch(`${server.url}/echo`, {
                method: 'POST',
                body: payload,
            });
            expect(r.status).toBe(200);
            expect(await r.text()).toBe(payload);

            const recorded = server.lastRequest();
            expect(recorded?.method).toBe('POST');
            expect(recorded?.body).toBe(payload);
        });

        await it('POST with JSON body + explicit content-type', async () => {
            const payload = { x: 1, y: 'two', z: [true, null] };
            const r = await fetch(`${server.url}/echo`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            });
            expect(r.status).toBe(200);
            expect(await r.text()).toBe(JSON.stringify(payload));

            const recorded = server.lastRequest();
            expect(recorded?.headers['content-type']).toBe('application/json');
            expect(JSON.parse(recorded?.body ?? 'null')).toStrictEqual(payload);
        });

        await it('PUT with Uint8Array body — round-tripped intact', async () => {
            const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
            const r = await fetch(`${server.url}/echo`, {
                method: 'PUT',
                body: bytes,
            });
            expect(r.status).toBe(200);
            const ab = await r.arrayBuffer();
            expect(new Uint8Array(ab)).toStrictEqual(bytes);
        });

        await it('DELETE returns 204, body is empty', async () => {
            const r = await fetch(`${server.url}/resource`, { method: 'DELETE' });
            expect(r.status).toBe(204);
            expect(await r.text()).toBe('');
        });

        await it('response.arrayBuffer() preserves binary bytes', async () => {
            const r = await fetch(`${server.url}/bytes`);
            expect(r.status).toBe(200);
            const ab = await r.arrayBuffer();
            const bytes = new Uint8Array(ab);
            expect(bytes.length).toBe(11);
            expect(Array.from(bytes)).toStrictEqual([0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255]);
        });

        await it('response.headers exposes Headers-like getter', async () => {
            const r = await fetch(`${server.url}/json`);
            // Headers object — case-insensitive .get() per fetch spec.
            expect(r.headers.get('content-type')).toBe('application/json');
            expect(r.headers.get('Content-Type')).toBe('application/json');
            expect(r.headers.has('content-type')).toBe(true);
            await r.text();
        });

        await it('AbortController aborts an in-flight fetch', async () => {
            const slow = await startServer({
                'GET /slow': (_req, res) => {
                    // Never respond — let abort bite. We close the server in finally.
                    setTimeout(() => {
                        if (!res.headersSent) {
                            res.statusCode = 200;
                            res.end('late');
                        }
                    }, 5000);
                },
            });
            try {
                const ac = new AbortController();
                const p = fetch(`${slow.url}/slow`, { signal: ac.signal });
                setTimeout(() => ac.abort(), 50);
                let rejected = false;
                try {
                    await p;
                } catch (err) {
                    rejected = true;
                    expect((err as Error).name).toBe('AbortError');
                }
                expect(rejected).toBe(true);
            } finally {
                await slow.close();
            }
        });

        // Final teardown for the shared server.
        await it('teardown — server closes cleanly', async () => {
            await server.close();
            expect(true).toBe(true);
        });
    });
};
