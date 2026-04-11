---
title: How It Works
description: Auto-aliasing, automatic globals detection and the GJS build pipeline
---

GJSify lets you write code against familiar Node.js and Web APIs while running natively on GJS. This page explains the three pieces that make that possible: **automatic module aliasing** at build time, **automatic globals detection via `--globals auto`**, and **automatic native library loading** at runtime.

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

## Automatic globals detection via `--globals auto`

Auto-aliasing turns `import { createServer } from 'node:http'` into the right Gio/Soup-backed module. But plenty of Node.js code also reaches for globals without any imports — `process.env.FOO`, `Buffer.from(data)`, `new URL('https://…')`, `await fetch(...)`. On GJS those globals don't exist until something registers them on `globalThis`.

Every `@gjsify/*` package that provides a Node or Web global exposes one or more `/register` subpaths (e.g. `@gjsify/fetch/register/fetch`, `@gjsify/node-globals/register/process`). Importing a subpath as a side-effect runs the registration; importing only named exports from the root module stays completely tree-shakeable.

The CLI's default `--globals auto` discovers which registers your project needs by analysing the bundled output:

```bash
gjsify build src/index.ts --outfile dist/index.js
# (--globals auto is the default — no flag needed)
```

### How auto detection works

The CLI runs an iterative multi-pass build:

1. **Pass 1** bundles your code into memory (no disk I/O, no minification, no globals injected). [acorn](https://github.com/acornjs/acorn) parses the resulting JavaScript and walks the AST looking for two patterns:
   - **Free identifiers** (`Buffer`, `fetch`, `process`) — references that are not declared anywhere in the bundle scope.
   - **Host-object member expressions** (`globalThis.Buffer`, `global.Buffer`, `window.Buffer`, `self.Buffer`) — many npm packages access globals through these wrappers.
   Each match against the [known-globals table](/gjsify/cli-reference/#known-identifiers) is a discovered global.
2. **Pass N** builds again with the discovered globals injected via tiny `register` stubs. The newly injected modules can pull in code that references *more* globals, so the loop repeats until the detected set stabilises (typically 2–3 iterations, capped at 5).
3. The final real build uses the converged set and writes to disk.

> Use `--verbose` to see what auto mode detected per iteration:
> ```bash
> gjsify build src/index.ts -o dist/index.js --verbose
> # [gjsify] --globals auto: iteration 1, 7 global(s): Buffer, fetch, process, …
> # [gjsify] --globals auto: iteration 2, 11 global(s): + AbortSignal, Headers, …
> # [gjsify] --globals auto: converged after 2 iteration(s), 11 global(s)
> ```

### Why analyse the bundled output, not the source?

Earlier design iterations tried to scan your source tree (and transitive npm dependencies) directly. That approach kept leaking:

- **Isomorphic npm packages** reference `document` or `window` behind `typeof document !== 'undefined'` feature-detection guards — a source-level scan cannot tell the difference between guarded compat code and real DOM use.
- **Dynamic imports** (`import(expr)`), bracket-notation global access (`globalThis['fetch']`) and runtime code-string execution can't be statically analysed at all.
- **Tree-shaking interactions**: files that esbuild loaded for analysis but then tree-shook away would still contribute false-positive injections.

Analysing the **already-bundled, tree-shaken** output sidesteps every one of these problems — if a global identifier survives esbuild's dead-code elimination, it is genuinely reachable. False positives drop to zero, and the detection cost is just one extra esbuild pass per iteration.

### When auto can't see a global: `--globals auto,<extras>`

The acorn analyser cannot follow value-flow indirection. The canonical example is Excalibur, which stores `globalThis` in `BrowserComponent.nativeComponent` and then calls `nativeComponent.matchMedia(...)` — neither bare `matchMedia` nor `globalThis.matchMedia` appears in the bundle, so the detector misses it.

The fix is to keep auto detection on and add an explicit safety net:

```bash
# Auto + the entire DOM group
gjsify build src/gjs/gjs.ts -o dist/gjs.js --globals auto,dom

# Auto + a single identifier we know auto can't see
gjsify build src/index.ts -o dist/index.js --globals auto,matchMedia,FontFace
```

The extras are seeded into the very first pass, so any code reachable only through them is also visible to the analyser.

### Other modes

| Mode | Behaviour |
|---|---|
| `--globals auto` | Default — fully automatic detection |
| `--globals auto,<extras>` | Auto + explicit safety net for hard-to-detect cases |
| `--globals fetch,Buffer,…` | Fully explicit list (or groups: `node`, `web`, `dom`). No auto detection. |
| `--globals none` | Disable globals injection entirely |

The full table of identifiers and groups lives in the [CLI Reference → Globals](/gjsify/cli-reference/#globals).

### Granular register subpaths

Each polyfill package splits its register code into per-feature subpaths. Detecting `Buffer` injects only `@gjsify/buffer/register`; detecting `process` injects only `@gjsify/node-globals/register/process` — not the entire `node-globals` register module. This means `--globals auto` produces bundles that contain only the register code for identifiers your app actually uses.

For example, an app that uses just `process.env` and `fetch` injects two tiny register stubs (`process` + `fetch`), not the entire Node + Web group.

### Projects scaffolded via `npx @gjsify/cli create`

Scaffolded projects rely on the default `auto` mode and don't pass `--globals` at all:

```jsonc
"scripts": {
  "build": "gjsify build src/index.ts --outfile dist/index.js",
  "start": "gjsify run dist/index.js"
}
```

`yarn install && yarn build` is enough — no global lists to maintain, no `ReferenceError`s to chase down.

### Troubleshooting: `ReferenceError: X is not defined`

If your GJS bundle crashes with `ReferenceError: X is not defined`, the global `X` was not detected. Fix:

1. Look up `X` in the [Known Identifiers table](/gjsify/cli-reference/#known-identifiers).
2. If `X` is listed, add it as an extra: edit your build script to use `--globals auto,X` (or use a group: `--globals auto,dom`).
3. Rebuild and rerun.

If `X` is not in the table, it is not yet implemented in GJSify — check the [Packages Overview](/gjsify/packages/overview/) or open an issue.

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
