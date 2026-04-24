# net-ws-server

Authenticated WebSocket chat server using the [`ws`](https://github.com/websockets/ws) npm package — runs on **GJS** and **Node.js**.

Demonstrates the server-side features in `@gjsify/ws`:

| Feature | What it does |
|---|---|
| `{ noServer: true }` + `handleUpgrade()` | `http.Server` owns the port; `WebSocketServer` routes `/ws` upgrades manually — the standard pattern used by engine.io and socket.io |
| `verifyClient` | Rejects connections without `?token=gjsify` with HTTP 401 before the handshake |
| `handleProtocols` | Negotiates the `chat.v1` subprotocol; client-side `ws.protocol` reflects the selection |
| `'headers'` event | Injects `X-Server: gjsify` and the current client count into the 101 response |

## Usage

```bash
yarn build

# GJS (GNOME JavaScript)
yarn start

# Node.js
yarn start:node
```

Then open **http://localhost:3001** in a browser for the interactive chat UI, or connect with any WebSocket client:

```bash
# wscat (npm install -g wscat)
wscat -c "ws://localhost:3001/ws?token=gjsify&nick=alice" -s chat.v1

# Wrong token → HTTP 401
wscat -c "ws://localhost:3001/ws?token=wrong&nick=hacker"

# No subprotocol → connected, ws.protocol = ""
wscat -c "ws://localhost:3001/ws?token=gjsify&nick=bob"
```

REST endpoints:

```
GET /              Browser chat UI
GET /api/status    { "clients": <n>, "path": "/ws" }
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | TCP port to listen on |
| `TOKEN` | `gjsify` | Required token in `?token=` query param |

## How it works

```
http.Server  ──── GET /         ──► serves index.html
             ──── GET /api/*    ──► JSON status
             ──── upgrade event ──► WebSocketServer.handleUpgrade()
                                        │
                                        ├─ verifyClient(?token=)
                                        ├─ handleProtocols(chat.v1)
                                        ├─ emit 'headers' (X-Server, X-WS-Clients)
                                        └─ write 101 → Soup.WebsocketConnection (GJS)
                                                      → ws.WebSocket (Node.js)
```

The `{ noServer: true }` pattern keeps the HTTP server and WebSocket server decoupled: the HTTP server owns the TCP socket and the WebSocket server handles only the upgrade negotiation. This is identical to how engine.io and socket.io attach to an existing Express / Koa server.
