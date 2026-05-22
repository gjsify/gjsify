// Side-effect module: registers the W3C WebSocket constructor (and its
// MessageEvent / CloseEvent companions) on globalThis.
//
// Imported by the `--globals auto` detector via the GJS_GLOBALS_MAP entries
// for "WebSocket" / "MessageEvent" / "CloseEvent" (see
// packages/infra/resolve-npm/lib/globals-map.mjs). Also importable
// directly as `import '@gjsify/websocket/register'`.
//
// Follows the existence-guard pattern from AGENTS.md Rule 2: only register
// when the global is not already defined, so a consumer who polyfilled a
// different WebSocket implementation first wins.

import { WebSocket, MessageEvent, CloseEvent } from './index.js';

/** Module-local typed view of the globals this file writes. */
interface _WebSocketGlobals {
  WebSocket?: unknown;
  MessageEvent?: unknown;
  CloseEvent?: unknown;
}

const g = globalThis as unknown as _WebSocketGlobals;

if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = WebSocket;
}
if (typeof g.MessageEvent === 'undefined') {
  g.MessageEvent = MessageEvent;
}
if (typeof g.CloseEvent === 'undefined') {
  g.CloseEvent = CloseEvent;
}
