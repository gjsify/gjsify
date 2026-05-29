// SPDX-License-Identifier: MIT
// Ported from npm undici tests — `test/request.js`, `test/client-request.js`
// in the upstream repo (excluded from the npm tarball) — re-derived against
// the documented public `undici.request()` API:
// https://github.com/nodejs/undici/blob/v7.x/docs/docs/api/Dispatcher.md#dispatcherrequestoptions-callback
// Original: Copyright (c) Matteo Collina + undici contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { request } from 'undici';
import { Buffer } from 'node:buffer';
import { startServer, respondJson, respondText, type TestServer } from './server.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export default async () => {
    await describe('undici.request() — status codes, headers, body streaming', async () => {
        let server: TestServer;
        server = await startServer({
            'GET /text': (_req, res) => respondText(res, 200, 'plain'),
            'GET /json': (_req, res) => respondJson(res, 200, { v: 1 }),
            'GET /status/204': (_req, res) => {
                res.statusCode = 204;
                res.end();
            },
            'GET /status/301': (_req, res) => {
                res.statusCode = 301;
                res.setHeader('location', '/text');
                res.end();
            },
            'GET /status/404': (_req, res) => respondText(res, 404, 'absent'),
            'GET /status/500': (_req, res) => respondText(res, 500, 'broken'),
            'POST /echo': (_req, res, body) => {
                res.statusCode = 200;
                res.setHeader('content-type', 'application/octet-stream');
                res.end(body);
            },
            'GET /large': (_req, res) => {
                // Stream ~64 KiB so the body has to come through in multiple data events.
                res.statusCode = 200;
                res.setHeader('content-type', 'application/octet-stream');
                const chunk = 'A'.repeat(1024);
                for (let i = 0; i < 64; i++) {
                    res.write(chunk);
                }
                res.end();
            },
            'GET /multi-header': (_req: IncomingMessage, res: ServerResponse) => {
                res.statusCode = 200;
                res.setHeader('content-type', 'text/plain');
                res.setHeader('x-custom-a', 'a');
                res.setHeader('x-custom-b', 'b');
                res.end('ok');
            },
        });

        await it('GET — statusCode 200 and body.text() string', async () => {
            const { statusCode, body } = await request(`${server.url}/text`);
            expect(statusCode).toBe(200);
            expect(await body.text()).toBe('plain');
        });

        await it('GET — body.json() parses JSON response', async () => {
            const { statusCode, body } = await request(`${server.url}/json`);
            expect(statusCode).toBe(200);
            expect(await body.json()).toStrictEqual({ v: 1 });
        });

        await it('GET — 204 No Content, empty body', async () => {
            const { statusCode, body } = await request(`${server.url}/status/204`);
            expect(statusCode).toBe(204);
            expect(await body.text()).toBe('');
        });

        await it('GET — 301 Moved Permanently is surfaced (no auto-follow by default)', async () => {
            const { statusCode, headers, body } = await request(`${server.url}/status/301`);
            // Without an explicit redirect handler, request() returns the
            // raw 3xx; the Location header is preserved for the caller.
            expect(statusCode).toBe(301);
            expect(String(headers.location ?? '')).toBe('/text');
            // Drain so the socket can return to the pool.
            await body.text();
        });

        await it('GET — 404 surfaces in statusCode (no throw)', async () => {
            const { statusCode, body } = await request(`${server.url}/status/404`);
            expect(statusCode).toBe(404);
            expect(await body.text()).toBe('absent');
        });

        await it('GET — 500 surfaces in statusCode (no throw)', async () => {
            const { statusCode, body } = await request(`${server.url}/status/500`);
            expect(statusCode).toBe(500);
            expect(await body.text()).toBe('broken');
        });

        await it('GET — response headers object has lowercase keys', async () => {
            const { headers, body } = await request(`${server.url}/multi-header`);
            expect(String(headers['x-custom-a'])).toBe('a');
            expect(String(headers['x-custom-b'])).toBe('b');
            expect(String(headers['content-type'] ?? '')).toContain('text/plain');
            await body.text();
        });

        await it('POST — body is sent and echoed back', async () => {
            const payload = 'send-me-please';
            const { statusCode, body } = await request(`${server.url}/echo`, {
                method: 'POST',
                body: payload,
            });
            expect(statusCode).toBe(200);
            expect(await body.text()).toBe(payload);
            const recorded = server.lastRequest();
            expect(recorded?.method).toBe('POST');
            expect(recorded?.body).toBe(payload);
        });

        await it('POST — Buffer body round-trips intact', async () => {
            const buf = Buffer.from([10, 20, 30, 40, 50]);
            const { statusCode, body } = await request(`${server.url}/echo`, {
                method: 'POST',
                body: buf,
            });
            expect(statusCode).toBe(200);
            const arr = new Uint8Array(await body.arrayBuffer());
            expect(Array.from(arr)).toStrictEqual([10, 20, 30, 40, 50]);
        });

        await it('GET — body streams 64 KiB without truncation', async () => {
            const { statusCode, body } = await request(`${server.url}/large`);
            expect(statusCode).toBe(200);
            const text = await body.text();
            expect(text.length).toBe(64 * 1024);
            // Spot-check first + last characters
            expect(text[0]).toBe('A');
            expect(text[text.length - 1]).toBe('A');
        });

        await it('GET — async iterator drains body chunk by chunk', async () => {
            const { statusCode, body } = await request(`${server.url}/large`);
            expect(statusCode).toBe(200);
            let total = 0;
            for await (const chunk of body) {
                total += (chunk as Uint8Array | Buffer).length;
            }
            expect(total).toBe(64 * 1024);
        });

        await it('GET — body.bytes() returns Uint8Array', async () => {
            const { statusCode, body } = await request(`${server.url}/text`);
            expect(statusCode).toBe(200);
            const bytes = await body.bytes();
            expect(bytes).toBeTruthy();
            expect(bytes instanceof Uint8Array).toBe(true);
            expect(new TextDecoder().decode(bytes)).toBe('plain');
        });

        await it('teardown — server closes cleanly', async () => {
            await server.close();
            expect(true).toBe(true);
        });
    });
};
