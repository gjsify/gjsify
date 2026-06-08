# @gjsify/ws

Drop-in implementation of the npm `ws` WebSocket library for GJS, built on `@gjsify/websocket` (Soup.WebsocketConnection) for the client side and `Soup.Server` for `WebSocketServer`. Aliases both `ws` and `isomorphic-ws` so existing npm packages that depend on either resolve to this implementation automatically when bundled for GJS.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/ws

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/ws
yarn add @gjsify/ws
```

## Usage

```typescript
import WebSocket, { WebSocketServer } from '@gjsify/ws';

// Client
const ws = new WebSocket('wss://echo.websocket.org');
ws.on('open', () => ws.send('hello'));
ws.on('message', (data) => console.log('received:', data));

// Server
const wss = new WebSocketServer({ port: 8080 });
wss.on('connection', (client) => {
    client.on('message', (msg) => client.send(`echo: ${msg}`));
});
```

`WebSocketServer` supports `{ port }`, `{ server }` shared-port, and `{ noServer: true }` + `handleUpgrade()` modes, as well as `verifyClient`, `handleProtocols`, and `createWebSocketStream` (Duplex bridge). Validated against the Autobahn test suite: 510 OK / 4 NON-STRICT / 3 INFO / 0 FAILED.

## License

MIT
