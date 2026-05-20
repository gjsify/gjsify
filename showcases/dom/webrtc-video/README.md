# WebRTC Video — Webcam Preview

Demonstrates `getUserMedia()` video capture rendered in a GTK4 window via `VideoBridge`.

## What it does

1. Requests webcam access via `navigator.mediaDevices.getUserMedia({ video: true })`
2. Sets the resulting `MediaStream` as `video.srcObject`
3. On GJS: renders through `VideoBridge` (GTK4 `Gtk.Picture` + GStreamer `gtk4paintablesink`)
4. On browser: renders in a native `<video>` element

## What it demonstrates

- `navigator.mediaDevices.getUserMedia()` with video constraints
- `MediaStream` and `MediaStreamTrack` APIs
- `HTMLVideoElement.srcObject` assignment
- `@gjsify/video` `VideoBridge` — bridges the DOM `<video>` element to a GTK4 widget
- GStreamer source chain: `pipewiresrc` → `pulsesrc` → `v4l2src` fallback
- Adwaita application window with `HeaderBar` + `ToolbarView`

## Prerequisites

- Webcam (or virtual video device)
- PipeWire or PulseAudio for video capture

## Run

```bash
yarn build && yarn start        # GJS (Adwaita window)
yarn build:browser && yarn start:browser  # Browser
```
