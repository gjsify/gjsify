// Node.js https module for GJS
// Thin wrapper — Soup.Session handles HTTPS natively via GnuTLS.
// Reference: Node.js lib/https.js

import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest, get as httpGet, Server as HttpServer } from 'node:http';
import { TLSSocket, createSecureContext } from 'node:tls';
import { URL } from 'node:url';

export { TLSSocket, createSecureContext };

export interface RequestOptions {
    protocol?: string;
    hostname?: string;
    host?: string;
    port?: number | string;
    path?: string;
    method?: string;
    headers?: Record<string, string | number | string[]>;
    timeout?: number;
    agent?: unknown;
    setHost?: boolean;
    ca?: string | Buffer | Array<string | Buffer>;
    cert?: string | Buffer | Array<string | Buffer>;
    key?: string | Buffer | Array<string | Buffer>;
    rejectUnauthorized?: boolean;
}

/**
 * HTTPS Agent for connection pooling (stub — Soup.Session handles TLS internally).
 */
export class Agent {
    defaultPort = 443;
    protocol = 'https:';
    maxSockets = Infinity;
    maxFreeSockets = 256;

    constructor(_options?: Record<string, unknown>) {}

    destroy(): void {}
}

export const globalAgent = new Agent();

/**
 * Make an HTTPS request.
 * Soup.Session handles TLS natively — we just ensure protocol is https:.
 */
export function request(
    url: string | URL | RequestOptions,
    options?: RequestOptions | ((res: IncomingMessage) => void),
    callback?: (res: IncomingMessage) => void,
): ClientRequest {
    if (typeof url === 'string') {
        if (url.startsWith('https://') || url.startsWith('http://')) {
            return httpRequest(url, options as unknown as Record<string, unknown>, callback);
        }
        const opts: RequestOptions = { hostname: url, protocol: 'https:', port: 443 };
        if (typeof options === 'object') Object.assign(opts, options);
        if (typeof options === 'function') callback = options;
        return httpRequest(opts as unknown as Record<string, unknown>, callback);
    }

    if (url instanceof URL) {
        return httpRequest(url, options as unknown as Record<string, unknown>, callback);
    }

    // url is RequestOptions
    const opts = { protocol: 'https:', port: 443, ...url };
    if (typeof options === 'function') callback = options;
    return httpRequest(opts as unknown as Record<string, unknown>, callback);
}

/**
 * Make an HTTPS GET request (convenience wrapper).
 */
export function get(
    url: string | URL | RequestOptions,
    options?: RequestOptions | ((res: IncomingMessage) => void),
    callback?: (res: IncomingMessage) => void,
): ClientRequest {
    if (typeof url === 'string') {
        if (url.startsWith('https://') || url.startsWith('http://')) {
            return httpGet(url, options as unknown as Record<string, unknown>, callback) as ClientRequest;
        }
        const opts: RequestOptions = { hostname: url, protocol: 'https:', port: 443 };
        if (typeof options === 'object') Object.assign(opts, options);
        if (typeof options === 'function') callback = options;
        return httpGet(opts as unknown as Record<string, unknown>, callback) as ClientRequest;
    }

    if (url instanceof URL) {
        return httpGet(url, options as unknown as Record<string, unknown>, callback) as ClientRequest;
    }

    const opts = { protocol: 'https:', port: 443, ...url, method: 'GET' };
    if (typeof options === 'function') callback = options;
    return httpGet(opts as unknown as Record<string, unknown>, callback) as ClientRequest;
}

export interface HttpsServerOptions extends RequestOptions {
    requestCert?: boolean;
}

type HttpsRequestListener = (req: IncomingMessage, res: ServerResponse) => void;

/** @gjsify/http's hand-off for https — see `_useTls` in its server.ts. */
interface TlsHandOff {
    _useTls(options: HttpsServerOptions): void;
}

/**
 * HTTPS Server — an http.Server whose listener terminates TLS with `options.key`/`options.cert`.
 * Reference: Node.js lib/https.js. The Gio side (certificate, client-certificate verification,
 * the HTTPS listener) lives in @gjsify/http, so this package stays a layer over `node:http`.
 */
export class Server extends HttpServer {
    constructor(options?: HttpsServerOptions, requestListener?: HttpsRequestListener);
    constructor(requestListener?: HttpsRequestListener);
    constructor(optionsOrListener?: HttpsServerOptions | HttpsRequestListener, requestListener?: HttpsRequestListener) {
        const options = typeof optionsOrListener === 'function' ? {} : (optionsOrListener ?? {});
        super(typeof optionsOrListener === 'function' ? optionsOrListener : requestListener);
        (this as unknown as TlsHandOff)._useTls(options);
    }
}

/**
 * Create an HTTPS server that presents `options.key`/`options.cert`.
 */
export function createServer(options?: HttpsServerOptions, requestListener?: HttpsRequestListener): Server;
export function createServer(requestListener?: HttpsRequestListener): Server;
export function createServer(
    optionsOrListener?: HttpsServerOptions | HttpsRequestListener,
    requestListener?: HttpsRequestListener,
): Server {
    if (typeof optionsOrListener === 'function') return new Server(optionsOrListener);
    return new Server(optionsOrListener, requestListener);
}

export default {
    Agent,
    globalAgent,
    Server,
    request,
    get,
    createServer,
    TLSSocket,
    createSecureContext,
};
