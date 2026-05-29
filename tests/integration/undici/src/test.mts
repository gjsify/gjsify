// Integration-test entry for @gjsify/integration-undici.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// undici is the npm HTTP client every Node consumer uses — Node's own
// `globalThis.fetch` is undici under the hood since Node 18. Exercising
// `undici.fetch` / `undici.request` / `undici.WebSocket` against a local
// `node:http`-backed server validates @gjsify/{http,websocket,fetch}'s
// outgoing HTTP surface (Soup-backed under GJS) end-to-end via the same
// npm package every consumer ships with.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced (timers, process,
// WebSocket here).

import { run } from '@gjsify/unit';
import fetchBasicSuite from './fetch-basic.spec.js';
import requestSuite from './request.spec.js';
import websocketSuite from './websocket.spec.js';

run({
    fetchBasicSuite,
    requestSuite,
    websocketSuite,
});
