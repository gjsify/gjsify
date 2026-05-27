// Integration-test entry for @gjsify/integration-socket.io.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.
//
// No explicit `@gjsify/node-globals/register` — `gjsify build` defaults to
// `--globals auto`, scanning the bundled output and injecting only the
// granular /register subpaths actually referenced.

import { run } from '@gjsify/unit';
import handshakeSuite from './handshake.spec.js';
import socketMiddlewareSuite from './socket-middleware.spec.js';
import socketTimeoutSuite from './socket-timeout.spec.js';
import socketSuite from './socket.spec.js';
import namespacesSuite from './namespaces.spec.js';

run({
    handshakeSuite,
    socketMiddlewareSuite,
    socketTimeoutSuite,
    socketSuite,
    namespacesSuite,
});
