---
title: node-gi
description: Run unchanged gi:// and GObject code on Node.js, Bun and Deno. The reverse bridge, so one source builds for GJS and for every Node-API runtime.
---

[`@gjsify/node-gi`](https://github.com/gjsify/gjsify/tree/main/packages/node-gi/node-gi) runs the rest of gjsify backwards. Instead of bringing Node and Web APIs to GJS, it brings GObject Introspection to Node.js, Bun and Deno, so the same unchanged `gi://` source runs natively under GJS *and* on every Node-API runtime.

You care about this if your GTK app, or a library that talks to GLib, should run on Node.js, Bun or Deno. Three common reasons: you already work in one of those runtimes and would rather stay in it; you are shipping to Windows, which has no GJS host at all ([Platform Support](/gjsify/platform-support/) explains why); or you want a test suite or a headless tool on the runtime your CI already has. If you build only for GJS you can skip this page, and nothing on the GJS side depends on node-gi at runtime.

:::note[Stability]
node-gi is tested and released with every gjsify release, and real consumers exercise it. It is still a younger part of the framework than the GJS side, so a breaking change occasionally ships in a minor release, always with a changelog note. Details in the [stability model](/gjsify/versioning/#how-much-stability-to-expect).
:::

## One source, every runtime

```
gjsify build app.ts --app gjs    → gjs                dist/app.gjs.mjs   (native gi://)
gjsify build app.ts --app node   → node | bun | deno  dist/app.node.mjs  (@gjsify/node-gi)
```

The bundler keeps `gi://` imports native for the GJS target and rewrites them onto the node-gi runtime for the Node target. Because node-gi is a Node-API addon, the *same* `--app node` bundle runs on Node, Bun and Deno: Node-API is their shared native ABI, so there is no separate `--app deno` or `--app bun` target and no second binding to maintain.

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

## What works on which runtime

One Node-API binary loads on all three runtimes. `index.js` detects the runtime and prefers a shipped `prebuilds/<platform>-<arch>/` binary. Deno runs no postinstall build, so a prebuild is its only install path.

GJS is the reference implementation, with native `gi://`. That is a statement about the test rig: the conformance harness runs each program on all four runtimes and diffs the other three against the GJS output byte for byte, so "reference" means "the expected answer here", not "the runtime to choose". Against it:

| Capability | Node | Bun | Deno |
|---|:--:|:--:|:--:|
| introspection, marshalling, enums, variants | ✅ | ✅ | ✅ |
| GObject create, properties, signals | ✅ | ✅ | ✅ |
| `registerClass`, subclassing, vfunc chain-up | ✅ | ✅ | ✅ |
| toggle-ref GC and cross-thread teardown | ✅ | ✅ | ✅ |
| GLib async with no main loop (timeouts, GIO async, DBus) | ✅ | ✅ | ✅ |
| blocking `GLib.MainLoop.run()` / `Gio.Application.runAsync()` | ✅ | ✅ | ✅ |
| promise continuations drain *during* a blocking GLib loop | ✅ | ✅ | ✅ |
| the runtime's own timers and I/O alive *during* a blocking GLib loop | ✅ | ✗ | ✗ |
| GTK / Adwaita GUI apps | ✅ | ✅ | ✅ |

The last gap is by design rather than unfinished. On Node, a libuv-to-GLib bridge nests the two loops, so a blocking GLib loop keeps Node's timers running. Bun and Deno have no usable libuv to hook, so they get a portable pump that iterates the default GLib context from a runtime timer. Either way you don't call anything: loading a namespace arms whichever mechanism the runtime needs, and `await`ing a Gio async call works with no explicit main loop.

GUI support is portable because a blocking `Gtk.Application.run()` is driven by GLib, not by the host's event loop. A real `Gtk.Application` builds an Adwaita window (`Adw.ToolbarView`, `Adw.HeaderBar`, `Adw.StatusPage`), applies a `Gtk.CssProvider` and exits 0 on gjs, node, bun and deno. CI gates that on all of them under xvfb, and the conformance oracle (a port of GJS's own `GIMarshallingTests`) runs byte-identical across the four.

:::caution[One known gap in GTK apps]
A GTK app driven through node-gi intermittently logs `Gtk-CRITICAL **: gtk_event_controller_handle_crossing: assertion 'GTK_IS_EVENT_CONTROLLER (controller)' failed`, and the process can go down mid-frame when it does. It is nondeterministic, so a clean run proves nothing: three consecutive showcase runs produced one, six and one on Node, with Bun behaving the same way and Deno clean in that sample. If you hit it, it is a known lifetime bug in the bridge rather than something in your code.
:::

## Platforms

The operating system axis is separate from the runtime axis above, and `prebuilds/<platform>-<arch>/` carries a binary per platform *and* arch. What CI proves, named rather than generalised:

- **Linux.** The full path: native `gi://` on GJS plus node-gi on Node, Bun and Deno, GTK and Adwaita GUIs, and the whole conformance suite against the system GTK.
- **macOS, Apple silicon and Intel.** node-gi builds and passes the display-free conformance suite on Node, Bun and Deno, and the GTK GUI renders (render to texture, no visible desktop): an `Adw.ApplicationWindow` realizes, renders and reacts to input. [`@gjsify/gtk-runtime-darwin-arm64`](https://www.npmjs.com/package/@gjsify/gtk-runtime-darwin-arm64) and [`@gjsify/gtk-runtime-darwin-x64`](https://www.npmjs.com/package/@gjsify/gtk-runtime-darwin-x64) ship a prebuilt GTK 4 and Adwaita closure, so no system GTK and no Homebrew are required. CI proves that on runners where GTK was never installed.
- **Windows, x64.** node-gi builds with MSVC and gvsbuild, and passes the display-free conformance suite on Node. Beyond that, the GTK GUI renders and the full Libadwaita Storybook renders, both proven in CI. [`@gjsify/gtk-runtime-win32-x64`](https://www.npmjs.com/package/@gjsify/gtk-runtime-win32-x64) ships the prebuilt GTK 4 and Adwaita closure, so no gvsbuild is needed to consume it.

So the operating system decides how much choice you have. On Linux both paths are open: native `gi://` under GJS, and node-gi under Node, Bun and Deno. On macOS `--app node` is the supported path, and on Windows it is the only one, since there is no GJS host there. The per-package matrix is in [Platform Support](/gjsify/platform-support/).

## Getting started

```bash
npm install @gjsify/node-gi
```

To build the native addon you need a C++ toolchain (or the shipped prebuild for your platform) and the GLib 2.80 or newer development headers that expose `girepository-2.0`. At runtime you need the typelibs of the libraries you import, the same requirement `gi://` has under GJS. On macOS and Windows the `@gjsify/gtk-runtime-*` package covers that instead, bundling the GTK 4 and Adwaita closure so there is no system GTK to install.

On Deno, run the bundle with `deno run -A --node-modules-dir=manual` so it uses the `node_modules` you already installed. Under `--node-modules-dir=auto` Deno re-resolves the whole build-time dependency tree, including platform binaries nothing at runtime imports, and that either hangs or needs registry access you may not have. The [package README](https://github.com/gjsify/gjsify/tree/main/packages/node-gi/node-gi#readme) covers requirements and install; the [GJS-compatible surface reference](https://github.com/gjsify/gjsify/blob/main/docs/node-gi-gjs-surface.md) has the full API, and the [platform notes](https://github.com/gjsify/gjsify/blob/main/docs/node-gi-platform-notes.md) the rest of the Deno notes.

## How it works

Two libuv-coupled subsystems were made portable so one binary spans every runtime:

- **The GC bridge.** The toggle-ref teardown drain uses a Node-API `napi_threadsafe_function` rather than a raw `uv_async_t`, because Deno exports no libuv symbols and Bun does not implement `uv_async_init`.
- **The main loop.** Node keeps the uv-nesting bridge that co-pumps its event loop during a blocking GLib loop. Bun and Deno iterate the default GLib context from a runtime timer instead, so GIO async callbacks, GLib timeouts and DBus fire while the runtime's own loop stays live.

The native engine is derived from [node-gtk](https://github.com/romgrk/node-gtk) (MIT, credits retained), ported to Node-API and retargeted to the modern GLib-integrated `girepository-2.0` API. GJS's own `gi/repo.cpp` is the reference for matching GJS semantics.

## How it is tested

The [example](https://github.com/gjsify/gjsify/tree/main/packages/node-gi/example) is the capstone: several deterministic `gi://` sources each build `--app gjs` and `--app node`, then run under GJS, Node, Bun and Deno, with the harness asserting byte-identical output on every one and GJS as the reference. The GJS output is not taken on trust either: where a scenario carries a committed golden file, GJS is diffed against that first, and only then do the other three get compared to it. It runs in CI on Fedora across all four.

Nine `@gjsify/*` packages also run their own test suites through node-gi in CI: `sqlite`, `http2`, `zlib`, `tls`, `ws`, `dom-elements`, `node-globals`, `crypto` and `string_decoder`. That is what keeps the bridge honest against real consumer code rather than against tests written for it.

## See also

- [napi](/gjsify/projects/napi/) is the forward bridge: native Node.js `.node` addons inside GJS
- [Runtimes](/gjsify/runtimes/) puts both bridge directions in one picture
- [Versioning](/gjsify/versioning/#how-much-stability-to-expect) covers the release train and the stability model
- [Storybook](/gjsify/guides/storybook/) documents `gjsify storybook --runtime node`, the canonical consumer
