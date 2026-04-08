---
title: How It Works
description: Auto-aliasing, auto-globals, native prebuilds and the GJS build pipeline
---

GJSify lets you write code against familiar Node.js and Web APIs while running natively on GJS. This page explains the three pieces of magic that make that possible: **automatic module aliasing** at build time, **automatic global registration** based on identifier references in your code, and **automatic native library loading** at runtime.

## Automatic module aliasing

When you run `gjsify build --app gjs`, the esbuild plugin rewrites every Node.js and Web API import to its `@gjsify/*` equivalent before bundling:

```typescript
// You write:
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
const res = await fetch('https://example.com/')
const ws = new WebSocket('wss://echo.example.com')
```

```typescript
// The esbuild plugin effectively resolves to:
import { readFileSync } from '@gjsify/fs'       // → Gio.File
import { createServer } from '@gjsify/http'     // → Soup.Server
// fetch    → Soup.Session   (via @gjsify/fetch)
// WebSocket → Soup.WebsocketConnection (via @gjsify/websocket)
```

The full alias table lives in `@gjsify/resolve-npm` and covers every Node.js builtin and Web API that GJSify implements. You can see the current coverage in the [Packages Overview](/gjsify/packages/overview/).

Two things follow from this:

- **You do not install `@gjsify/*` packages yourself.** The GJSify CLI pulls them in on demand and the plugin resolves the aliases during the build.
- **The bare specifier `import fs from 'node:fs'` is the canonical form.** No GJSify-specific imports leak into your source code, so the same file can be type-checked with `@types/node` and shipped to GJS or Node.js depending on the `--app` target.

The GJS build targets `firefox128` (SpiderMonkey 128, shipped with GJS 1.86) and externalises `gi://*`, `cairo`, `system` and `gettext` — those are resolved by the GJS runtime itself.

## Automatic global registration

Auto-aliasing turns `import { createServer } from 'node:http'` into the right Gio/Soup-backed module. But a lot of Node.js code doesn't use imports at all — it just reaches for `process.env.FOO`, `Buffer.from(data)`, `new URL('https://…')`, `await fetch(...)`. Those are **globals**, and on GJS they don't exist until something registers them on `globalThis`.

When you build for GJS, the GJSify esbuild plugin scans your entry-point files for references to known global identifiers — `fetch`, `Buffer`, `process`, `URL`, `ReadableStream`, `AbortController`, `crypto`, `TextEncoder`, `EventSource`, `document`, `Image`, `HTMLCanvasElement`, and ~70 others — and automatically prepends the matching `/register` side-effect modules to your bundle. You write idiomatic JavaScript; the plugin quietly makes sure the globals are set up before your code runs.

```typescript
// Your source — no special imports, no globals boilerplate
const res = await fetch('https://api.example.com/data')
const data = await res.json()
const buf = Buffer.from(JSON.stringify(data))
console.log(`received ${buf.byteLength} bytes from ${process.env.HOST}`)
```

The scanner is **scope-aware** — it uses a full JavaScript parser (`acorn`), so:

- Shadowed identifiers are ignored: `const fetch = myCustomFetch; fetch('…')` does not trigger a `/register` injection.
- Property accesses don't false-positive: `api.Buffer('hello')` is not treated as the global `Buffer`.
- Local imports, function parameters and catch clauses are respected.

On the rare file acorn cannot parse, the plugin silently falls back to a regex scanner so auto-globals never disables itself on a single malformed file.

### Limitations and escape hatches

The scanner only looks at **your own entry-point files**, not at external npm dependencies. In the vast majority of projects this is exactly what you want — if your app uses `fetch`, you write `fetch(...)` somewhere in your own code, and the scan finds it. For the edge case where an npm dependency uses a global your own code never references (e.g. a client library that calls `Buffer.from` internally), add it explicitly:

```bash
# Add `Buffer` on top of the automatic scan results
gjsify build src/index.ts --globals +Buffer

# Opt out of the scan entirely and manage registrations yourself
gjsify build src/index.ts --no-auto-globals

# Build an absolute whitelist (replaces the scan)
gjsify build src/index.ts --globals fetch,crypto,URL
```

A minimal "Hello GTK" app — one that imports `gi://Gtk` and nothing else — builds to about 5 KB because the scanner finds no globals and injects nothing. Every byte of the Node/Web API polyfills is pulled in on demand, on a per-identifier basis.

## Native prebuilds and `gjsify run`

Some GJSify packages need native code. For example, `@gjsify/webgl` ships a Vala-built shared library + GIR typelib to bridge WebGL calls to OpenGL ES through `libepoxy`. These packages publish their binaries under `prebuilds/linux-<arch>/` and declare them via a `"gjsify": { "prebuilds": "prebuilds" }` field in their `package.json`.

`gjsify run` scans your `node_modules` for these packages, prepends the right directories to `LD_LIBRARY_PATH` and `GI_TYPELIB_PATH`, and then spawns `gjs -m <bundle>`:

```bash
npx @gjsify/cli run dist/index.js
```

If you want to run `gjs` directly (for example from a systemd unit or a packaged Flatpak), you can ask the CLI to print the environment for you:

```bash
eval $(npx @gjsify/cli info --export)
gjs -m dist/index.js
```

Use `gjsify info` without `--export` for a human-readable report of every detected native package and the exact env vars needed.

## GLib MainLoop

Node.js servers (`http.Server.listen()`, `net.Server.listen()`, `dgram.Socket.bind()`) need a running GLib MainLoop to drive the underlying Gio async I/O. GJSify starts it for you via an internal `ensureMainLoop()` helper — you do not need to call it from application code. GTK applications keep using `Gtk.Application.runAsync()` as usual.

## Where to go next

- [Getting Started](/gjsify/getting-started/) — scaffold and run your first app
- [CLI Reference](/gjsify/cli-reference/) — full command list
- [Packages Overview](/gjsify/packages/overview/) — every API and its GNOME backend
