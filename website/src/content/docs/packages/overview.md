---
title: Overview
description: Summary of all 57+ gjsify packages
---

gjsify provides **57+ packages** organized into three categories, all implementing standard APIs using native GNOME libraries.

| Category | Packages | Description |
|---|---|---|
| [Node.js Modules](./node) | 40 | `fs`, `net`, `http`, `crypto`, `stream`, `events`, and more |
| [Web APIs](./web) | 12 | `fetch`, `WebSocket`, `AbortController`, `Streams`, and more |
| [DOM & Graphics](./dom) | 5 | Canvas2D, WebGL, DOM elements, event bridge, iframe |

## Status Legend

- **Full** — Complete implementation, tests passing
- **Partial** — Core functionality implemented, some APIs missing
- **Stub** — Minimal placeholder, not yet functional

## Installation

All packages are published to npm under the `@gjsify` scope:

```bash
yarn add @gjsify/fs @gjsify/http @gjsify/fetch
```

In most cases, you don't install packages directly — the gjsify esbuild plugin automatically aliases Node.js and Web API imports to their `@gjsify/*` counterparts during the GJS build.
