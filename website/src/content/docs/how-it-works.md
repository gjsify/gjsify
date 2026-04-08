---
title: How It Works
description: Auto-aliasing, explicit globals and the GJS build pipeline
---

GJSify lets you write code against familiar Node.js and Web APIs while running natively on GJS. This page explains the three pieces that make that possible: **automatic module aliasing** at build time, **explicit globals via the `--globals` CLI flag**, and **automatic native library loading** at runtime.

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

## Explicit globals via `--globals`

Auto-aliasing turns `import { createServer } from 'node:http'` into the right Gio/Soup-backed module. But plenty of Node.js code also reaches for globals without any imports — `process.env.FOO`, `Buffer.from(data)`, `new URL('https://…')`, `await fetch(...)`. On GJS those globals don't exist until something registers them on `globalThis`.

Every `@gjsify/*` package that provides a Node or Web global exposes a `/register` subpath (e.g. `@gjsify/fetch/register`, `@gjsify/buffer/register`). Importing the subpath as a side-effect runs the registration; importing only named exports from the root module stays completely tree-shakeable.

Instead of guessing which registers your project needs, the CLI accepts an explicit list via `--globals`:

```bash
gjsify build src/index.ts --outfile dist/index.js \
  --globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController
```

The CLI resolves each identifier against a known map, writes a small ESM stub with `import '<pkg>/register';` lines into `node_modules/.cache/gjsify/`, and passes that stub to esbuild's `inject` option. At runtime the globals are set up before your code runs.

### Projects scaffolded via `npx @gjsify/cli create` ship with a sensible default

```jsonc
"scripts": {
  "build": "gjsify build src/index.ts --outfile dist/index.js --globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController"
}
```

Those eight identifiers cover practically every Node-style project — Express, Koa, Hono, fetch clients, crypto hashers, etc. Just `yarn install && yarn build` and your bundle ships.

If you need something the default doesn't cover — say `ReadableStream` for a streaming parser, or `CompressionStream` for gzip — edit the `--globals` list in the scaffolded `package.json` script. The full table of supported identifiers lives in the [CLI Reference](/gjsify/cli-reference/#known-identifiers).

### Why not auto-detection?

Earlier design iterations tried to scan your source tree (and transitive npm dependencies) automatically to figure out which globals you needed. The heuristic kept leaking:

- **Isomorphic npm packages** reference `document` or `window` behind `typeof document !== 'undefined'` feature-detection guards — a static scan can't tell the difference between guarded compat code and real DOM use.
- **Dynamic imports** (`import(expr)`), bracket-notation global access (`globalThis['fetch']`) and runtime code-string execution can't be statically analysed at all.
- **Tree-shaking interactions**: files that esbuild loaded for analysis but then tree-shook away would still contribute false-positive injections.

Explicit declaration in `package.json` is predictable, trivially teachable, and keeps the CLI layer minimal. The `/register` subpath architecture does the heavy lifting — the `--globals` flag is just the thin API on top.

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
