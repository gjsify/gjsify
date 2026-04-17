# WebRTC States — Connection State Monitor

Adwaita GUI application that tracks all WebRTC connection state transitions during a local video call.

Adapted from the [webrtc-samples states](https://github.com/webrtc/samples/tree/gh-pages/src/content/peerconnection/states) example.

## What it does

1. Captures video via `getUserMedia({ video: true })`
2. Creates two local `RTCPeerConnection` instances (pc1 = local, pc2 = remote)
3. Adds video tracks to pc1 and performs offer/answer handshake
4. Displays a live state grid showing all three state types for both peers:
   - **Signaling state**: `stable` → `have-local-offer` → `stable`
   - **ICE connection state**: `new` → `checking` → `completed`
   - **Connection state**: `new` → `connecting` → `connected`
5. Shows local and remote video via two `VideoBridge` widgets

## What it demonstrates

- Full WebRTC call lifecycle with `getUserMedia` + `addTrack` + offer/answer
- `onsignalingstatechange`, `oniceconnectionstatechange`, `onconnectionstatechange` events
- Real-time GTK4 UI updates from async WebRTC callbacks via `GLib.idle_add()`
- `@gjsify/video` `VideoBridge` for rendering video in GTK4 `Gtk.Picture` widgets
- Adwaita application with `Gtk.Grid` layout for state display
- `ontrack` event for receiving remote media streams

## Prerequisites

- Webcam (or virtual video device)
- PipeWire or PulseAudio

## Run

```bash
yarn build && yarn start
```
