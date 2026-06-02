// Browser-target conformance spec for @gjsify/https.
//
// Imports the browser entry directly (`./browser.js`) — under `gjsify build
// --app browser` the bundler picks the same file via the `"browser"` export
// condition, so these assertions lock in the behaviour exercised in the
// Playwright/Firefox/SpiderMonkey suite.
//
// The browser https client builds on the `@gjsify/http` browser entry: a
// browser `fetch()` already negotiates TLS for `https://` URLs, so
// `https.request`/`https.get` differ from their http counterparts only in
// defaulting `protocol` to `https:` for an options object that omits one. The
// returned object is the same `ClientRequest` shape as http. Server paths
// cannot bind a TCP socket in a browser, so `Server`/`createServer` throw a
// structured `ENOTSUP`.
//
// Assertions deliberately never call `req.end()` (which would trigger a real
// `fetch`) — they only inspect the lazily-built `ClientRequest` shape.

import { describe, it, expect } from '@gjsify/unit';
import https, {
    request,
    get,
    Server,
    createServer,
    ClientRequest,
    Agent,
    globalHttpsAgent,
    METHODS,
    STATUS_CODES,
} from './browser.js';
import { request as httpRequest, ClientRequest as HttpClientRequest } from '@gjsify/http/browser';

export default async () => {
    await describe('https (browser)', async () => {
        // ==================== exports ====================
        await describe('exports', async () => {
            await it('should export request/get/createServer as functions', async () => {
                expect(typeof request).toBe('function');
                expect(typeof get).toBe('function');
                expect(typeof createServer).toBe('function');
            });

            await it('should re-export the http constants surface', async () => {
                expect(Array.isArray(METHODS)).toBe(true);
                expect(typeof STATUS_CODES).toBe('object');
                expect(typeof https.request).toBe('function');
                expect(typeof https.get).toBe('function');
            });

            await it('should expose a browser Agent stub', async () => {
                expect(typeof Agent).toBe('function');
                const agent = new Agent();
                expect(agent.keepAlive).toBe(false);
                expect(typeof agent.destroy).toBe('function');
                expect(globalHttpsAgent instanceof Agent).toBe(true);
            });
        });

        // ==================== request: defaults to https, http-consistent shape ====================
        await describe('request', async () => {
            await it('should return a ClientRequest for an options object', async () => {
                const req = request({ host: 'example.com', path: '/api', method: 'POST' });
                expect(req instanceof ClientRequest).toBe(true);
                expect(req.method).toBe('POST');
                expect(req.path).toBe('/api');
            });

            await it('should default GET method and root path like http', async () => {
                const req = request({ host: 'example.com' });
                expect(req.method).toBe('GET');
                expect(req.path).toBe('/');
            });

            await it('should accept a string URL and keep its own protocol', async () => {
                const req = request('https://example.com/path');
                expect(req instanceof ClientRequest).toBe(true);
                expect(req.path).toBe('/path');
            });

            await it('should produce the same ClientRequest shape as http.request', async () => {
                const httpsReq = request({ host: 'example.com', path: '/x' });
                const httpReq = httpRequest({ host: 'example.com', path: '/x' });
                // Same underlying class is re-exported from @gjsify/http.
                expect(ClientRequest === HttpClientRequest).toBe(true);
                expect(httpsReq.method).toBe(httpReq.method);
                expect(httpsReq.path).toBe(httpReq.path);
            });

            await it('should expose the http client request surface', async () => {
                const req = request({ host: 'example.com' });
                expect(typeof req.setHeader).toBe('function');
                expect(typeof req.getHeader).toBe('function');
                expect(typeof req.write).toBe('function');
                expect(typeof req.end).toBe('function');
                req.setHeader('x-test', 'v');
                expect(req.getHeader('x-test')).toBe('v');
                // Avoid triggering a real fetch — tear the request down unsent.
                req.destroy();
            });
        });

        // ==================== get: request + end shape ====================
        await describe('get', async () => {
            await it('should return a ClientRequest (request followed by end)', async () => {
                const req = get({ host: 'example.com', path: '/g' });
                expect(req instanceof ClientRequest).toBe(true);
                expect(req.method).toBe('GET');
                expect(req.path).toBe('/g');
                // get() already called end(); abort the in-flight request so the
                // background fetch is cancelled and no network call is awaited.
                req.abort();
            });
        });

        // ==================== ENOTSUP: server paths ====================
        await describe('server paths are ENOTSUP (no listening socket in a browser)', async () => {
            await it('should throw structured ENOTSUP from new Server()', async () => {
                let code: string | undefined;
                try {
                    new Server();
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should throw structured ENOTSUP from createServer()', async () => {
                let code: string | undefined;
                try {
                    createServer();
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });
        });
    });
};
