---
title: Getting Started
description: Scaffold, build and run your first GJSify project
---

## Quick Start

```bash
npx @gjsify/cli create my-app
cd my-app && npm install
npm run dev
```

That's it — a GTK 4 window running your TypeScript, natively on Linux.

> **Tip:** Run `npx @gjsify/cli --help` to see all available commands at a glance.

## Prerequisites

You need a few system packages:

- **GJS** 1.84+ — the GNOME JavaScript runtime
- **GTK 4** — the UI toolkit
- **Node.js** 24+ — build time only (for `npm`/`npx`)
- **libsoup3** — HTTP, WebSocket and `fetch` at runtime

<details>
<summary>Install commands</summary>

Fedora:

```bash
sudo dnf install gjs gtk4 libsoup3
```

Debian/Ubuntu:

```bash
sudo apt install gjs libgtk-4-1 libsoup-3.0-0
```

</details>

Not sure if everything is in place?

```bash
npx @gjsify/cli check
```

## What gets scaffolded

`gjsify create` generates a minimal GTK 4 project:

```
my-app/
├── src/
│   └── index.ts        # Gtk.Application entry point
├── package.json        # build/start/dev scripts wired to gjsify CLI
└── tsconfig.json
```

The build script uses `--globals auto` by default — no manual list to maintain:

```jsonc
"scripts": {
  "build": "gjsify build src/index.ts --outfile dist/index.js",
  "start": "gjsify run dist/index.js"
}
```

> You can also scaffold via `npx @gjsify/create-app my-app` directly.

## Build and run

```bash
npm run build   # gjsify build src/index.ts --outfile dist/index.js
npm start       # gjsify run dist/index.js
npm run dev     # build + run in one step
```

`gjsify run` automatically sets `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH` for any native prebuilds (e.g. `@gjsify/webgl`).

## Using Node.js and Web APIs

Write standard Node.js and Web API code — the esbuild plugin handles everything:

1. **Auto aliasing** — `import { readFileSync } from 'node:fs'` rewrites to `@gjsify/fs` (backed by Gio)
2. **Auto globals** — `fetch`, `Buffer`, `process`, `URL` etc. are detected and injected automatically

```typescript
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

`node:fs` is backed by `Gio.File`, `node:http` by `Soup.Server`, `process.env` by `GLib.getenv()`. The same code works on Node.js and GJS depending on the `--app` target.

```typescript
const response = await fetch('https://api.example.com/data')
const data = await response.json()

const ws = new WebSocket('wss://echo.example.com')
ws.addEventListener('message', (event) => console.log(event.data))
```

<details>
<summary>Auto detection missed a global?</summary>

This is rare, but happens with libraries that wrap `globalThis` in another object (hiding the access from static analysis). Keep auto on and add the missing identifier:

```bash
gjsify build … --globals auto,matchMedia
# or use a group:
gjsify build … --globals auto,dom
```

See the [CLI Reference](/gjsify/cli-reference/#known-identifiers) for the full list of supported identifiers.

</details>

## Next steps

- [CLI Reference](/gjsify/cli-reference/) — all `gjsify` subcommands and flags
- [How It Works](/gjsify/how-it-works/) — auto-aliasing, prebuilds and the GJS build pipeline
- [Packages Overview](/gjsify/packages/overview/) — 57+ Node.js, Web and DOM packages
- [Contributing](/gjsify/contributing/development-setup/) — help improve GJSify itself
