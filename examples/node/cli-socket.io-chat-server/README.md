# cli-socket.io-chat-server

Classic Socket.IO chat server — runs on **GJS** and **Node.js**.

Adapted from the [official Socket.IO chat example](https://github.com/socketio/socket.io/tree/main/examples/chat).
Demonstrates Socket.IO over the **WebSocket transport** (with polling fallback) on GJS.

## Usage

```bash
yarn build

# GJS (GNOME JavaScript)
yarn start

# Node.js
yarn start:node
```

Then open **http://localhost:3000** in any browser. Multiple tabs share the same chat room.

## How it works

```
Browser                        GJS / Node.js process
  │                                │
  ├── GET /          ──────────►  http.Server (serves index.html)
  │                                │
  ├── POST /socket.io/?polling ►  Socket.IO polling handshake (EIO 4)
  │                                │
  └── GET  /socket.io/?websocket ► engine.io upgrade handler
                                   │  └─ wss.handleUpgrade() (@gjsify/ws Phase 3)
                                   │       └─ Soup.WebsocketConnection
                                   │
                              Socket.IO events: new message, add user,
                              typing, user joined/left
```

Engine.io uses `{ noServer: true }` + `handleUpgrade()` — the same pattern as the `net-ws-server` example. The browser client starts on polling, then upgrades to WebSocket automatically.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port to listen on |
