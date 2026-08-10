# @gjsify/example-dom-webrtc-video

A webcam preview showcase: `navigator.mediaDevices.getUserMedia()` video capture rendered in a native GTK4 window via `@gjsify/video`'s `VideoBridge` (`Gtk.Picture` + GStreamer `gtk4paintablesink`) and in the browser in a real `<video>` element — from one shared entry point.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Bundle | Platform glue |
|---|---|---|
| GJS / GTK 4 | `dist/gjs.js` (`--app gjs`) | `@gjsify/webrtc` `getUserMedia` + `@gjsify/video` `VideoBridge` → `Gtk.Picture` / `gtk4paintablesink` |
| Browser | `dist/browser-main.js` (`--app browser`) | the browser's own `getUserMedia` + a real `<video>` element |

Both targets run the same demo in `src/video-demo.ts` and differ only in the shell around the video surface.

This showcase is `private` (not published to npm) and not part of the `gjsify showcase` manifest — it runs from a checkout via its own scripts.

## Prerequisites

- GJS ≥ 1.86 with GTK 4
- GStreamer with `gtk4paintablesink` from gst-plugins-rs — `dnf install gstreamer1-plugin-gtk4` (Fedora) / `apt install gstreamer1.0-gtk4` (Ubuntu/Debian); verify with `gst-inspect-1.0 gtk4paintablesink`
- A webcam or a virtual video device, and PipeWire or PulseAudio for capture

`gjsify system-check` reports GJS plus the optional GStreamer dependencies.

## Run

```bash
# Build first (gjs + browser bundles and the assets)
gjsify run build

# GJS / GTK4 native window (Adwaita)
gjsify run start

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it does

1. Requests webcam access via `navigator.mediaDevices.getUserMedia({ video: true })`
2. Sets the resulting `MediaStream` as `video.srcObject`
3. On GJS: renders through `VideoBridge` (GTK4 `Gtk.Picture` + GStreamer `gtk4paintablesink`)
4. On browser: renders in a native `<video>` element

## What it demonstrates

- `navigator.mediaDevices.getUserMedia()` with video constraints on GJS
- `MediaStream` and `MediaStreamTrack` APIs backed by a GStreamer pipeline
- `HTMLVideoElement.srcObject` assignment — the W3C spelling, on a GTK widget
- `@gjsify/video`'s `VideoBridge` — bridges the DOM `<video>` element to a GTK4 widget
- GStreamer source-chain negotiation with fallbacks: `pipewiresrc` → `pulsesrc` → `v4l2src`
- Adwaita application window with `Adw.HeaderBar` + `Adw.ToolbarView`
- `gjsify build --app gjs` and `--app browser` dual-target build

## Layout

```
src/
  video-demo.ts        shared demo — getUserMedia + srcObject wiring
  gjs/                 Adw.Application shell around the VideoBridge widget
  browser/             browser shell + index.html
```

## Related

- [`@gjsify/video`](../../../packages/framework/video) — the `VideoBridge` implementation this exercises
- [`@gjsify/webrtc`](../../../packages/web/webrtc) — `getUserMedia` / `MediaStream` and the peer-connection surface
- [`webrtc-loopback`](../webrtc-loopback) — the data-channel side of the same stack

## License

MIT
