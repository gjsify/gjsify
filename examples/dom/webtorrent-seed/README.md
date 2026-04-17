# WebTorrent Seed + Download

P2P torrent transfer demo that tests WebRTC data channels through WebTorrent — runs on both GJS and browser.

## How it works

1. **Client A** (seeder) seeds a small text buffer as a torrent
2. **Client B** (leecher) adds the magnet URI and downloads via WebRTC data channels
3. Both clients discover each other through WebSocket trackers (`wss://tracker.webtorrent.dev`)

The shared logic in `src/torrent-demo.ts` is platform-agnostic — in the browser it uses native `RTCPeerConnection`, on GJS it uses `@gjsify/webrtc` backed by GStreamer webrtcbin.

## Build & Run

```bash
yarn build            # builds GJS + browser + copies HTML
yarn start            # run on GJS
yarn start:browser    # open in browser (http-server)
```

## Current Status

**Working:**
- WebTorrent initializes and detects WebRTC (`WEBRTC_SUPPORT: true`)
- Torrent seeding completes (metadata hashing, infoHash, `ready` event)
- Browser version works end-to-end with native WebRTC

**GJS blocker — tracker connection:**
The `ws` npm module ships a `browser.js` stub that throws *"ws does not work in the browser"*. Since our GJS esbuild config uses `mainFields: ['browser', ...]` (needed for pure-JS polyfills of crypto/streams), this stub gets bundled. `simple-websocket` falls back to native `WebSocket` correctly, but `bittorrent-tracker/server.js` (server code bundled into the client) still tries to use `ws` directly and logs warnings. The actual tracker *client* path works — peers just need to find each other through the tracker, which requires the WebSocket connection to succeed.

## Known Issues

- **`bitfield` CJS-ESM double-default:** The `bitfield` npm package uses `exports.__esModule = true` with `exports.default = BitField`. esbuild's `__toESM(mod, 1)` in node-mode wraps this as a double-default (`{ default: { default: BitField } }`), causing `new BitField()` to fail. Fixed via a post-build patch in `build:gjs` that sets `isNodeMode=0` for the bitfield import.
- **GLib source ref-count warning:** Harmless GJS cleanup warning on exit (`g_source_unref_internal: ref_count == 0`).
