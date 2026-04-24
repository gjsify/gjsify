# cli-socket.io-pingpong

Socket.IO ping-pong round-trip demo — server **and** client run in the **same GJS / Node.js process**.

Demonstrates Socket.IO over the **WebSocket transport** (with polling fallback), with both sides managed in one script.

## Usage

```bash
yarn build

# GJS (GNOME JavaScript)
yarn start

# Node.js
yarn start:node
```

Expected output:

```
[server] listening on port <random>

[server] client connected   id=…
[client] connected   id=…

[server] roundtrip #1
[client] roundtrip #1 complete   latency=Xms
…
[client] 5 roundtrips complete — shutting down
[client] disconnected reason=io client disconnect
[server] client disconnected reason=server shutting down
```

## How it works

```
Same process
  ┌─────────────────────────────────────────┐
  │  http.Server (random port)              │
  │    │                                    │
  │    ├── Socket.IO Server (engine.io)     │
  │    │     noServer + handleUpgrade ──►  @gjsify/ws WebSocketServer (Phase 3)
  │    │                                    │
  │    └── Socket.IO Client (engine.io-client)
  │          polls → upgrades to WebSocket  │
  │          via @gjsify/ws WebSocket ──────┘
  └─────────────────────────────────────────┘
```

The client connects via polling first, then engine.io upgrades the connection to WebSocket automatically. After 5 round-trips the client disconnects and both server and http.Server shut down cleanly.
