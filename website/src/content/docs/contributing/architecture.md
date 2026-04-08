---
title: Architecture
description: Monorepo structure and GNOME library mappings
---

GJSify is a Yarn workspaces monorepo that provides Node.js and Web API implementations for GJS using native GNOME libraries.

## Monorepo Structure

```
gjsify/
├── packages/
│   ├── node/        # Node.js API implementations (@gjsify/<name>)
│   ├── web/         # Web API implementations
│   ├── dom/         # DOM & graphics (Canvas2D, WebGL, event bridge)
│   ├── gjs/         # GJS runtime utilities, types, test framework
│   └── infra/       # CLI, esbuild plugins, build tools
├── showcases/       # Curated, published example applications
├── examples/        # Private dev/test examples
├── refs/            # Read-only reference submodules (Node.js, Deno, etc.)
└── website/         # This documentation site
```

## Build System

GJSify uses **esbuild** with platform-specific plugins to produce different bundles from the same source:

- **GJS build** (`gjsify build --app gjs`): Aliases `node:*` and Web API imports to `@gjsify/*`, externalises `gi://*`, `cairo`, `system` and `gettext`. Target: `firefox128`.
- **Node build** (`gjsify build --app node`): Aliases `@gjsify/process` → `process` and maps aliased Web packages to their Node equivalents. Target: `node24`.
- **Browser build** (`gjsify build --app browser`): Standard browser target. Target: `esnext`.

The alias table lives in `packages/infra/resolve-npm/lib/index.mjs`; the esbuild plugins live in `packages/infra/esbuild-plugin-gjsify/`.

## GNOME Library Mapping

Each `@gjsify/*` package maps Node.js or Web APIs to native GNOME libraries:

| Node.js / Web API | GNOME Library |
|---|---|
| `fs` | `Gio.File`, `Gio.FileIOStream` |
| `net` | `Gio.SocketClient`, `Gio.SocketService` |
| `http` | `Soup.Server` |
| `crypto` | `GLib.Checksum`, `GLib.Hmac` |
| `process.env` | `GLib.getenv` / `GLib.setenv` |
| `url.URL` | `GLib.Uri` |
| `fetch` | `Soup.Session` |
| `WebSocket` | `Soup.WebsocketConnection` |
| Canvas 2D | `Cairo.ImageSurface`, `PangoCairo` |
| WebGL | `Gtk.GLArea`, OpenGL ES via `libepoxy` (Vala extension) |
| `localStorage` | `Gio.File` + `GLib.KeyFile` |

## Three equal-priority pillars

GJSify treats the **Node.js API**, the **Web API** and the **DOM API** as three equal pillars:

- `packages/node/` — Node.js builtins (`fs`, `http`, `crypto`, …)
- `packages/web/` — Web platform APIs (`fetch`, `WebSocket`, `ReadableStream`, Web Crypto, …)
- `packages/dom/` — DOM element classes backed by GTK widgets (`HTMLCanvasElement`, `HTMLImageElement`, `HTMLIFrameElement`, …) plus the GTK→DOM event bridge

Each visual DOM element pairs with a GTK widget: `HTMLCanvasElement` (2D) → `Canvas2DWidget` → `Gtk.DrawingArea`, `HTMLCanvasElement` (WebGL) → `CanvasWebGLWidget` → `Gtk.GLArea`, `HTMLIFrameElement` → `IFrameWidget` → `WebKit.WebView`.
