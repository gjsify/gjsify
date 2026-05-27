// Registers: fetch, Headers, Request, Response

import fetch, { Headers, Request, Response } from '../index.js';

/** Module-local typed view of the globals this file writes. */
interface _FetchGlobals {
    fetch?: typeof fetch;
    Headers?: typeof Headers;
    Request?: typeof Request;
    Response?: typeof Response;
}

const g = globalThis as unknown as _FetchGlobals;

if (typeof globalThis.fetch === 'undefined') {
    g.fetch = fetch;
}
if (typeof globalThis.Headers === 'undefined') {
    g.Headers = Headers;
}
if (typeof globalThis.Request === 'undefined') {
    g.Request = Request;
}
if (typeof globalThis.Response === 'undefined') {
    g.Response = Response;
}
