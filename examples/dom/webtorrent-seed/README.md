# WebTorrent Seed + Download Demo

Tests `@gjsify/webrtc` data channels via a real P2P torrent transfer in a single GJS process.

## How it works

1. **Client A (seeder)** seeds a small text buffer as a torrent
2. **Client B (leecher)** adds the magnet URI and downloads via WebRTC
3. Both clients communicate through `RTCPeerConnection` + `RTCDataChannel` (provided by `@gjsify/webrtc`, backed by GStreamer webrtcbin)

## Prerequisites

- GStreamer >= 1.20 with `gst-plugins-bad` + `libnice-gstreamer1`
- Network access to WebSocket tracker (`wss://tracker.webtorrent.dev`)

## Build & Run

```bash
yarn build:gjs && yarn postbuild:gjs
yarn start:gjs
```

## Current Status

- WebTorrent initializes and detects WebRTC support (`WEBRTC_SUPPORT: true`)
- Torrent seeding works (metadata hashing, ready event)
- **Blocker:** The `ws` npm module detects GJS as a browser environment and refuses to create WebSocket connections — needs an esbuild alias from `ws` to `@gjsify/websocket` or the native `WebSocket` API

## Known Issues

- **CJS-ESM interop:** The `bitfield` npm package has a double-default wrapping issue with esbuild's `__toESM` in node mode. The `postbuild:gjs` script patches this.
- **`ws` browser detection:** WebTorrent uses the `ws` module for tracker connections. In GJS (which exposes `window`), `ws` thinks it's in a browser and throws. The tracker client needs to use the native `WebSocket` API instead.
