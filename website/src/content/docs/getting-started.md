---
title: Getting Started
description: Scaffold, build and run your first GJSify project
---

GJSify lets you write GTK/GNOME apps with the familiar Node.js and Web API ecosystem. `import fs from 'node:fs'`, `fetch(...)`, `WebSocket`, `ReadableStream`, Canvas2D, WebGL — all backed by GLib, Gio, Soup, Cairo and GTK, running natively on Linux via [GJS](https://gjs.guide/).

This guide walks you through scaffolding a new project, building it and running it.

## Prerequisites

You only need a few system packages installed:

- **GJS** 1.84+ (GNOME 46+) — the GNOME JavaScript runtime
- **GTK 4** — the UI toolkit used by the default template
- **Node.js** 24+ — only needed at build time (for `npm`/`npx` and the CLI)
- **libsoup3** — runtime for HTTP, WebSocket and `fetch`

On Fedora:

```bash
sudo dnf install gjs gtk4 libsoup3
```

On Debian/Ubuntu:

```bash
sudo apt install gjs libgtk-4-1 libsoup-3.0-0
```

Not sure if everything is in place? Run the built-in check:

```bash
npx @gjsify/cli check
```

## Scaffold a new project

Create a fresh GJSify project in a new directory:

```bash
npx @gjsify/cli create my-app
cd my-app
npm install
```

This generates a minimal GTK 4 application:

```
my-app/
├── src/
│   └── index.ts        # Gtk.Application entry point
├── package.json        # with build/start/dev scripts wired to gjsify CLI
└── tsconfig.json
```

The generated `package.json` already depends on `@gjsify/cli`, `@gjsify/node-globals` and `@gjsify/node-polyfills`, so everything you need is in place after `npm install`.

> Alternative: you can also call the scaffolder directly via `npx @gjsify/create-app my-app`. Both commands produce the same project.

## Build and run

The scaffolded project ships with three npm scripts:

```bash
npm run build   # gjsify build src/index.ts --outfile dist/index.js
npm start       # gjsify run dist/index.js
npm run dev     # build + run in one step
```

`gjsify run` automatically sets `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH` for any native prebuilds in your `node_modules` (e.g. `@gjsify/webgl`), so you do not have to wire up the environment yourself.

## Using Node.js and Web APIs

The GJSify esbuild plugin does two things for you when you build for GJS:

1. **Automatic module aliasing** — it rewrites Node.js and Web API imports like `node:fs` or `node:http` to their `@gjsify/*` equivalents. You never install or import the `@gjsify/*` packages directly.
2. **Automatic global registration** — it scans your source for references to globals like `fetch`, `Buffer`, `process`, `URL`, `ReadableStream`, `AbortController`, `crypto`, and automatically injects the necessary registration modules so the globals are available at runtime. No boilerplate imports like `import '@gjsify/node-globals'` are needed.

```typescript
// src/index.ts — look ma, no special imports!
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const html = readFileSync('index.html', 'utf-8')

const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
})

server.listen(parseInt(process.env.PORT ?? '8080'), () => {
    console.log('Server running on http://localhost:8080')
})
```

`node:fs` is backed by `Gio.File`, `node:http` by `Soup.Server`, `process.env` by `GLib.getenv()` — but from your code's perspective it is just Node.js. The same applies to Web APIs:

```typescript
const response = await fetch('https://api.example.com/data')
const data = await response.json()

const ws = new WebSocket('wss://echo.example.com')
ws.addEventListener('message', (event) => console.log(event.data))
```

> **When do you need `--globals`?** In the rare case where an npm dependency uses a global your own code never references directly (e.g. a client library that calls `Buffer.from` internally), add it explicitly with `gjsify build --globals +Buffer`. See the [CLI Reference](/gjsify/cli-reference/#auto-globals) for all the options.

See [How It Works](/gjsify/how-it-works/) for a full explanation of auto-aliasing and auto-globals, or jump straight to the [CLI Reference](/gjsify/cli-reference/) to explore all available commands.

## Next Steps

- [CLI Reference](/gjsify/cli-reference/) — all `gjsify` subcommands and flags
- [How It Works](/gjsify/how-it-works/) — auto-aliasing, prebuilds and the GJS build pipeline
- [Packages Overview](/gjsify/packages/overview/) — 57+ Node.js, Web and DOM packages
- [Contributing](/gjsify/contributing/development-setup/) — help improve GJSify itself
