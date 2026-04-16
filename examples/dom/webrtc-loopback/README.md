# webrtc-loopback — WebRTC Data Channel loopback demo

Two `RTCPeerConnection` instances in a single GJS process perform the full
WebRTC handshake (offer/answer + ICE trickle) and exchange string and binary
payloads over a data channel.

This is the smoke-test example for [@gjsify/webrtc](../../../packages/web/webrtc).

## ⚠️ Currently blocked by a GJS limitation (Phase 1.5)

The async handshake (`createOffer`, `setLocalDescription`, …) **hangs on GJS today**
because webrtcbin fires its signals and `Gst.Promise` callbacks from GStreamer's
internal streaming thread — GJS deliberately blocks JS callbacks from non-main
threads to prevent VM corruption. See STATUS.md → "WebRTC Status" for the full
rationale and the planned Phase 1.5 native bridge (Vala helper that marshals
webrtcbin signals through `g_main_context_invoke()`).

Running this example today prints `pcA` construction and then hangs. The demo
will work as documented below once Phase 1.5 lands.

## Prerequisites

GStreamer ≥ 1.20 with both the WebRTC plugin and libnice:

| Distro          | Install                                                                   |
|-----------------|---------------------------------------------------------------------------|
| Fedora          | `dnf install gstreamer1-plugins-bad-free gstreamer1-plugins-bad-free-extras libnice-gstreamer1` |
| Ubuntu / Debian | `apt install gstreamer1.0-plugins-bad gstreamer1.0-nice`                  |

Verify:

```bash
gst-inspect-1.0 webrtcbin    # must print the webrtcbin plugin
gst-inspect-1.0 nicesrc      # must print the nice plugin
```

## Run

```bash
yarn build
yarn start
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
