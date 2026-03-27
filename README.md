# gjsify

Node.js and Web Standard APIs for [GJS](https://gjs.guide/) (GNOME JavaScript).

Use npm packages and familiar Node.js APIs in GNOME desktop applications. gjsify bridges the gap between the Node.js ecosystem and GJS by providing native implementations of Node.js core modules backed by GNOME libraries (GLib, Gio, Soup).

## Features

- **39 Node.js modules** (32 fully implemented, 3 partial, 4 stubs)
- **15 Web API packages** (fetch, WebSocket, WebCrypto, Streams, EventSource, and more)
- **9,200+ tests** passing on both Node.js and GJS
- **ESM-only**, TypeScript-first
- Native GNOME library bindings: `Gio` for I/O, `Soup 3.0` for HTTP, `GLib` for crypto/process
- esbuild-based build system with platform-specific resolution

## Quick Start

### Prerequisites

**Node.js 24+** and **Yarn 4** (via Corepack) are required.

Fedora:

```bash
sudo dnf install gjs glib2-devel gobject-introspection-devel gtk4-devel \
  libsoup3-devel webkitgtk6.0-devel libadwaita-devel gdk-pixbuf2-devel \
  libepoxy-devel libgda libgda-sqlite meson vala gcc pkgconf nodejs
corepack enable
```

Ubuntu:

```bash
sudo apt install gjs libglib2.0-dev libgirepository1.0-dev libgtk-4-dev \
  libsoup-3.0-dev libwebkitgtk-6.0-dev libadwaita-1-dev libgdk-pixbuf-2.0-dev \
  libepoxy-dev libgda-6.0-dev meson valac gcc pkg-config nodejs
corepack enable
```

### Setup

```bash
git clone https://github.com/nickvision-studios/gjsify.git
cd gjsify
yarn install
yarn build
```

### Build for GJS

```bash
# Build a single-file GJS app from TypeScript
gjsify build src/index.ts --app gjs --outfile app.gjs.mjs

# Run it
gjs -m app.gjs.mjs
```

### Build for Node.js (for testing)

```bash
gjsify build src/index.ts --app node --outfile app.node.mjs
node app.node.mjs
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

All 15 packages fully implemented: abort-controller, compression-streams, dom-elements, dom-events, dom-exception, eventsource, fetch, formdata, html-image-element, streams, webcrypto, webgl, web-globals, websocket, webstorage.

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
  node/       # 39 Node.js API packages (@gjsify/<name>)
  web/        # 15 Web API packages
  gjs/        # GJS utilities, types, test framework
  infra/      # Build tools, esbuild plugins, CLI
examples/
  cli/        # CLI examples (fs, path, events, etc.)
  gtk/        # GTK/WebGL examples
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
