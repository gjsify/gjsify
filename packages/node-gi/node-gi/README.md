# @gjsify/node-gi

**GObject-Introspection runtime for Node.js** — the native engine that lets
unchanged GJS / GObject-Introspection code run under Node.js, the inverse of
gjsify's Node/Web/DOM → GJS direction.

It loads `gi://` namespaces (GLib, GObject, Gio, Gtk, Adw, …) via
`libgirepository` and exposes them with GJS-compatible semantics, so the same
source builds and runs on both GJS and Node via `gjsify build --app {gjs,node}`.

> **Status: product (Tier 2 —
> [ADR 0005](../../../docs/adr/0005-node-gi-scope.md)).** node-gi graduated
> from Tier 3 on 2026-07-14 once the four gate items landed: the
> toggle-ref/multi-env teardown crash fixed, vfunc OUT/INOUT chain-up, the
> GTK/Cairo layer, and a second real consumer (`@gjsify/sqlite`'s suite runs on
> node-gi). Best-effort now: tested, released on the train, breaking changes ship
> with a minor + changelog note. **Dependency isolation is still an invariant:**
> no Tier-1/2 `@gjsify/*` package may take a hard dependency (`dependencies` /
> `optionalDependencies`) on `@gjsify/node-gi` — the reverse bridge would double
> the runtime test matrix. The sanctioned seams stay a devDependency
> (`--runtime node` dev flows, the `@gjsify/sqlite` consumer) and the conditional
> `--app node` build injection — enforced by `scripts/audit-runtimes.mjs` in CI.

## Provenance

Derived from [node-gtk](https://github.com/romgrk/node-gtk) (romgrk and
contributors, MIT) — vendored and rewritten under MIT (see `LICENSE`). The
native binding is **retargeted to `girepository-2.0`** (the GIRepository merged
into GLib ≥ 2.80); the standalone `libgirepository-1.0` node-gtk linked is no
longer shipped on modern systems. GJS's own `gi/repo.cpp` is the reference for
the `girepository-2.0` API surface. node-gtk's own examples and tests are **not**
vendored as-is — gjsify ships its own dual (GJS + Node) example/test infra.

## Requirements

