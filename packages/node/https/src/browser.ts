// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by https-browserify
// (James Halliday, MIT).
//
// Reference: refs/stream-http/index.js (the HTTPS path piggy-backs on stream-http
// in browserify-land; same shape applies here — `https` is HTTP with a `protocol:
// 'https:'` default).
//
// This module builds on the @gjsify/http browser entry. Browser `fetch()`
// already negotiates TLS for `https://` URLs transparently, so no additional
// TLS-specific code is needed — `https.request`/`https.get` differ from their
// `http` counterparts only in defaulting `protocol` to `https:` when the
// caller passes an options object without one (matching Node's
// `lib/https.js`). Slot: browser:"partial" (client native via fetch, server
// throws ENOTSUP).

import {
    METHODS,
    STATUS_CODES,
    maxHeaderSize,
    globalAgent,
    IncomingMessage,
    ClientRequest,
    Server,
    ServerResponse,
    OutgoingMessage,
    createServer,
    request as httpRequest,
    validateHeaderName,
    validateHeaderValue,
    setMaxIdleHTTPParsers,
} from '@gjsify/http/browser';
import type { RequestOptions } from '@gjsify/http/browser';

import httpDefault from '@gjsify/http/browser';

export {
    METHODS,
    STATUS_CODES,
    maxHeaderSize,
    globalAgent,
    IncomingMessage,
    ClientRequest,
    Server,
    ServerResponse,
    OutgoingMessage,
    createServer,
    validateHeaderName,
    validateHeaderValue,
    setMaxIdleHTTPParsers,
};

export type { RequestOptions };

/**
 * Browser `https.Agent` stub — there is no real socket pool in the browser, so
 * we surface a minimal shape that satisfies typical consumer-code probes (e.g.
 * `agent.keepAlive`) without throwing on construction.
 */
export class Agent {
    keepAlive = false;
    keepAliveMsecs = 1000;
    maxSockets = Infinity;
    maxFreeSockets = 256;
    sockets: Record<string, unknown[]> = {};
    freeSockets: Record<string, unknown[]> = {};
    requests: Record<string, unknown[]> = {};
    destroy(): void {}
}

export const globalHttpsAgent = new Agent();

/**
 * `https.request` — identical to `http.request` over the browser `fetch()`
 * client, except that an options object without an explicit `protocol`
 * defaults to `https:` (Node `lib/https.js`). A string/`URL` argument already
 * carries its own protocol, so it is forwarded unchanged.
 */
export function request(
    urlOrOptions: string | URL | RequestOptions,
    optsOrCb?: RequestOptions | ((res: IncomingMessage) => void),
    maybeCb?: (res: IncomingMessage) => void,
): ClientRequest {
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
        // String/URL keeps its own protocol; the trailing options object (if
        // any) is where a caller could still pin a protocol, so default it.
        if (typeof optsOrCb === 'object' && optsOrCb !== null) {
            return httpRequest(urlOrOptions, { protocol: 'https:', ...optsOrCb }, maybeCb);
        }
        return httpRequest(urlOrOptions, optsOrCb, maybeCb);
    }
    return httpRequest(
        { protocol: 'https:', ...urlOrOptions },
        optsOrCb as ((res: IncomingMessage) => void) | undefined,
    );
}

/** `https.get` — `https.request` followed by `req.end()` (no request body). */
export function get(
    urlOrOptions: string | URL | RequestOptions,
    optsOrCb?: RequestOptions | ((res: IncomingMessage) => void),
    maybeCb?: (res: IncomingMessage) => void,
): ClientRequest {
    const req = request(urlOrOptions, optsOrCb, maybeCb);
    req.end();
    return req;
}

const httpsDefault = {
    ...httpDefault,
    Agent,
    globalAgent: globalHttpsAgent,
    request,
    get,
};

export default httpsDefault;
