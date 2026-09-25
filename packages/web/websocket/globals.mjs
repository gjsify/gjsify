/**
 * Re-exports native WebSocket globals for use in Node.js builds.
 * On Node.js 22+, WebSocket/MessageEvent/CloseEvent are native globals.
 */
export const WebSocket = globalThis.WebSocket;
export const MessageEvent = globalThis.MessageEvent;
export const CloseEvent = globalThis.CloseEvent;

// The internal hook @gjsify/ws reads (src/abort.ts). Symbol.for() yields the
// same key; a host WebSocket carries no method under it, so ws falls back to
// the W3C calls. No Soup here, so no Soup transport error either.
export const kClose = Symbol.for('gjsify.websocket.close');
export const isTransportFailure = () => false;
