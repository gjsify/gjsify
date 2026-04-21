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

if (typeof (globalThis as any).WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}
if (typeof (globalThis as any).MessageEvent === 'undefined') {
  (globalThis as any).MessageEvent = MessageEvent;
}
if (typeof (globalThis as any).CloseEvent === 'undefined') {
  (globalThis as any).CloseEvent = CloseEvent;
}
