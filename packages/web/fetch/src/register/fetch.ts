// Registers: fetch, Headers, Request, Response

import fetch, { Headers, Request, Response } from '../index.js';

if (typeof globalThis.fetch === 'undefined') {
  (globalThis as any).fetch = fetch;
}
if (typeof globalThis.Headers === 'undefined') {
  (globalThis as any).Headers = Headers;
}
if (typeof globalThis.Request === 'undefined') {
  (globalThis as any).Request = Request;
}
if (typeof globalThis.Response === 'undefined') {
  (globalThis as any).Response = Response;
}
