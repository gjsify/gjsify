// @gjsify/ws — drop-in replacement for the `ws` npm package on Gjs.
//
// Wraps globalThis.WebSocket (provided by @gjsify/websocket over
// Soup.WebsocketConnection) for the CLIENT and Soup.Server.add_websocket_handler
// for the SERVER. Preserves the ws-npm module layout so bundlers see it as a
// drop-in replacement when aliased.
//
// Reference: refs/ws/index.js

import { WebSocket } from './websocket.js';
import { WebSocketServer } from './websocket-server.js';

// ws index.js does these in CommonJS — we replicate on the class so
// `new (require('ws'))(url)` and `const { WebSocket } = require('ws')` both
// work. esbuild's __toESM shim turns our ESM default into an object with
// these properties; aliasing + the gjs CJS-compat layer handles the rest.
(WebSocket as any).WebSocket = WebSocket;
(WebSocket as any).WebSocketServer = WebSocketServer;
(WebSocket as any).Server = WebSocketServer; // historical alias
// createWebSocketStream is the only remaining commonly-imported helper from
// ws/index.js we don't implement yet — adding a stub throws if invoked so
// consumers know to file an issue rather than debug a silent mis-pipe.
(WebSocket as any).createWebSocketStream = () => {
  throw new Error(
    '@gjsify/ws: createWebSocketStream is not yet implemented. ' +
    'File an issue at https://github.com/gjsify/gjsify if you need this API.',
  );
};

export { WebSocket, WebSocketServer };
export { WebSocketServer as Server };
export default WebSocket;
