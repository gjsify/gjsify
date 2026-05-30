// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by https-browserify
// (James Halliday, MIT).
//
// Reference: refs/stream-http/index.js (the HTTPS path piggy-backs on stream-http
// in browserify-land; same shape applies here — `https` is HTTP with a `protocol:
// 'https:'` default).
//
// This module re-exports the @gjsify/http browser entry. Browser `fetch()`
// already negotiates TLS for `https://` URLs transparently, so no additional
// TLS-specific code is needed. Slot: browser:"partial" (client native via
// fetch, server throws ENOTSUP).

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
    request,
    get,
    validateHeaderName,
    validateHeaderValue,
    setMaxIdleHTTPParsers,
} from '@gjsify/http/browser';

import httpDefault from '@gjsify/http/browser';

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

const httpsDefault = { ...httpDefault, Agent, globalAgent: globalHttpsAgent };

export default httpsDefault;