- **Node.js ≥ 20, Bun ≥ 1.3, or Deno ≥ 2** — the engine is a Node-API addon, so
  ONE binary serves all three (see [Runtimes](#runtimes-node--bun--deno)).
- **No C++ toolchain on the four prebuilt targets.** The published tarball ships
  `prebuilds/<platform>-<arch>/node_gi.node` for `linux-x64`, `linux-arm64`,
  `darwin-arm64` and `win32-x64` (`package.json#gjsify.platforms`), and the
  `install` script (`scripts/install.mjs`) uses it instead of building: a source
  build is the FALLBACK for a host with no prebuild, not the default. Force it
  with `NODE_GI_BUILD_FROM_SOURCE=1` (or npm's `--build-from-source`); skip it
  entirely with `NODE_GI_SKIP_NATIVE_BUILD=1`.
- For a source build only: a C++ toolchain (`g++`/`clang`, `make`), `node-gyp`,
  and GLib ≥ 2.80 development headers exposing `girepository-2.0` + cairo
  (Fedora: `glib2-devel gobject-introspection-devel cairo-devel gcc-c++`;
   Debian/Ubuntu: `libglib2.0-dev libgirepository-2.0-dev libcairo2-dev g++`)
- At runtime, the target libraries' typelibs must be installed (same as `gi://`
  under GJS). A distro GTK on Linux needs no env wiring at all; on **macOS (both
  arm64 and Intel x64) and Windows x64** a batteries-included, relocated GTK/GI
  runtime bundle ships instead, so `gi://` works with no Homebrew/gvsbuild GTK.
  node-gi auto-detects a bundle at load and prepends its typelib dir to the
  GIRepository search path (`gtk-runtime.js`) — nothing in that loader keys on a
  specific target, so each new bundle is found by the mechanism that found the
  first. The loader contract and the per-platform measurements are
  [docs/node-gi-platform-notes.md](../../../docs/node-gi-platform-notes.md).

## Install

```bash
npm install @gjsify/node-gi
```

**On macOS and Windows the GTK runtime bundle is a MANUAL install today.**
[`@gjsify/gtk-runtime-darwin-arm64`](../gtk-runtime-darwin-arm64),
[`@gjsify/gtk-runtime-darwin-x64`](../gtk-runtime-darwin-x64) and
[`@gjsify/gtk-runtime-win32-x64`](../gtk-runtime-win32-x64) are published, and
node-gi finds whichever one is present in the tree — but **no package declares
them as a dependency**, so nothing installs them for you. Install the one for
your platform alongside node-gi:

```bash
npm install @gjsify/gtk-runtime-win32-x64      # Windows x64
npm install @gjsify/gtk-runtime-darwin-arm64   # macOS Apple silicon
npm install @gjsify/gtk-runtime-darwin-x64     # macOS Intel
```

All three declare `os`/`cpu`, so npm/yarn/pnpm skip them off-platform. Making them
`optionalDependencies` of this package (which would remove the manual step
without any consumer-side platform branching) is pending two decisions outside
this package — the ADR-0003 dependency-direction rule between node-gi's tier
and the bundles', and `os`/`cpu` filtering in `gjsify install`'s native
backend, which currently places foreign-platform optional deps.

## Usage

`requireGi` hands you a GJS-shaped namespace: the same code you would write
under GJS, property accessors, methods, signals, enums and constructors
included.

```js
import { requireGi } from '@gjsify/node-gi/gi';

const GLib = requireGi('GLib', '2.0');
console.log(GLib.get_host_name());

const Gio = requireGi('Gio', '2.0');
const action = new Gio.SimpleAction({ name: 'greet', enabled: true });
console.log(action.name);         // 'greet'  — property accessor
console.log(action.get_name());   // 'greet'  — introspected method
action.enabled = false;           // property set → set_property

const cancellable = new Gio.Cancellable();
cancellable.connect('cancelled', () => console.log('cancelled'));
cancellable.cancel();             // fires the signal

console.log(Gio.BusType.SESSION); // 2 — enums, flags and constants
const file = Gio.File.new_for_path('/usr/bin/gjs');
console.log(file.get_path());     // '/usr/bin/gjs'
```

An existing GJS program needs no edit: built with `gjsify build --app node`, an
`import Gio from 'gi://Gio?version=2.0'` is rewritten onto `requireGi` for you,
and the ambient GJS globals (`print`, `imports`, `ARGV`) are injected when the
bundled output still references them.

No explicit main loop is required for async work — `requireGi` arms the
GLib↔event-loop bridge on the first namespace load, so an `await`ed Gio async
op settles from the runtime's own loop, while a blocking `GLib.MainLoop.run()`
keeps Node's timers and I/O alive the way it does under `gjs -m`.

The whole surface — `GObject.registerClass`, `GLib.Variant`, the DBus client and
export halves, the legacy `imports.*` modules, cairo, and the measured
divergences from GJS — is
[docs/node-gi-gjs-surface.md](../../../docs/node-gi-gjs-surface.md).

## Runtimes (Node / Bun / Deno)

The engine is a **Node-API** addon, so the same binary loads and runs on **Node,
Bun and Deno** — Node-API is their common native ABI (no separate bindings, no Rust
rewrite). `index.js` detects the runtime and prefers a shipped
`prebuilds/<platform>-<arch>/node_gi.node` over a local `build/` (Deno runs no
postinstall build, so a prebuild is its only install path — stage one with
`npm run build:prebuild`).

| Capability | Node | Bun | Deno |
|---|:--:|:--:|:--:|
| introspection, marshalling, enums, variants | ✅ | ✅ | ✅ |
| GObject create / properties / signals | ✅ | ✅ | ✅ |
| `registerClass` / subclass / vfunc chain-up | ✅ | ✅ | ✅ |
| toggle-ref GC + cross-thread teardown | ✅ | ✅ | ✅ |
| GLib async with NO mainloop (timeouts, GIO async, DBus) | ✅ auto | via `startMainContextPump` | via `startMainContextPump` |
| blocking `GLib.MainLoop.run()` / `Gio.Application.runAsync()` | ✅ | ✅ | ✅ |
| Promise continuations drain **during** a blocking GLib loop (async DBus replies, `await` chains) | ✅ | ✅ | ✅ |
| Node timers/I/O alive **during** a blocking GLib loop (uv co-pump) | ✅ | — | — |

Two libuv-coupled subsystems are what make that portable: the toggle-ref
teardown drain uses a `napi_threadsafe_function` (core Node-API) rather than a raw
`uv_async_t`, and the main loop runs both directions — Node co-pumps libuv during
a blocking GLib loop and dispatches pending GLib sources from its own loop when
none runs, while Bun/Deno iterate the default GLib context from a runtime timer
(`startMainContextPump` from `@gjsify/node-gi/gi`, auto-armed by `requireGi`).

Bun reaches full parity with Node on the core surface; Deno passes the same
conformance subset since 2.9 (the marshalling/async N-API quirks that excluded
`arrays`/`async-error` on Deno 2.1 are fixed upstream) — the Node-only co-pump
cases are the remaining, by-design gap. The authoritative full suite runs on Node.

**The measured detail lives one hop away:** the hand-measured `linux-arm64` /
musl / Bun / Deno numbers, the darwin dyld loader gap (why
`Failed to load shared library 'libgtk-4.1.dylib' referenced by the typelib` is
never a node-gi defect), and the GTK runtime bundles are
[docs/node-gi-platform-notes.md](../../../docs/node-gi-platform-notes.md).

## Build & test

```bash
npm install    # prebuild if one is staged, else node-gyp (scripts/install.mjs)
npm test       # node --test — the full suite on Node, the authoritative one
npm run test:bun         # conformance subset on Bun   (needs `bun`)
npm run test:deno        # conformance subset on Deno  (needs `deno`)
npm run test:conformance # the gjs × node × bun × deno golden-diff matrix
```

**In a checkout a staged prebuild shadows your local build**, so every `test*`
script pins `NODE_GI_NATIVE=build`; an ad-hoc probe must too. The full
contributor picture — the load order and its env vars, the toggle-ref debug
seams, the golden-diff conformance contract, the GJS installed-tests port, and
the display capstones with the exact environment each one needs — is
[docs/node-gi-verification.md](../../../docs/node-gi-verification.md).

## Further reading

| | |
|---|---|
| the GJS-compatible surface, in full | [docs/node-gi-gjs-surface.md](../../../docs/node-gi-gjs-surface.md) |
| build, test, conformance, display capstones | [docs/node-gi-verification.md](../../../docs/node-gi-verification.md) |
| cross-runtime, darwin/win32 loading, GTK bundles | [docs/node-gi-platform-notes.md](../../../docs/node-gi-platform-notes.md) |
| the engineering rules for this tree | [packages/node-gi/AGENTS.md](../AGENTS.md) |
| scope + tier decision | [ADR 0005](../../../docs/adr/0005-node-gi-scope.md) |
