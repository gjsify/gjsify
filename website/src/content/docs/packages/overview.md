---
title: Overview
description: Summary of all 70+ GJSify packages
---

GJSify provides **70+ packages** organized into four categories, all implementing standard APIs using native GNOME libraries.

| Category | Packages | Description |
|---|---|---|
| [Node.js Modules](./node) | 42 + 1 meta | `fs`, `net`, `http`, `crypto`, `stream`, `events`, `sqlite`, `ws`, and more |
| [Web APIs](./web) | 19 + 1 meta | `fetch`, `XMLHttpRequest`, `WebSocket`, `WebRTC`, `WebAudio`, `Streams`, `DOMParser`, and more |
| [DOM & Graphics](./dom) | 8 | Canvas2D (+ headless core), WebGL, DOM elements, event bridge, iframe, video, bridge-types |
| Adwaita for browser | 3 | `@gjsify/adwaita-web`, `@gjsify/adwaita-fonts`, `@gjsify/adwaita-icons` |

## Status Legend

- **Full** — Complete implementation, tests passing
- **Partial** — Core functionality implemented, some APIs missing
- **Stub** — Minimal placeholder, not yet functional

## Installation

All packages are published to npm under the `@gjsify` scope:

```bash
yarn add @gjsify/fs @gjsify/http @gjsify/fetch
```

In most cases, you don't install packages directly — the GJSify esbuild plugin automatically aliases Node.js and Web API imports to their `@gjsify/*` counterparts during the GJS build.
