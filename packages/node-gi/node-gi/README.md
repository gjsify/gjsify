# @gjsify/node-gi

**GObject-Introspection runtime for Node.js** — the native engine that lets
unchanged GJS / GObject-Introspection code run under Node.js, the inverse of
gjsify's Node/Web/DOM → GJS direction (see the gjsify `AGENTS.md`
`### Axis 5 active track`).

It loads `gi://` namespaces (GLib, GObject, Gio, …) via `libgirepository` and
exposes them with GJS-compatible semantics, so the same source builds and runs
on both GJS and Node via `gjsify build --app {gjs,node}`.

> **Status: milestone 1 (headless core) — in progress.** The native engine over
> the modern `girepository-2.0` API now does: resolve the default repository,
> `require` a namespace, enumerate its infos; call namespace-level functions and
> **instance methods** (own + implemented-interface methods, up the parent chain)
> with value marshalling (numbers, booleans, strings, GObjects, enums/flags);
> construct GObjects and read/write properties (GValue round-trip); connect /
> emit / disconnect signals; and **register GObject subclasses** (subtype +
> construct-by-type, inheriting the parent's properties/methods). Ownership rides
> N-API finalizers (no V8-GC reentrancy). Custom properties/signals on a subclass
> and `registerClass` vfunc overrides + chain-up (with the toggle-ref GC bridge)
> and the libuv↔GLib mainloop bridge land in subsequent drops, then the
> GJS-compatible runtime + bundler integration on top.

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
import {
  requireNamespace, listInfoNames, callFunction,
  newObject, getProperty, setProperty, callMethod,
  connectSignal, emitSignal,
} from '@gjsify/node-gi';

requireNamespace('GLib', '2.0');
console.log(listInfoNames('GLib').includes('MainLoop')); // true
console.log(callFunction('GLib', 'get_host_name'));      // namespace function

requireNamespace('Gio', '2.0');
const action = newObject('Gio', 'SimpleAction', { name: 'greet', enabled: true });
console.log(getProperty(action, 'name'));     // 'greet'  (GValue round-trip)
console.log(callMethod(action, 'get_name'));  // 'greet'  (interface method)
callMethod(action, 'set_enabled', [false]);   // method with an IN argument

const c = newObject('Gio', 'Cancellable', {});
connectSignal(c, 'cancelled', () => console.log('cancelled'));
emitSignal(c, 'cancelled');
```

Register a GObject subclass and construct it (inherited properties + methods):

```js
import { registerClass, constructType, callMethod } from '@gjsify/node-gi';

const MyAction = registerClass('MyAction', 'Gio', 'SimpleAction');
const a = constructType(MyAction, { name: 'greet', enabled: true });
console.log(callMethod(a, 'get_name')); // 'greet'  (inherited GAction method)
```

The GJS-compatible surface (`import GLib from 'gi://GLib?version=2.0'`,
`const GLib = imports.gi.GLib`, the core overrides, signals, `registerClass`,
`_promisify`, the mainloop) is layered on top of this engine in the
`@gjsify/*` runtime packages and the gjsify bundler integration.
