/**
 * Re-exports native WebSocket globals for use in Node.js builds.
 * On Node.js 22+, WebSocket/MessageEvent/CloseEvent are native globals.
 */
export const WebSocket = globalThis.WebSocket;
export const MessageEvent = globalThis.MessageEvent;
export const CloseEvent = globalThis.CloseEvent;
