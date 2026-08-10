# @gjsify/example-dom-webrtc-loopback

A WebRTC data-channel loopback demo: two `RTCPeerConnection` instances in a single process perform the full WebRTC handshake (offer/answer + trickle ICE) and exchange string and binary payloads over a data channel. Runs on GJS (`@gjsify/webrtc` over GStreamer `webrtcbin`) and in the browser (native WebRTC) — from one shared `runLoopback(log)` entry point.

This is the smoke-test showcase for [`@gjsify/webrtc`](../../../packages/web/webrtc), backed by the [`@gjsify/webrtc-native`](../../../packages/web/webrtc-native) Vala bridge that marshals webrtcbin's streaming-thread signals and `Gst.Promise` callbacks onto the GLib main context.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Bundle | Platform glue |
|---|---|---|
| GJS / GTK 4 | `dist/gjs.js` (`--app gjs`) | `@gjsify/webrtc` → `@gjsify/webrtc-native` → GStreamer `webrtcbin` + libnice |
| Browser | `dist/browser-main.js` (`--app browser`) | the browser's own WebRTC stack |

Both targets run the same `runLoopback(log)` in `src/loopback-demo.ts` and differ only in where the log lines are printed. GJS-only on the native side (`gjsify.example.runtimes: ["gjs"]`) — the bridge is a GStreamer/GLib typelib, so there is no `--app node` bundle.

## Prerequisites

GJS ≥ 1.86 and GStreamer ≥ 1.20 with both the WebRTC plugin and libnice:

| Distro          | Install                                                                   |
|-----------------|---------------------------------------------------------------------------|
| Fedora          | `dnf install gstreamer1-plugins-bad-free gstreamer1-plugins-bad-free-extras libnice-gstreamer1` |
| Ubuntu / Debian | `apt install gstreamer1.0-plugins-bad gstreamer1.0-nice`                  |

Verify:

```bash
gst-inspect-1.0 webrtcbin    # must print the webrtcbin plugin
gst-inspect-1.0 nicesrc      # must print the nice plugin
gjsify system-check          # reports GJS + the optional GStreamer deps
```

## Run

```bash
# Build first (gjs + browser bundles and the assets)
gjsify run build

# GJS
gjsify showcase webrtc-loopback
# or: gjsify run start

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it demonstrates

- The W3C WebRTC peer-connection surface on GJS: `RTCPeerConnection`, `createOffer` / `createAnswer` / `setLocalDescription` / `setRemoteDescription`, trickle `addIceCandidate`
- The full state machine observable from JS — `signalingState`, `iceConnectionState`, `connectionState` transitions on both peers
- `RTCDataChannel` end to end: `createDataChannel`, `ondatachannel`, `onopen`, `onmessage` with both string and `ArrayBuffer` payloads
- Streaming-thread safety: webrtcbin's signals and `Gst.Promise` callbacks arrive on GStreamer threads and are marshalled onto the GLib main context by `@gjsify/webrtc-native`, so JS handlers run on the main loop
- One shared demo module driving GJS and the browser — the same code path proves API parity
- `gjsify build --app gjs` and `--app browser` dual-target build

## Layout

```
src/
  loopback-demo.ts     shared runLoopback(log) — the whole handshake + echo round-trip
  gjs/                 GJS entry (prints the trace to stdout)
  browser/             browser entry + index.html (prints the trace into the page)
```

## Expected output

```
[A] signalingState → have-local-offer
[B] signalingState → have-remote-offer
[B] signalingState → stable
[A] signalingState → stable
[A→B] ICE host 127.0.0.1:…
[B→A] ICE host 127.0.0.1:…
[A] iceConnectionState → checking
[A] iceConnectionState → connected
[B] iceConnectionState → connected
[A] data-channel "chat" open — sending greeting
[B] ondatachannel "chat"
[B] data-channel "chat" open
[B] received: hello from peer A — echoing back
[A] received: echo: hello from peer A
[B] received ArrayBuffer(4) — echoing reversed
[A] received ArrayBuffer(4): [4, 3, 2, 1]
[main] demo complete — closing peer connections
```

## Related

- [`@gjsify/webrtc`](../../../packages/web/webrtc) — the W3C WebRTC implementation this smoke-tests
- [`@gjsify/webrtc-native`](../../../packages/web/webrtc-native) — the Vala bridge over GStreamer `webrtcbin`
- [`webrtc-video`](../webrtc-video) — the media side of the same stack (`getUserMedia` + a GTK video sink)

## License

MIT
