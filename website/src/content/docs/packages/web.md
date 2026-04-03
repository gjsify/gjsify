---
title: Web APIs
description: Web platform APIs implemented for GJS using native GNOME libraries
---

Web platform APIs implemented for GJS using native GNOME libraries.

| Package | GNOME Libs | Implements |
|---|---|---|
| `fetch` | Soup 3.0, Gio | `fetch()`, Request, Response, Headers |
| `dom-events` | — | Event, CustomEvent, EventTarget, DOMException |
| `abort-controller` | — | AbortController, AbortSignal |
| `formdata` | — | FormData, File |
| `web-globals` | — | Re-exports dom-events + abort-controller |
| `websocket` | Soup 3.0 | WebSocket, MessageEvent, CloseEvent |
| `streams` | Gio | ReadableStream, WritableStream, TransformStream |
| `compression-streams` | Gio | CompressionStream, DecompressionStream |
| `webcrypto` | GLib | SubtleCrypto, CryptoKey, getRandomValues |
| `eventsource` | Soup 3.0 | EventSource (Server-Sent Events) |
| `webstorage` | Gio | localStorage, sessionStorage |

## Usage

Web APIs are available as bare specifiers in GJS builds. The esbuild plugin handles the aliasing automatically:

```typescript
// This works in GJS — Soup.Session under the hood
const response = await fetch('https://api.example.com/data');
const data = await response.json();

// WebSocket via Soup.WebsocketConnection
const ws = new WebSocket('wss://echo.example.com');
ws.onmessage = (event) => console.log(event.data);
```
