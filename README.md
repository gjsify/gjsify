# gjsify

**The full JavaScript ecosystem, native on GNOME.**

**[Documentation](https://gjsify.github.io/gjsify/)**

Use Node.js APIs, Web APIs, and DOM interfaces in GNOME desktop applications. gjsify provides native implementations backed by GNOME libraries (GLib, Gio, Soup, Cairo, GTK) — so you can use the npm packages and patterns you already know to build native Linux apps.

## Features

- **40 Node.js modules** — fs, net, http, crypto, streams, child_process, and more
- **12 Web API packages** — fetch, WebSocket, WebCrypto, Streams, EventSource, AbortController
- **5 DOM packages** — Canvas2D (Cairo), WebGL (OpenGL ES), DOM elements, event bridge, iframes (WebKit)
- **ESM-only**, TypeScript-first, esbuild-based build system
- Native GNOME library bindings: `Gio` for I/O, `Soup 3.0` for HTTP, `GLib` for crypto/process, `Cairo` for 2D, `GTK 4` for UI
- Every test runs on both Node.js and GJS

## Quick Start

### Create a new project

```bash
npm create @gjsify/app my-app
cd my-app
npm install
npm run build
npm start
```

This scaffolds a GTK 4 application with TypeScript, ready to build and run.

### Prerequisites

**Node.js 24+** is required. Your system also needs GJS and GNOME development libraries.

Fedora:

```bash
sudo dnf install gjs glib2-devel gobject-introspection-devel gtk4-devel \
  libsoup3-devel webkitgtk6.0-devel libadwaita-devel gdk-pixbuf2-devel \
  libepoxy-devel libgda libgda-sqlite meson vala gcc pkgconf nodejs
```

Ubuntu:

```bash
sudo apt install gjs libglib2.0-dev libgirepository1.0-dev libgtk-4-dev \
  libsoup-3.0-dev libwebkitgtk-6.0-dev libadwaita-1-dev libgdk-pixbuf-2.0-dev \
  libepoxy-dev libgda-6.0-dev meson valac gcc pkg-config nodejs
```

### Using the CLI directly

```bash
# Install the CLI
npm install -g @gjsify/cli

# Build a TypeScript file for GJS (default target)
gjsify build src/index.ts --outfile dist/app.js

# Run it
gjsify run dist/app.js
```

## Usage

Write standard Node.js code — the bundler resolves `node:*` imports to `@gjsify/*` implementations when targeting GJS:

```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const content = readFileSync('/etc/hostname', 'utf8');
const hash = createHash('sha256').update(content).digest('hex');

writeFileSync(join('/tmp', 'hostname-hash.txt'), hash);
console.log(`Hostname hash: ${hash}`);
```

Web APIs work too:

```typescript
const response = await fetch('https://api.github.com/zen');
const text = await response.text();
console.log(text);
```

## Package Status

### Node.js Modules

| Status | Packages |
|--------|----------|
| **Full** (32) | assert, async_hooks, buffer, child_process, console, constants, crypto, dgram, diagnostics_channel, dns, events, fs, globals, http, https, module, net, os, path, perf_hooks, process, querystring, readline, stream, string_decoder, sys, timers, tls, tty, url, util, zlib |
| **Partial** (3) | worker_threads (subprocess-based, no SharedArrayBuffer), http2 (constants only), vm (eval-based, no realm isolation) |
| **Stub** (4) | cluster, domain, inspector, v8 |

### Web APIs

abort-controller, compression-streams, dom-events, dom-exception, eventsource, fetch, formdata, streams, webcrypto, web-globals, websocket, webstorage.

### DOM

| Package | Backed by | Provides |
|---------|-----------|----------|
| canvas2d | Cairo, PangoCairo | CanvasRenderingContext2D, Canvas2DBridge → Gtk.DrawingArea |
| dom-elements | GdkPixbuf | Node, Element, HTMLCanvasElement, HTMLImageElement, Document |
| event-bridge | GTK 4, Gdk 4 | GTK → DOM event mapping (Mouse, Pointer, Keyboard, Wheel, Focus) |
| iframe | WebKit 6.0 | HTMLIFrameElement, IFrameBridge → WebKit.WebView |
| webgl | gwebgl (Vala) | WebGL 1.0/2.0, WebGLBridge → Gtk.GLArea |

### GNOME Library Mappings

| Node.js | GNOME |
|---------|-------|
| fs | Gio.File, Gio.FileIOStream |
| net | Gio.SocketClient, Gio.SocketService |
| http/https | Soup.Server, Soup.Session |
| crypto | GLib.Checksum, GLib.Hmac |
| child_process | Gio.Subprocess |
| dns | Gio.Resolver |
| tls | Gio.TlsClientConnection |
| url | GLib.Uri |
| process | GLib (env, pid, cwd) |

## Project Structure

```
packages/
  node/       # 40 Node.js API packages (@gjsify/<name>)
  web/        # 12 Web API packages (fetch, WebSocket, etc.)
  dom/        # 5 DOM packages (Canvas2D, WebGL, DOM elements, etc.)
  gjs/        # GJS utilities, types, test framework
  infra/      # Build tools, esbuild plugins, CLI, create-app
examples/
  cli/        # CLI examples (fs, path, events, etc.)
  gtk/        # GTK, Canvas2D, WebGL, and three.js examples
  net/        # Network examples (Express, Hono, Koa, WebSocket)
refs/         # Read-only reference submodules (Node.js, Deno, Bun, etc.)
```

## Development

```bash
# Full build
yarn build

# Type check
yarn check

# Run all tests
yarn test

# Per-package testing
cd packages/node/fs
yarn test:node    # Verify test correctness on Node.js
yarn test:gjs     # Verify implementation on GJS
```

### Testing Philosophy

Every test runs on both Node.js and GJS. Node.js validates test correctness; GJS validates the implementation. Tests use `@gjsify/unit` (describe/it/expect).

## Target Environment

- GJS 1.84+ (SpiderMonkey 128 / ES2024)
- Node.js 24.x (for test validation)
- esbuild target: `firefox128`
- ESM-only, TypeScript 6.x

## License

See individual package licenses. Most packages are MIT.
