// Node.js https module for GJS
// Thin wrapper — Soup.Session handles HTTPS natively via GnuTLS.
// Reference: Node.js lib/https.js

import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import {
    request as httpRequest,
    Server as HttpServer,
    Agent as HttpAgent,
    type AgentOptions as HttpAgentOptions,
} from 'node:http';
import { TLSSocket, createSecureContext, type PeerCertificate, type SecureContext } from 'node:tls';
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
    passphrase?: string;
    rejectUnauthorized?: boolean;
    servername?: string;
    checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
    secureContext?: SecureContext;
}

export type AgentOptions = HttpAgentOptions &
    Pick<
        RequestOptions,
        | 'ca'
        | 'cert'
        | 'key'
        | 'passphrase'
        | 'rejectUnauthorized'
        | 'servername'
        | 'checkServerIdentity'
        | 'secureContext'
    >;

/**
 * HTTPS Agent. Pooling is Soup.Session's; what the agent contributes is its TLS options
 * (`ca`, `cert`/`key`, `rejectUnauthorized`, …), which override each request's, as in Node.
 */
export class Agent extends HttpAgent {
    defaultPort = 443;
    protocol = 'https:';

    constructor(options?: AgentOptions) {
        super(options);
    }
}

export const globalAgent = new Agent();

/** Node's https.request: an unset `agent` means `globalAgent` (ClientRequest's `_defaultAgent`). */
function withDefaultAgent(options: object | undefined): Record<string, unknown> {
    return { ...options, _defaultAgent: globalAgent };
}

/**
 * Make an HTTPS request.
 * Soup.Session handles TLS natively — we just ensure protocol is https:.
 */
export function request(
    url: string | URL | RequestOptions,
    options?: RequestOptions | ((res: IncomingMessage) => void),
    callback?: (res: IncomingMessage) => void,
): ClientRequest {
    if (typeof options === 'function') {
        callback = options;
        options = undefined;
    }
    if (typeof url === 'string') {
        if (url.startsWith('https://') || url.startsWith('http://')) {
            return httpRequest(url, withDefaultAgent(options), callback);
        }
        const opts: RequestOptions = { hostname: url, protocol: 'https:', port: 443, ...options };
        return httpRequest(withDefaultAgent(opts), callback);
    }

    if (url instanceof URL) {
        return httpRequest(url, withDefaultAgent(options), callback);
    }

    // url is RequestOptions
    return httpRequest(withDefaultAgent({ protocol: 'https:', port: 443, ...url, ...options }), callback);
}

/**
 * Make an HTTPS GET request (convenience wrapper).
 */
export function get(
    url: string | URL | RequestOptions,
    options?: RequestOptions | ((res: IncomingMessage) => void),
    callback?: (res: IncomingMessage) => void,
): ClientRequest {
    const req = request(url, options as RequestOptions | ((res: IncomingMessage) => void), callback);
    req.end();
    return req;
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
