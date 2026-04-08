---
title: How It Works
description: Auto-aliasing, native prebuilds and the GJS build pipeline
---

GJSify lets you write code against familiar Node.js and Web APIs while running natively on GJS. This page explains the two pieces of magic that make that possible: **automatic module aliasing** at build time and **automatic native library loading** at runtime.

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
