---
title: napi
description: Load native Node.js N-API addons (.node) inside GJS — the forward bridge. The same compiled addon that runs on Node.js runs unchanged on GJS.
---

[`@gjsify/napi`](https://github.com/gjsify/gjsify/tree/main/packages/napi/napi) is the **forward mirror** of [node-gi](/gjsify/projects/node-gi/): where node-gi carries GObject-Introspection *out* to Node.js, Bun and Deno, `@gjsify/napi` brings **native Node.js addons *into* GJS**. A compiled `.node` addon — the exact binary you would `require()` on Node — loads and runs unchanged under GJS.

The point is reuse: a GJS app can pull a database driver, a hashing library or a codec straight from the native npm ecosystem, with no pure-JS reimplementation.

:::note[Stability]
`@gjsify/napi` is **experimental (tier 3)** — a new axis, released on the train but with no stability promise yet. No other GJSify package depends on it, so it can never affect a regular GJS build. See the [stability model](/gjsify/versioning/#package-tiers).
:::

## How it works

Node-API (N-API) is an **engine-agnostic C ABI**: the *same* `.node` binary already runs on Node (V8), Deno and Bun (JSC). `@gjsify/napi` implements that ABI a fourth time — over GJS's SpiderMonkey engine (mozjs). The shim ships as a GObject-Introspection package (`.so` + `.gir` + `.typelib`), so GJS loads it through `imports.gi` like any other GI library. It then exposes a `loadAddon(path)` call that `dlopen`s the addon and binds its `napi_*` symbols to the shim's implementation.

```ts
import { loadAddon, hasNapi } from '@gjsify/napi';

if (hasNapi()) {
    const sqlite = loadAddon('./build/Release/better_sqlite3.node');
    // `sqlite` is the addon's module.exports — a normal object.
    const db = new sqlite.Database(':memory:');
}
```

Your addon is built the normal way (node-gyp / prebuilds) — nothing about it changes. The hard part is on the shim side: SpiderMonkey has a **moving GC**, so an `napi_value` can't be a raw engine value (the shortcut Bun takes on JSC) — it is a handle into a per-environment arena of GC-traced slots. Asynchronous work is bridged to GLib instead of libuv: threadsafe-function calls and `napi_async_work` completions dispatch onto the GLib main context through a `g_idle` source, while `napi_async_work` runs its `execute` callback on a `GThreadPool` worker — so async addons get real concurrency, with no separate libuv loop to run.

## What runs today

A golden-diff harness runs a deterministic workout of each addon on **Node (the reference)** and on **GJS-under-the-shim**, and requires **byte-identical output**:

| Addon | Language / codegen | Kind | Result |
|---|---|---|:--:|
| [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) | C, node-addon-api | synchronous | ✅ byte-identical |
| [`bufferutil`](https://github.com/websockets/bufferutil) | C, node-gyp-build | synchronous | ✅ |
| [`utf-8-validate`](https://github.com/websockets/utf-8-validate) | C++, node-gyp-build | synchronous | ✅ |
| [`@node-rs/argon2`](https://github.com/napi-rs/node-rs) | Rust, napi-rs | synchronous | ✅ byte-identical |
| [`node-sqlite3`](https://github.com/TryGhost/node-sqlite3) | C++, node-addon-api | **asynchronous** | ✅ byte-identical |

Those first four are C, C++ and Rust addons emitted by three different N-API code generators — strong evidence that an arbitrary *synchronous* addon runs unmodified. `node-sqlite3` additionally drives the async surface (`napi_async_work` + threadsafe functions), so the whole asynchronous `node-addon-api` ecosystem is reachable, not just the sync subset.

### Scope

The full synchronous N-API surface is implemented, plus the async / threadsafe-function group. `napi_async_work` runs each addon's `execute` on a **`GThreadPool` worker** and marshals `complete` back onto the GLib main context, so async addons run with genuine concurrency (a 5×1s workload finishes in ~1s on a five-thread pool, not ~5s). A few Node-specific corners stay stubbed because they have no engine-agnostic meaning on GJS — most notably `napi_get_uv_event_loop` (GJS has no libuv loop; the GLib main context *is* the loop).

### Platforms

Prebuilt and CI-validated on **Linux (x86_64)** and **macOS (arm64)** — the same GJS + mozjs-140 pairing on both, with the full load / value-model / threadsafe-function gates green. **Windows** is groundwork-only: the loader and build wiring exist behind a manual CI job, but it is blocked upstream — no prebuilt `libgjs` for Windows exists yet (the shim links GJS's SpiderMonkey, so it needs a Windows `libgjs` the ecosystem doesn't ship). See the [package README](https://github.com/gjsify/gjsify/tree/main/packages/napi/napi#readme) for the platform matrix.

## Not a replacement for `gi://`

`@gjsify/napi` exists to **reuse native npm addons** — not to talk to GObject libraries. On GJS the native [`gi://`](/gjsify/patterns/gobject-classes/) / `imports.gi` binding stays *the* way to use GTK, GLib and every introspected library; always prefer it. The one place the two directions meet is testing: running [`@gjsify/node-gi`](/gjsify/projects/node-gi/) *under* the shim and diffing its output against native `gi://` is a **differential oracle** that validates both sides at once — a node-gi program built `--app node` runs on the shim byte-identical to the same source under native GJS.

## Getting started

```bash
gjsify install @gjsify/napi
```

Installing through the `gjsify` CLI puts the shim's typelib on `GI_TYPELIB_PATH` for you. From then on a normal native-addon import **just works** in a `gjsify build --app gjs` build — no wrapper, no manual `loadAddon`:

```ts
import Database from 'better-sqlite3'; // require('bufferutil') / etc.

const db = new Database(':memory:');
```

Under the hood the `napiNodeAddonPlugin` (in `@gjsify/rolldown-plugin-gjsify`, the forward mirror of the `gi://`→`requireGi` rewrite) intercepts the addon's own acquisition helper — `bindings`, `node-gyp-build`, a direct `.node` import, or a napi-rs generated loader (`@node-rs/*`) — and routes the compiled `.node` through `loadAddon`. For the node-gyp-build/bindings case it locates the binary with node-gyp-build's own probe order (`build/Release` → `build/Debug` → `prebuilds/`); for a napi-rs package it detects the generated loader (a package.json `napi`/optionalDependencies signal plus a native-`main` match) and replaces the whole module with `module.exports = loadAddon(<current-platform sibling .node>)`, so the generated `createRequire` loader body never reaches the bundle. It is always-on for `--app gjs` and inert when no native addon is in the graph.

**Escape hatch — `loadAddon(path)`** (shown above) stays available for loading a `.node` by an arbitrary runtime path.

At runtime you additionally need a built `.node` addon to load — compiled locally with a C++ toolchain, or a shipped prebuild, exactly as on Node. See the [package README](https://github.com/gjsify/gjsify/tree/main/packages/napi/napi#readme) for the full API surface and the current addon matrix.

## See also

- [node-gi](/gjsify/projects/node-gi/) — the reverse bridge (GObject-Introspection on Node, Bun and Deno)
- [Runtimes](/gjsify/runtimes/) — how both bridge directions fit the target picture
- [Versioning](/gjsify/versioning/#package-tiers) — the release train and stability model
