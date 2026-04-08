// Side-effect module: registers fetch/Headers/Request/Response as globals on
// GJS. On Node.js the alias layer routes this to @gjsify/empty — the native
// globals are fully functional there.

import fetch, { Headers, Request, Response } from './index.js';

const _isGJS = typeof (globalThis as any).imports !== 'undefined';
if (_isGJS) {
  (globalThis as any).fetch = fetch;
  (globalThis as any).Headers = Headers;
  (globalThis as any).Request = Request;
  (globalThis as any).Response = Response;
}
