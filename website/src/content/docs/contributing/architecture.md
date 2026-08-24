---
title: Architecture
description: Monorepo structure and GNOME library mappings
---

GJSify is an npm-workspaces monorepo, bootstrapped by its own CLI. `gjsify install` is the supported install path (no Yarn, no Node-only npm CLI required; see [Development Setup](/gjsify/contributing/development-setup/)).

## Monorepo Structure

```
gjsify/
├── packages/
│   ├── node/                # Node.js API implementations (@gjsify/<name>)
│   ├── web/                 # Web API implementations + Adwaita design identity
│   ├── dom/                 # DOM element classes (dom-elements, canvas2d-core)
│   ├── framework/           # GTK host, bridges, storybook, devtools, adwaita-app shell
│   ├── nativescript-bridge/ # NativeScript (Android/iOS) native wrappers
│   ├── node-gi/             # GObject-Introspection runtime for Node/Bun/Deno
│   ├── gjs/                 # GJS runtime utilities, types, test framework
│   └── infra/               # CLI, Rolldown / Vite plugins, build tools
├── showcases/       # Curated, published example applications
├── examples/        # Private dev/test examples
├── refs/            # Read-only reference submodules (Node.js, Deno, etc.)
└── website/         # This documentation site
```

## Build System

GJSify uses **Rolldown** (Vite 8's production bundler) with platform-specific plugins to produce different bundles from the same source:

- **GJS build** (`gjsify build --app gjs`): Aliases `node:*` and Web API imports to `@gjsify/*`, externalises `gi://*`, `cairo`, `system` and `gettext`. Target: `firefox140`.
- **Node build** (`gjsify build --app node`): Aliases `@gjsify/process` → `process`, maps aliased Web packages to their Node equivalents, and rewrites `gi://` imports to the [node-gi](/gjsify/projects/node-gi/) reverse bridge when the bundle uses them. Target: `node24`.
- **Browser build** (`gjsify build --app browser`): Standard browser target. Target: `esnext`.

The alias table lives in `packages/infra/resolve-npm/lib/index.mjs`; the Rolldown plugins live in `packages/infra/rolldown-plugin-gjsify/`.

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

## Four equal-priority pillars

GJSify treats the **Node.js API**, the **Web API**, the **DOM API** and the **Framework** layer as four equal pillars:

- `packages/node/`: Node.js builtins (`fs`, `http`, `crypto`, …)
- `packages/web/`: Web platform APIs (`fetch`, `WebSocket`, `ReadableStream`, Web Crypto, …)
- `packages/dom/`: DOM element classes (`HTMLCanvasElement`, `HTMLImageElement`, …) with headless Canvas 2D
- `packages/framework/`: everything that glues DOM and GTK together without being a spec implementation: the [GTK host](/gjsify/guides/ui-frameworks/) (`@gjsify/gtk-host`) that UI-framework renderers target, the [bridge widgets](/gjsify/patterns/bridges/), the [storybook](/gjsify/guides/storybook/), the [devtools control plane](/gjsify/guides/devtools/) and the [Adwaita app shell](/gjsify/guides/native-adwaita-app/)

The DOM-element ↔ GTK-widget pairings are documented in [Bridge Widgets](/gjsify/patterns/bridges/).
