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
├── examples/        # Example applications (CLI, GTK, networking)
├── refs/            # Read-only reference submodules (Node.js, Deno, etc.)
└── website/         # This documentation site
```

## Build System

GJSify uses **esbuild** with platform-specific plugins to produce different bundles:

- **GJS build** (`gjsify build --app gjs`): Aliases `assert` → `@gjsify/assert`, externalizes `gi://*` imports. Target: `firefox128`.
- **Node build** (`gjsify build --app node`): Aliases `@gjsify/process` → `process`. Target: `node24`.

## GNOME Library Mapping

Each `@gjsify/*` package maps Node.js or Web APIs to native GNOME libraries:

| Node.js API | GNOME Library |
|---|---|
| `fs` | `Gio.File`, `Gio.FileIOStream` |
| `net` | `Gio.SocketClient`, `Gio.SocketService` |
| `http` | `Soup.Server`, `Soup.Session` |
| `crypto` | `GLib.Checksum`, `GLib.Hmac` |
| `fetch` | `Soup.Session` |
| Canvas2D | `Cairo.ImageSurface`, `PangoCairo` |
| WebGL | `Gtk.GLArea`, OpenGL ES via libepoxy |
