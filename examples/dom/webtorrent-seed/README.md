# WebTorrent Seed + Download

P2P torrent transfer demo that tests WebRTC data channels through WebTorrent — runs on GJS, Node.js, and browser.

## How it works

1. **Client A** (seeder) seeds a small text buffer as a torrent
2. **Client B** (leecher) adds the magnet URI and downloads via WebRTC data channels
3. Both clients discover each other through WebSocket trackers (`wss://tracker.webtorrent.dev`)

The shared logic in `src/torrent-demo.ts` is platform-agnostic — in the browser and Node.js it uses native WebRTC, on GJS it uses `@gjsify/webrtc` backed by GStreamer webrtcbin.

## Build & Run

```bash
yarn build            # builds all three targets
yarn start            # run on GJS
yarn start:node       # run on Node.js
yarn start:browser    # open in browser (http-server)
```

## Browser polyfills

WebTorrent's source code imports Node.js builtins (`events`, `path`, `crypto`) directly. The `--app browser` build automatically aliases these to their browser-compatible polyfill packages (`path-browserify`, `crypto-browserify`, `stream-browserify`) which must be installed as devDependencies.

## Known Issues

- **`bitfield` CJS-ESM double-default:** The `bitfield` npm package uses `exports.__esModule = true` with `exports.default = BitField`. esbuild's `__toESM(mod, 1)` in node-mode wraps this as a double-default, causing `new BitField()` to fail. Fixed via a post-build patch in `build:gjs`.
- **`ws` browser stub warnings (GJS only):** The `ws` module's `browser.js` stub logs warnings but is never actually called — `simple-websocket` falls back to native `WebSocket` correctly.
