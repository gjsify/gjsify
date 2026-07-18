---
title: node-gi
description: Run unchanged GJS / GObject-Introspection code on Node.js, Bun and Deno — the reverse bridge. One source builds and runs on GJS and every Node-API runtime.
---

[`@gjsify/node-gi`](https://github.com/gjsify/gjsify/tree/main/packages/node-gi/node-gi) is the **reverse** of the rest of GJSify: instead of bringing Node/Web APIs to GJS, it brings **GObject-Introspection to Node.js, Bun and Deno**. The same unchanged `gi://` source builds and runs natively under GJS *and* on every Node-API runtime — no code changes.

:::note[Stability]
node-gi is tested and released together with every GJSify release, and real consumers exercise it — `@gjsify/sqlite`'s own test suite runs on it. It is still a **younger part of the framework** than the GJS side, so a breaking change may occasionally ship in a minor release (always with a changelog note). Regular GJS apps are unaffected either way: no GJSify package depends on node-gi at runtime. Details in the [stability model](/gjsify/versioning/#package-tiers).
:::

## One source, every runtime

```
gjsify build app.ts --app gjs    → gjs                  -m dist/app.gjs.mjs   (native gi://)
gjsify build app.ts --app node   → node | bun | deno       dist/app.node.mjs  (@gjsify/node-gi)
```

The `gjsify` bundler keeps `gi://` imports native for the GJS target and rewrites them onto the node-gi runtime (`requireGi`) for the Node target. Because node-gi is a **Node-API** addon, the *same* `--app node` bundle runs on Node, Bun and Deno — Node-API is their common native ABI, so there is no separate `--app deno`/`--app bun` target and no separate binding to maintain.

```ts
// The same file for gjs, node, bun and deno.
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const action = new Gio.SimpleAction({ name: 'greet', enabled: true });
action.connect('notify::enabled', () => print('changed'));
action.set_enabled(false);

const file = Gio.File.new_for_path('/usr/share');
print(file.get_basename()); // "share"
```

## Runtimes

The engine is one Node-API binary that loads on all four supported runtimes. `index.js` detects the runtime and prefers a shipped `prebuilds/<platform>-<arch>/` binary (Deno runs no postinstall build, so a prebuild is its only install path).

| Capability | GJS | Node | Bun | Deno |
|---|:--:|:--:|:--:|:--:|
| introspection, marshalling, enums, variants | ✅ | ✅ | ✅ | ✅ |
| GObject create / properties / signals | ✅ | ✅ | ✅ | ✅ |
| `registerClass` / subclass / vfunc chain-up | ✅ | ✅ | ✅ | ✅ |
| toggle-ref GC + cross-thread teardown | ✅ | ✅ | ✅ | ✅ |
| GLib async (timeouts, GIO async, DBus) | ✅ | ✅ | ✅ | ✅ |
| blocking `GLib.MainLoop.run()` / `runAsync()` | ✅ | ✅ | ✅ | ✅ |
| GTK / Adwaita GUI apps | ✅ | ✅ | — | — |

GJS is the reference implementation (native `gi://`). On Node the libuv↔GLib bridge keeps Node's own event loop alive during a blocking GLib loop; on Bun and Deno a portable GLib-iteration pump (`startMainContextPump`) co-pumps GLib from the runtime timer instead. Bun and Deno both reach the conformance subset (the Deno-2.1-era N-API quirks were fixed upstream in Deno 2.9); the one Node-only row is keeping Node's timers alive *during* a blocking GLib loop. The GObject-Introspection conformance oracle (a port of GJS's own `GIMarshallingTests`) runs **byte-identical on gjs / node / bun / deno**.

## How it works

Two libuv-coupled subsystems are made portable so one binary spans all four runtimes:

- **GC bridge** — the toggle-ref teardown drain uses a Node-API `napi_threadsafe_function` rather than a raw `uv_async_t` (Deno exports no libuv symbols; Bun does not yet implement `uv_async_init`).
- **Main loop** — Node keeps the uv-nesting bridge that co-pumps its event loop during a blocking GLib loop; Bun/Deno iterate the default GLib context from a runtime timer, so GIO async callbacks / GLib timeouts / DBus fire while the runtime's own loop stays live.

The native engine is vendored from [node-gtk](https://github.com/romgrk/node-gtk) (MIT, credits retained), ported to Node-API and retargeted to the modern GLib-integrated `girepository-2.0` API. GJS's own `gi/repo.cpp` is the reference for matching GJS semantics.

## Cross-runtime testing

The [example](https://github.com/gjsify/gjsify/tree/main/packages/node-gi/example) is the capstone proof: several deterministic `gi://` sources each build `--app gjs` (native) and `--app node`, then run under GJS, Node, Bun and Deno with the harness asserting **byte-identical** output on every runtime (GJS as the reference). It runs in CI on Fedora across all four.

## Getting started

```bash
npm install @gjsify/node-gi
```

Requires a C++ toolchain plus the GLib ≥ 2.80 / `girepository-2.0` development headers to build the native addon, and the target library typelibs installed at runtime (the same requirement as `gi://` under GJS). See the [package README](https://github.com/gjsify/gjsify/tree/main/packages/node-gi/node-gi#readme) for the full API and the Deno `--node-modules-dir=manual` note.

## See also

- [Runtimes](/gjsify/runtimes/) — how the reverse bridge fits GJSify's overall target picture
- [Versioning](/gjsify/versioning/#package-tiers) — the release train and stability model
- [Storybook](/gjsify/guides/storybook/) — `gjsify storybook --runtime node`, the canonical consumer
