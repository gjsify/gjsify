// Integration-test entry for @gjsify/integration-socket.io.
// Builds once per runtime (gjs/node) via `gjsify build src/test.mts`.

import '@gjsify/node-globals/register';
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
