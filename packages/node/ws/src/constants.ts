// Constants shared between WebSocket and WebSocketServer.
// Values chosen to match the `ws` npm package where observable.

export const BINARY_TYPES = ['nodebuffer', 'arraybuffer', 'fragments'] as const;
export const EMPTY_BUFFER = new Uint8Array(0);

// WebSocket readyState values — identical to the W3C spec and `ws` npm pkg.
export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSING = 2;
export const CLOSED = 3;

/** Internal marker for native `globalThis.WebSocket` instances handed in via
 *  `{ socket }` option (not currently supported but reserved). */
export const kWebSocket = Symbol('ws:kWebSocket');
