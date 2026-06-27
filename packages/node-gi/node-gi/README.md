# @gjsify/node-gi

**GObject-Introspection runtime for Node.js** — the native engine that lets
unchanged GJS / GObject-Introspection code run under Node.js, the inverse of
gjsify's Node/Web/DOM → GJS direction (see the gjsify `AGENTS.md`
`### Axis 5 active track`).

It loads `gi://` namespaces (GLib, GObject, Gio, …) via `libgirepository` and
exposes them with GJS-compatible semantics, so the same source builds and runs
on both GJS and Node via `gjsify build --app {gjs,node}`.

> **Status: milestone 1 (headless core) — scaffold.** This first drop proves the
> native toolchain and the modern `girepository-2.0` API end to end: resolve the
> default repository, `require` a namespace, read its resolved version + info
> count, and enumerate top-level info names. Value marshalling, GObject classes /
> signals / the GC ownership model, `GObject.registerClass`, and the
> libuv↔GLib mainloop bridge land in subsequent drops.

## Provenance

Derived from [node-gtk](https://github.com/romgrk/node-gtk) (romgrk and
contributors, MIT) — vendored and rewritten under MIT (see `LICENSE`). The
native binding is **retargeted to `girepository-2.0`** (the GIRepository merged
into GLib ≥ 2.80); the standalone `libgirepository-1.0` node-gtk linked is no
longer shipped on modern systems. GJS's own `gi/repo.cpp` is the reference for
the `girepository-2.0` API surface. node-gtk's own examples and tests are **not**
vendored as-is — gjsify ships its own dual (GJS + Node) example/test infra.

## Requirements

- Node.js ≥ 20
- A C++ toolchain (`g++`/`clang`, `make`), `node-gyp`
- GLib ≥ 2.80 development headers exposing `girepository-2.0`
  (Fedora: `glib2-devel gobject-introspection-devel gcc-c++`;
   Debian/Ubuntu: `libglib2.0-dev libgirepository-2.0-dev g++`)
- At runtime, the target libraries' typelibs must be installed (same as `gi://`
  under GJS).

## Build & test

```bash
npm install          # builds the native addon via node-gyp (install script)
npm test             # node --test (smoke tests)
# or rebuild explicitly:
npm run rebuild
```

## Usage (milestone 1)

```js
import { requireNamespace, listInfoNames } from '@gjsify/node-gi';

const glib = requireNamespace('GLib', '2.0');
console.log(glib);                // { namespace: 'GLib', version: '2.0', infoCount: <n> }
console.log(listInfoNames('GLib').includes('MainLoop')); // true
```

The GJS-compatible surface (`import GLib from 'gi://GLib?version=2.0'`,
`const GLib = imports.gi.GLib`, the core overrides, signals, `registerClass`,
`_promisify`, the mainloop) is layered on top of this engine in the
`@gjsify/*` runtime packages and the gjsify bundler integration.
