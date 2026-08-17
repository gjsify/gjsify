---
title: napi
description: Load native Node.js N-API addons (.node) inside GJS, so a GJS app can use a database driver or codec straight from npm.
---

[`@gjsify/napi`](https://github.com/gjsify/gjsify/tree/main/packages/napi/napi) lets a GJS app use native npm addons. A compiled `.node` file, the exact binary you would `require()` on Node, loads and runs unchanged under GJS.

You care about this if the library you need exists on npm as a native addon and you don't want to reimplement it in pure JavaScript. A database driver, a hashing library, a codec: install it, import it, and it works in a `gjsify build --app gjs` build with no wrapper on your side.

It is not a way to talk to GObject libraries. On GJS the native [`gi://`](/gjsify/patterns/gobject-classes/) binding stays the way to use GTK, GLib and everything else introspected, and you should always prefer it.

:::note[Stability]
`@gjsify/napi` is experimental (tier 3): a new axis, released on the train but with no stability promise yet. No other gjsify package depends on it, so it can never affect a regular GJS build. See the [stability model](/gjsify/versioning/#how-much-stability-to-expect).
:::

## Install it and import your addon

```bash
gjsify install @gjsify/napi
```

Installing through the `gjsify` CLI puts the shim's typelib on `GI_TYPELIB_PATH` for you. From then on a normal native-addon import works in a `--app gjs` build, with no wrapper and no manual loading:

```ts
import Database from 'better-sqlite3'; // or require('bufferutil'), etc.

const db = new Database(':memory:');
```

The package publishes on the [release train](/gjsify/versioning/) like every other `@gjsify/*` package, with the Linux x64 and macOS arm64 shim prebuilds installed as optional dependencies, so the install brings the shim itself rather than a build recipe.

You still need a built `.node` addon to load: compiled locally with a C++ toolchain, or a prebuild the addon ships, exactly as on Node.

### Loading a `.node` by path

If you need to load an addon from an arbitrary runtime path, `loadAddon` is there:

```ts
import { loadAddon, hasNapi } from '@gjsify/napi';

if (hasNapi()) {
    const sqlite = loadAddon('./build/Release/better_sqlite3.node');
    // `sqlite` is the addon's module.exports, an ordinary object.
    const db = new sqlite.Database(':memory:');
}
```

## What runs today

A golden-diff harness runs a deterministic workout of each addon on Node (the reference) and on GJS through the shim, and requires byte-identical output:

| Addon | Language and codegen | Kind | Result |
|---|---|---|:--:|
| [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) | C, node-addon-api | synchronous | ✅ byte-identical |
| [`bufferutil`](https://github.com/websockets/bufferutil) | C, node-gyp-build | synchronous | ✅ |
| [`utf-8-validate`](https://github.com/websockets/utf-8-validate) | C++, node-gyp-build | synchronous | ✅ |
| [`@node-rs/argon2`](https://github.com/napi-rs/node-rs) | Rust, napi-rs | synchronous | ✅ byte-identical |
| [`node-sqlite3`](https://github.com/TryGhost/node-sqlite3) | C++, node-addon-api | **asynchronous** | ✅ byte-identical |

Those are C, C++ and Rust addons emitted by three different N-API code generators, which is good evidence that an arbitrary *synchronous* addon runs unmodified. `node-sqlite3` additionally drives the async surface (`napi_async_work` plus threadsafe functions), so asynchronous `node-addon-api` packages are reachable too, not only the sync subset.

### Scope

The full synchronous N-API surface is implemented, plus the async and threadsafe-function group. `napi_async_work` runs each addon's `execute` callback on a `GThreadPool` worker (sized after `UV_THREADPOOL_SIZE`, as libuv does) and marshals `complete` back onto the GLib main context, so async addons get real concurrency.

A few Node-specific corners stay stubbed because they have no engine-agnostic meaning on GJS, most notably `napi_get_uv_event_loop`: GJS has no libuv loop, the GLib main context is the loop.

### Platforms

Prebuilt and CI-validated on **Linux x86_64** and **macOS arm64**, the same GJS and mozjs-140 pairing on both. Both prebuilds are rebuilt from the released source on every release and ship as optional dependencies (`@gjsify/napi-linux-x64`, `@gjsify/napi-darwin-arm64`), each carrying a `.so` or `.dylib` plus its `.gir` and `.typelib`.

**Windows** is groundwork only. The loader and build wiring exist behind a manual CI job, but it is blocked upstream: the shim links GJS's SpiderMonkey, and no prebuilt `libgjs` for Windows exists yet. The [package README](https://github.com/gjsify/gjsify/tree/main/packages/napi/napi#readme) has the platform matrix.

## How it works

Node-API is an engine-agnostic C ABI: the same `.node` binary already runs on Node, Deno and Bun. `@gjsify/napi` implements that ABI once more, over GJS's SpiderMonkey engine. The shim ships as a GObject-Introspection package (`.so` plus `.gir` plus `.typelib`), so GJS loads it through `imports.gi` like any other GI library, and it exposes `loadAddon(path)` to `dlopen` an addon and bind its `napi_*` symbols to the shim's implementation.

Your addon is built the normal way, with node-gyp or prebuilds. Nothing about it changes. The work is all on the shim side, and two pieces of it are worth knowing about:

- **Values are handles, not raw engine pointers.** SpiderMonkey has a moving GC, so an `napi_value` is a handle into a per-environment arena of GC-traced slots rather than the engine value itself.
- **Async work is bridged to GLib, not libuv.** Threadsafe-function calls and `napi_async_work` completions dispatch onto the GLib main context through a `g_idle` source, while the `execute` callback runs on a `GThreadPool` worker. There is no separate libuv loop to run.

### How the import gets rewritten

For `--app gjs` builds, a bundler plugin (`napiNodeAddonPlugin`) intercepts the addon's own acquisition helper and routes the compiled `.node` through `loadAddon`. It handles the four conventions a bundler can actually see: a direct `.node` import, `node-gyp-build`, `bindings`, and a napi-rs generated loader.

For the `node-gyp-build` and `bindings` cases it locates the binary with node-gyp-build's own probe order (`build/Release`, then `build/Debug`, then `prebuilds/`), so the GJS build loads the same file Node would. For a napi-rs package it replaces the generated loader module wholesale, because that module's `createRequire` body does not survive bundling. Detection is conservative and falls through to normal resolution when it isn't sure. The plugin is always on for `--app gjs` and does nothing when no native addon is in the graph.

### Building the shim yourself

Outside the two prebuilt platforms, or against a GJS built on a different SpiderMonkey major, build from the sources the tarball ships alongside the prebuilds (`meson.build`, `src/vala`, `src/cc`, `src/napi-headers`):

```bash
cd node_modules/@gjsify/napi
meson setup build . && meson compile -C build
```

That needs `meson`, `vala`, `g-ir-compiler`, a C++ toolchain and the `gjs-1.0` plus `mozjs-140` development headers. Then point `GI_TYPELIB_PATH` (plus `LD_LIBRARY_PATH`, or `DYLD_LIBRARY_PATH` on macOS) at the resulting `build/` directory.

## See also

- [node-gi](/gjsify/projects/node-gi/) is the reverse bridge: GObject Introspection on Node, Bun and Deno
- [Runtimes](/gjsify/runtimes/) puts both bridge directions in one picture
- [Versioning](/gjsify/versioning/#how-much-stability-to-expect) covers the release train and the stability model
