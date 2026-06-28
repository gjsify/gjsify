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
> with value marshalling (numbers, booleans, strings, GObjects, enums/flags),
> including **OUT and INOUT parameters** surfaced per the GJS return-tuple
> convention (`[returnValue?, ...outArgs]` — one value bare, several as an Array;
> compound OUT types like arrays/structs are a later milestone);
> construct GObjects and read/write properties (GValue round-trip); connect /
> emit / disconnect signals (incl. detailed names like `notify::prop`); and
> **register GObject subclasses** (subtype + construct-by-type, inheriting the
> parent's properties/methods, plus **custom properties + signals** declared on
> the subclass). Ownership rides
> N-API finalizers (no V8-GC reentrancy). On top of the engine, an **L1
> GJS-compatibility layer** (`@gjsify/node-gi/gi`, `requireGi`) surfaces a
> GJS-shaped namespace: `new Gio.SimpleAction({ name })`, `action.name` property
> access, `action.get_name()` methods, `.connect()/.emit()/.disconnect()`, and
> enums / flags / constants (`Gio.BusType.SESSION`, `GLib.PRIORITY_DEFAULT`);
> constructor/static methods (`Gio.File.new_for_path(...)`); and both snake_case
> and camelCase accessors. The L1 layer also surfaces a **GJS-shaped
> `GObject.registerClass(meta, class)` decorator** (with `GObject.ParamSpec` /
> `ParamFlags` / `SignalFlags`): a JS `class extends GObject.Object { … }` with
> `Properties` / `Signals` / `vfunc_*` methods becomes a constructor whose
> instances carry both the user methods and the GObject property/signal surface.
> A **libuv↔GLib mainloop bridge** (`startMainLoop`,
> auto-attached by `requireGi`) nests Node's libuv loop inside the GLib loop, so a
> blocking `GLib.MainLoop.run()` keeps Node's timers/I/O alive — including the
> **boxed/struct slice** that needs (`GLib.MainLoop.new(...)` → a boxed handle →
> `.run()`/`.quit()`). **JS functions marshal as GI callbacks** via an ffi
> closure (`GLib.timeout_add`/`idle_add` fire from the loop, the boolean return
> drives source continuation; the hidden user_data/destroy slots are auto-filled).
> register GObject subclasses (subtype + construct-by-type, inheriting the
> parent's properties/methods, plus **custom properties + signals**, plus
> **vfunc overrides** — a JS function overriding a parent GObject vfunc, hooked
> into the new type's class vtable). The gjsify `--app node` bundler integration
> already rewrites `gi://` onto the L1 layer. vfunc **chain-up** to the parent
> implementation (with the toggle-ref GC bridge) and general struct field access
> land in subsequent drops — for now a vfunc override fully replaces the inherited
> implementation.

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

Declare custom properties and signals on the subclass:

```js
import { registerClass, constructType, getProperty, setProperty,
         connectSignal, emitSignal } from '@gjsify/node-gi';

const Counter = registerClass('Counter', 'GObject', 'Object', {
  properties: [{ name: 'count', type: 'int', default: 0, minimum: 0, maximum: 100 }],
  signals: [{ name: 'changed', paramTypes: ['int'] }],
});

const c = constructType(Counter, { count: 1 });
connectSignal(c, 'notify::count', (pspec) => console.log('changed:', pspec.name));
connectSignal(c, 'changed', (n) => console.log('count is now', n));
setProperty(c, 'count', 5);          // fires notify::count
emitSignal(c, 'changed', [5]);
console.log(getProperty(c, 'count')); // 5
```

Override a parent GObject vfunc with a JS function (the override runs as a method
on the instance — `this` is the GObject handle). Chain-up to the parent vfunc
lands in a later drop, so an override fully replaces the inherited implementation:

```js
import { registerClass, constructType, getProperty } from '@gjsify/node-gi';

const Greeter = registerClass('Greeter', 'Gio', 'SimpleAction', {
  vfuncs: {
    // GObject's `constructed` vfunc — runs once, after construct properties are
    // set. `name` is a CONSTRUCT_ONLY property already available on `this`.
    constructed() {
      console.log('constructed:', getProperty(this, 'name'));
    },
  },
});

constructType(Greeter, { name: 'greet' }); // logs "constructed: greet"
```

### L1 — GJS-shaped surface (`@gjsify/node-gi/gi`)

The ergonomic layer the gjsify `--app node` build rewrites `gi://` imports onto.
This is the same code you would write under GJS:

```js
import { requireGi } from '@gjsify/node-gi/gi';

const GLib = requireGi('GLib', '2.0');
console.log(GLib.get_host_name());

const Gio = requireGi('Gio', '2.0');
const action = new Gio.SimpleAction({ name: 'greet', enabled: true });
console.log(action.name);          // 'greet'   (property accessor)
console.log(action.get_name());    // 'greet'   (method)
action.enabled = false;            // property set → set_property

const c = new Gio.Cancellable();
c.connect('cancelled', () => console.log('cancelled'));
c.cancel();                        // fires the signal

// enums, flags and constants (GJS-style UPPER_CASE members)
console.log(GLib.PRIORITY_DEFAULT);        // 0
console.log(Gio.BusType.SESSION);          // 2
console.log(Gio.ApplicationFlags.HANDLES_OPEN);  // 4

// constructor/static methods + camelCase aliases
const file = Gio.File.new_for_path('/usr/bin/gjs');
console.log(file.get_path());      // '/usr/bin/gjs'
console.log(file.getBasename());   // 'gjs'  (camelCase alias)

// mainloop: a blocking GLib loop, with Node's libuv kept alive underneath
const loop = GLib.MainLoop.new(null, false);
setTimeout(() => loop.quit(), 100); // a libuv timer that fires during run()
loop.run();                         // blocks like under GJS; returns on quit()

// GI callbacks: a JS function passed where a GI callback is expected. The
// GLib source fires from the loop; returning false (G_SOURCE_REMOVE) stops it.
const ticker = GLib.MainLoop.new(null, false);
let n = 0;
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
  if (++n >= 3) { ticker.quit(); return false; }
  return true;
});
ticker.run();
```

The mainloop bridge (`startMainLoop`) is auto-attached the first time `requireGi`
loads a namespace, so `GLib.MainLoop.run()` / `Gio.Application.run()` block as
they do under GJS while Node's timers, I/O and signal handlers keep running.

#### `GObject.registerClass` (GJS-shaped decorator)

`requireGi('GObject')` carries the GJS runtime statics — `registerClass`,
`ParamSpec`, `ParamFlags`, `SignalFlags` — layered over the introspected
namespace, so you subclass a GObject the same way you would under GJS:

```js
const GObject = requireGi('GObject', '2.0');

const Counter = GObject.registerClass(
  {
    GTypeName: 'Counter',
    Properties: {
      // CONSTRUCT so the value is set before vfunc_constructed runs.
      count: GObject.ParamSpec.int(
        'count', 'Count', 'A counter',
        GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
        0, 100, 0,
      ),
    },
    Signals: { 'changed': { param_types: ['int'] } },
  },
  class Counter extends GObject.Object {
    increment() { this.count += 1; this.emit('changed', this.count); }
    vfunc_constructed() { /* runs during construction; `this` is the instance */ }
  },
);

const c = new Counter({ count: 5 });
c.connect('changed', (n) => console.log('now', n));
c.increment();          // logs "now 6"
console.log(c.count);   // 6  (custom property)
```

`new Counter(props)` constructs the GObject (`constructType`) and wraps it so the
user class's own prototype methods resolve FIRST, then the GObject property/signal
surface. `registerClass(class)` (no meta) is also accepted; the GTypeName then
defaults to the class name. The parent namespace/type is read from the class's
`extends` (its `$gtypeName`), so it works for both `GObject.Object` and real GI
classes (`class extends Gio.SimpleAction { … }`).

Caveats (this is the no-toggle-ref object model): the user class's JS constructor
body is not run — GObject-idiomatic init belongs in `vfunc_constructed`;
instances are Proxies over a native handle (not real `instanceof` instances);
**plain (non-GObject-property) JS instance fields do NOT cross the
vfunc↔instance boundary** — inside a vfunc, `this` is a distinct wrapper over the
same GObject (the native engine mints a fresh handle per call, so there is no
shared per-instance JS object yet), so use GObject **properties** for any state
that must be visible both inside a vfunc and on the instance (those live in C and
are consistent; the unified instance identity arrives with the toggle-ref work);
a JS↔GObject reference cycle on a custom instance leaks (the same cycle-leak
caveat the signal/vfunc layer carries); and multi-level registered subclass
chains (registering a subclass of a registered subclass) are not yet supported.

### GJS ambient globals (`@gjsify/node-gi/globals`)

GJS source relies on globals that exist implicitly under `gjs` — `print`,
`printerr`, `log`, `logError`, `ARGV`, and the legacy `imports` object. Importing
`@gjsify/node-gi/globals` (a side effect) installs Node-backed equivalents that
route through the same backend:

```js
import '@gjsify/node-gi/globals';

print('hello', 1, true);                 // → stdout, GJS String()-join
const GLib = imports.gi.GLib;            // legacy imports.gi (honours .versions)
imports.gi.versions.Gtk = '4.0';
console.log(imports.gettext.gettext('x')); // no-translation passthrough
```

A follow-up `--app node` build step will inject this automatically for any
bundle that references those globals (so `const Gtk = imports.gi.Gtk` /
`print(...)` GJS source runs unmodified on Node); today it is an explicit import.

The remaining GJS-compatible surface (`import GLib from 'gi://GLib?version=2.0'`,
`const GLib = imports.gi.GLib`, the core overrides, `_promisify`, the legacy
`imports.*` modules) is layered on top of this engine in the gjsify bundler
integration and subsequent drops.
