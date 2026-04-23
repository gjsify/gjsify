---
title: Web APIs
description: Web platform APIs implemented for GJS using native GNOME libraries
---

19 Web platform APIs implemented for GJS using native GNOME libraries (plus `@gjsify/web-polyfills` meta).

| Package | GNOME Libs | Implements |
|---|---|---|
| `abort-controller` | — | AbortController, AbortSignal (.abort, .timeout, .any) |
| `compression-streams` | Gio | CompressionStream, DecompressionStream (gzip/deflate/deflate-raw) |
| `dom-events` | — | Event, CustomEvent, EventTarget |
| `dom-exception` | — | DOMException (WebIDL) |
| `domparser` | — | DOMParser.parseFromString with minimal DOM (excalibur-tiled-sized) |
| `eventsource` | Soup 3.0 | EventSource (Server-Sent Events), TextLineStream |
| `fetch` | Soup 3.0, Gio, GLib | `fetch()`, Request (raw-body via `set_request_body_from_bytes`), Response, Headers |
| `formdata` | — | FormData, File, multipart encoding |
| `gamepad` | Manette 0.2 | Gamepad, GamepadButton, GamepadEvent, GamepadHapticActuator (dual-rumble) |
| `streams` | — | ReadableStream, WritableStream, TransformStream, TextEncoder/DecoderStream |
| `web-globals` | — | Meta-register for every Web API global |
| `webaudio` | Gst 1.0, GstApp 1.0 | AudioContext (GStreamer decodebin + playback chain), AudioBufferSourceNode, GainNode, AudioParam |
| `webcrypto` | GLib | SubtleCrypto (AES, RSA-OAEP/PSS, ECDSA, HMAC, PBKDF2, HKDF, ECDH), CryptoKey, getRandomValues, randomUUID |
| `webrtc` | Gst 1.0, GstWebRTC 1.0, GstSDP 1.0 | Full W3C WebRTC (RTCPeerConnection, RTCDataChannel, RTCRtpSender/Receiver/Transceiver, MediaStream/Track, getUserMedia, RTCDTMFSender, RTCCertificate) |
| `webrtc-native` | Gst 1.0, GstWebRTC 1.0 | Vala/GObject prebuild — main-thread signal bridges consumed by `@gjsify/webrtc` |
| `websocket` | Soup 3.0 | WebSocket, MessageEvent, CloseEvent (NUL-byte-safe text frames, Autobahn-validated) |
| `webstorage` | Gio | localStorage, sessionStorage |
| `xmlhttprequest` | Soup 3.0, GLib | XMLHttpRequest (`responseType`: arraybuffer / blob / json / text / document), FakeBlob + temp-file plumbing for `URL.createObjectURL` |

## Adwaita for browser targets

| Package | Notes |
|---|---|
| `@gjsify/adwaita-web` | Web Components (AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwCard, AdwSwitchRow, AdwComboRow, AdwSpinRow, AdwToastOverlay, AdwOverlaySplitView) + SCSS partials |
| `@gjsify/adwaita-fonts` | Adwaita Sans TTF files + `@font-face` CSS |
| `@gjsify/adwaita-icons` | Adwaita symbolic icons as importable SVG strings |

## Meta

| Package | Purpose |
|---|---|
| `@gjsify/web-polyfills` | Umbrella dep — pulls every Web polyfill for scaffolding templates |

## Usage

Web APIs are available as bare specifiers in GJS builds. The esbuild plugin handles the aliasing automatically:

```typescript
// This works in GJS — Soup.Session under the hood
const response = await fetch('https://api.example.com/data');
const data = await response.json();

// WebSocket via Soup.WebsocketConnection
const ws = new WebSocket('wss://echo.example.com');
ws.onmessage = (event) => console.log(event.data);

// WebRTC via GStreamer webrtcbin
const pc = new RTCPeerConnection();
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
```
