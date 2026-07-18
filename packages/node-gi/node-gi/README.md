# @gjsify/node-gi

**GObject-Introspection runtime for Node.js** — the native engine that lets
unchanged GJS / GObject-Introspection code run under Node.js, the inverse of
gjsify's Node/Web/DOM → GJS direction (see the gjsify `AGENTS.md`
`### Axis 5 active track`).

It loads `gi://` namespaces (GLib, GObject, Gio, …) via `libgirepository` and
exposes them with GJS-compatible semantics, so the same source builds and runs
on both GJS and Node via `gjsify build --app {gjs,node}`.

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
> `.run()`/`.quit()`). The same call arms the **uv-driven auto-pump** for the
> NON-blocking case: pending GLib sources (Gio async completions, GLib
> timeouts/idles, DBus) dispatch from Node's own event loop, so a plain
> `node bundle.mjs` that `await`s a Gio async op needs no explicit mainloop —
> matching GJS, where the GLib loop is the process loop. **JS functions marshal as GI callbacks** via an ffi
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
- **Node.js ≥ 20, Bun ≥ 1.3, or Deno ≥ 2** — the addon is Node-API, so one binary
  runs on all three (see [Runtimes](#runtimes-node--bun--deno)).

## Runtimes (Node / Bun / Deno)

The engine is a **Node-API** addon, so the same binary loads and runs on **Node,
Bun and Deno** — Node-API is their common native ABI (no separate bindings, no Rust
rewrite). `index.js` detects the runtime and prefers a shipped
`prebuilds/<platform>-<arch>/node_gi.node` over a local `build/` (Deno runs no
postinstall build, so a prebuild is its only install path — stage one with
`npm run build:prebuild`).

Two libuv-coupled subsystems are portable across all three:

- **GC bridge** — the toggle-ref teardown drain uses a `napi_threadsafe_function`
  (core Node-API), not node-gtk's raw `uv_async_t` (Deno exports no libuv symbols;
  Bun panics on `uv_async_init`).
- **Main loop** — Node runs BOTH directions: the uv-nesting bridge co-pumps
  Node's own event loop during a blocking GLib loop, and the **uv-driven
  auto-pump** dispatches pending GLib sources from Node's loop when NO blocking
  GLib loop runs (async Gio + `await` just works, no explicit loop). Bun/Deno
  co-pump the non-blocking case by hand, iterating the default GLib context from
  a runtime timer (`startMainContextPump` from `@gjsify/node-gi/gi`), so GIO
  async callbacks / GLib timeouts / DBus fire while the runtime's own loop stays
  live.

| Capability | Node | Bun | Deno |
|---|:--:|:--:|:--:|
| introspection, marshalling, enums, variants | ✅ | ✅ | ✅ |
| GObject create / properties / signals | ✅ | ✅ | ✅ |
| `registerClass` / subclass / vfunc chain-up | ✅ | ✅ | ✅ |
| toggle-ref GC + cross-thread teardown | ✅ | ✅ | ✅ |
| GLib async with NO mainloop (timeouts, GIO async, DBus) | ✅ auto | via `startMainContextPump` | via `startMainContextPump` |
| blocking `GLib.MainLoop.run()` / `Gio.Application.runAsync()` | ✅ | ✅ | ✅ |
| Node timers/promises alive **during** a blocking GLib loop | ✅ | — | — |

Bun reaches full parity with Node on the core surface; Deno passes the same
conformance subset since 2.9 (the marshalling/async N-API quirks that excluded
`arrays`/`async-error` on Deno 2.1 are fixed upstream) — the Node-only co-pump
cases are the remaining, by-design gap. The authoritative full suite runs on Node.

## Build & test

```bash
npm install          # builds the native addon via node-gyp (install script)
npm test             # node --test (full suite, Node — authoritative)
npm run test:gc      # node --test --expose-gc (toggle-ref GC-stress leg)
npm run test:bun     # conformance subset on Bun   (needs `bun`)
npm run test:deno    # conformance subset on Deno  (needs `deno`)
npm run build:prebuild   # node-gyp rebuild + stage prebuilds/<platform>-<arch>/
# or rebuild explicitly:
npm run rebuild
```

The load order prefers a staged `prebuilds/<platform>-<arch>/node_gi.node` over
`build/Release` (the consumer/Deno install path). Local verification always runs
the **just-built** addon instead: the Node test scripts pin `NODE_GI_NATIVE=build`
and the bun/deno runner defaults to it — without that, a stale staged prebuild
silently shadows your build. CI's cross-runtime job sets `NODE_GI_NATIVE=prebuild`
to keep validating the prebuild load path with a freshly staged binary.
`NODE_GI_NATIVE` accepts `build`, `prebuild`, or an explicit path to a
`node_gi.node`.

Two debug-only env vars instrument the toggle-ref / teardown machinery (both
parsed once at first use, zero cost when unset — never set them in production):

- `NODE_GI_TOGGLE_DEBUG=1` — stderr tracing of the GC bridge: owner-env claim,
  drain-TSFN create/release, shutdown-flag flips, teardown enqueue/drop, drain
  runs/skips (with JS-availability), and the C→JS trampoline skips at env
  teardown; each line carries the emitting thread.
- `NODE_GI_TOGGLE_TEARDOWN_DELAY_MS=<n>` — test-only latency seam (clamped to
  10s): the drain defers queued idle teardowns younger than `n` ms (re-waking
  itself), which deterministically parks teardowns — with a pending drain wake —
  across the event loop's exit. That is the regression vehicle for the
  env-cleanup drain race (`test/gc-cross-thread.test.mjs`, "teardown drain
  during env cleanup never aborts").

## Conformance (golden-diff)

The exactness oracle for GJS parity: small self-contained `gi://` programs
under `conformance/programs/*.conf.mjs` run UNCHANGED on all four runtimes —
gjs natively (`gjs -m`, ambient `print`), node/bun/deno via a lightweight
generated runtime twin (the `globals.js` shim + `requireGi`, no bundler) — and
every runtime's **stdout must be byte-identical to the committed golden**
(`conformance/golden/<name>.txt`). **gjs is the reference**: the goldens ARE
the gjs output, and a gjs↔golden drift fails loudly (either GJS changed or the
golden is stale — never paper over it).

```bash
npm run test:conformance                          # full matrix (gjs × node × bun × deno)
node scripts/conformance.mjs --runtimes=gjs,node  # runtime subset (gjs/node never auto-skip)
node scripts/conformance.mjs --filter=variant     # program subset
node scripts/conformance.mjs --update-golden      # regenerate goldens from gjs
```

Adding a program: drop `conformance/programs/<name>.conf.mjs` — default
imports of the exact shape `import Gio from 'gi://Gio?version=2.0';` only
(regex-rewritable to `requireGi`), output via the GJS-ambient `print()`,
strictly deterministic (no versions, paths, hostnames, timing; the runner sets
`LC_ALL=C`), ends cleanly — then `--update-golden`, eyeball the golden for
determinism, and commit both. Every feature PR extends this suite.

The ledger contract (`conformance/ledger.json`) is strict: every known-failing
program×runtime combo is a **committed entry**
`{ "program", "runtime", "reason", "issue"? }` — a failing combo *not* in the
ledger fails the run, and a passing combo still *in* the ledger fails as a
stale entry (remove it). Exit 0 means zero unexpected results; there are no
silent exclusions (bun/deno merely report `skipped` when not installed — gjs
and node never skip).

### Tier B — GJS installed-tests port

The breadth oracle: GJS's own installed-tests
(`refs/gjs/installed-tests/js/testGIMarshalling.js`) encode GJS's marshalling
behavior against the purpose-built `GIMarshallingTests-1.0` typelib.
`gimarshalling/testGIMarshalling.port.mjs` is a near-verbatim port of that
file to `node:test` via a minimal jasmine shim
(`gimarshalling/jasmine-shim.mjs`), mapping the WHOLE upstream surface:
already-green sections run live, everything else is a `describeSkip` stub
naming the upstream section. Assertions are never weakened.

```bash
npm run test:gimarshalling   # builds the pinned typelibs if missing, then runs the port
```

`scripts/build-gi-test-typelibs.mjs` builds the test typelibs reproducibly
from GNOME's gobject-introspection-tests project at the **pinned revision**
GJS itself tests against (`PINNED_REV`, copied from
`refs/gjs/subprojects/gobject-introspection-tests.wrap`) into the gitignored
`.gi-tests/` (meson + ninja required; cairo disabled; Regress builds too).
The launcher (`scripts/gimarshalling.mjs`) sets `GI_TYPELIB_PATH` /
`LD_LIBRARY_PATH` before spawning `node --test` — dlopen cannot pick up late
env changes — and pins `NODE_GI_NATIVE=build`. The port files are named
`*.port.mjs` so the default `npm test` glob never picks them up.

**Skip contract (strict, mirrors the tier-A ledger):** every skipped
spec/suite carries a reason — a phase-2.x roadmap item from the taxonomy at
the top of the port file (e.g. `phase 2.1 BigInt-64-bit`), an upstream issue
URL, or a `FIDELITY-BUG: …` note — and the reason is reported in the
`node:test` output (`# SKIP <reason>`). A bare skip throws (`pending()`,
`itSkip`, `describeSkip` all require the reason; `xit` must chain
`.pend(reason)`). Later marshalling PRs un-skip their sections — this port is
phase 2's acceptance gate.

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

A blocking loop is **optional**: the same call arms the uv-driven auto-pump, so
pending GLib sources dispatch from Node's own event loop too — async Gio work
awaited at top level behaves exactly as under `gjs -m`:

```js
import { requireGi } from '@gjsify/node-gi/gi';

const Gio = requireGi('Gio', '2.0');
const file = Gio.File.new_for_path('/etc/hostname');
// No GLib.MainLoop.run() anywhere: the GTask completion dispatches from Node's
// loop, the in-flight op keeps the process alive, then Node exits normally.
const [ok, contents] = await new Promise((resolve, reject) => {
  file.load_contents_async(null, (_source, res) => {
    try { resolve(file.load_contents_finish(res)); } catch (e) { reject(e); }
  });
});
```

Process-lifetime semantics follow Node conventions: an in-flight async op
(a pending `GAsyncReadyCallback`) and an armed GLib timeout keep the process
alive — like Node's own pending I/O and timers — so a REPEATING GLib timeout
keeps the process running like `setInterval` (under `gjs -m` the process would
instead exit once the module settles; remove the source to release the process).
A *passive* fd source with no pending op (e.g. only a listening
`Gio.SocketService`) does not keep the process alive on its own, and a
purely-sync program still exits immediately.

#### `GLib.Variant` (build + unpack, GJS semantics)

`new GLib.Variant(signature, value)` recursively builds a GVariant from a type
signature, and the wrapper exposes the GJS unpack flavours — the contract
GAction / GSettings / DBus payloads expect:

```js
const GLib = requireGi('GLib', '2.0');

new GLib.Variant('s', 'hi').deepUnpack();      // 'hi'
new GLib.Variant('as', ['a', 'b']).deepUnpack(); // ['a', 'b']
new GLib.Variant('(si)', ['x', 1]).deepUnpack(); // ['x', 1]

const v = new GLib.Variant('a{sv}', {
  name: new GLib.Variant('s', 'Ada'),
  age: new GLib.Variant('i', 36),
});
v.get_type_string();   // 'a{sv}'
v.deepUnpack();        // { name: Variant, age: Variant }  (one level; values stay Variants)
v.recursiveUnpack();   // { name: 'Ada', age: 36 }          (fully plain JS)
v.unpack();            // single level; children stay Variants
```

Supported type strings: the basics `b y n q i u x t h d s o g`, `v` (variant),
`m*` (maybe), `a*` arrays (incl. the `as` strv + `ay` bytestring fast-paths and
`a{..}` dictionaries), `(...)` tuples and `{kv}` dict-entries. Built Variants
round-trip as GObject arguments/properties/signal values — e.g. a
`Gio.SimpleAction` state:

```js
const Gio = requireGi('Gio', '2.0');
const action = Gio.SimpleAction.new_stateful('counter', null, new GLib.Variant('i', 0));
action.get_state().deepUnpack();              // 0
action.change_state(new GLib.Variant('i', 5));
action.get_state().deepUnpack();              // 5
```

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

#### `GObject` conveniences (signals, `GObject.Value`, `Object.new`)

`requireGi('GObject')` carries the GJS `GObject.js` convenience surface on top of
introspection:

```js
const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

// By-function signal ops — node-gi connects through private closures, so the
// (function → handler id) mapping is recorded at connect() time.
const action = new Gio.SimpleAction({ name: 'a', enabled: true });
const onChange = () => { /* … */ };
action.connect('notify::enabled', onChange);
GObject.signal_handlers_block_by_func(action, onChange);   // → count blocked
GObject.signal_handlers_unblock_by_func(action, onChange); // → count unblocked
GObject.signal_handlers_disconnect_by_func(action, onChange); // → count disconnected
action.block_signal_handler(id); action.unblock_signal_handler(id); // by id
action.stop_emission_by_name('notify::enabled');           // from within a handler

// GObject.Value — an explicit GValue you can build, set, read, copy and pass IN.
const v = new GObject.Value();
v.init(GObject.TYPE_INT); v.set_int(42); v.get_int();      // → 42
const s = new GObject.Value(GObject.TYPE_STRING, 'hi');    // 2-arg convenience
v instanceof GObject.Value;                                // → true

// Construct a GObject from a runtime GType.
const made = GObject.Object.new(Gio.SimpleAction.$gtype, { name: 'made' });
```

Also present: `GObject.ParamFlags` / `SignalFlags` (full introspected bitfields),
the fundamental `GObject.TYPE_*` GTypes, `GObject.AccumulatorType`, and
`GObject.signal_connect` / `signal_connect_after` / `signal_emit_by_name`.

`bind_property_full` / `BindingGroup.bind_full` work with **real JS transform
functions** (the engine marshals them as C `GBindingTransformFunc` trampolines,
the same architecture gjs uses via GjsPrivate — see `src/private.cc`): a
transform-to converts the bound value, returning `[false, …]` leaves the target
unchanged, a bidirectional transform-from converts back, and `null` transforms
give a plain copy binding. Verified byte-identical to gjs by the
`gclosure-in-args` conformance program. The related raw primitives
`GObject.signal_connect_closure` / `GObject.source_set_closure` accept a plain
JS function wherever a `GObject.Closure` IN-argument is expected (the engine
marshals it as a real GClosure).

**Kept-throw** (a clear, actionable error, not a crash): `ParamSpec.enum`
/ `flags` / `char` / `uchar` / `long` / `ulong` / `param` are not yet buildable (the
native param-spec builder covers int/uint/int64/uint64/double/float/string/boolean/
object/boxed).

#### `GLib` conveniences (`log_structured`, one-shot idle/timeout)

`requireGi('GLib')` carries `GLib.log_structured(domain, level, fields)` (packs
string / `Uint8Array` / `GLib.Variant` fields into an `a{sv}` and hands it to
`g_log_variant`) and the one-shot source helpers `idle_add_once` /
`timeout_add_once` / `timeout_add_seconds_once` (the callback runs once, then the
source is auto-removed).

`GLib.log_set_writer_func(fn)` installs a **JS `GLogWriterFunc`** as the
process structured-log writer, with gjs semantics (node-gi ships the same
thread-guarded C wrapper gjs routes through GjsPrivate — `src/private.cc`): the
writer receives `(logLevel, fields)` where `fields` is a plain object whose
values are `Uint8Array`s of the field bytes (`null` for empty fields) —
byte-for-byte the shape gjs's `{...stringFields.recursiveUnpack()}` produces —
and its returned `GLib.LogWriterOutput` drives the handled/unhandled fallback.
`GLib.log_set_writer_default()` detaches the JS writer (later logs fall back to
`g_log_writer_default`). Verified byte-identical to gjs by the `log-writer`
conformance program. Two contracts, identical under gjs: the underlying
`g_log_set_writer_func` may only ever be called ONCE per process — a second
`GLib.log_set_writer_func(fn)` call aborts inside GLib itself (install one
writer per process; `log_set_writer_default()` detaches the JS side but cannot
re-arm a new install) — and an off-thread log falls back to the default writer
in C (JS is never entered from a foreign thread).

#### `Gio.DBus` (client proxy, name owning + object export)

`requireGi('Gio')` carries the GJS DBus surface — both halves. The **client**
half: `Gio.DBusProxy.makeProxyWrapper(interfaceXml)` parses the interface XML and
returns a proxy constructor whose instances expose each method as `NameSync` (sync),
`NameRemote` (raw async callback) and `NameAsync` (Promise), each property as a
getter/setter, and each signal via `connectSignal` / `disconnectSignal` (the same
pure-JS `_signals` mixin GJS uses). `Gio.DBus.session` / `Gio.DBus.system` are the
bus getters; `Gio.DBus.own_name` / `unown_name` / `watch_name` / `unwatch_name`
own and watch bus names. The **export** half
(`Gio.DBusExportedObject.wrapJSObject` — exporting a JS object AS a DBus
service) is described below the example.

```js
const Gio = requireGi('Gio', '2.0');

const Proxy = Gio.DBusProxy.makeProxyWrapper(`<node>
  <interface name="org.freedesktop.DBus">
    <method name="GetId"><arg type="s" direction="out"/></method>
    <signal name="NameOwnerChanged"><arg type="s"/><arg type="s"/><arg type="s"/></signal>
  </interface>
</node>`);

const proxy = new Proxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus');
const [busId] = proxy.GetIdSync();                 // synchronous method
proxy.GetIdRemote((result, error) => { /* … */ }); // async, raw callback
const [id2] = await proxy.GetIdAsync();            // async, Promise (drains after run())
proxy.connectSignal('NameOwnerChanged', (p, sender, [name, oldOwner, newOwner]) => { /* … */ });

const id = Gio.DBus.own_name(Gio.BusType.SESSION, 'org.example.App',
  Gio.BusNameOwnerFlags.NONE, null, (conn, name) => { /* acquired */ }, null);
```

Async replies / signals / name callbacks dispatch from the default main context —
either a blocking `GLib.MainLoop.run()` or, with no loop anywhere, the uv-driven
auto-pump (an `await proxy.GetIdAsync()` at top level settles like any other
async Gio op). One DBus divergence remains for the BLOCKING case: a `NameAsync`
**Promise** `.then` does not drain *while* a node-gi loop blocks (node-gtk
#442/#121) — the reply still fires and settles the Promise, so it resolves once
`run()` returns; drive an async method inside a blocking loop through the raw
`NameRemote` callback.

**Object export** (`Gio.DBusExportedObject.wrapJSObject` — exporting a JS
object AS a DBus service) works with GJS semantics. GJS builds it on
`GjsPrivate.DBusImplementation` (a GJS-internal C type, absent on a plain
Node/GI host); node-gi instead drives the **introspectable**
`g_dbus_connection_register_object_with_closures2` (GLib ≥ 2.84) — the
method-call / get-property / set-property vtable slots are plain JS functions
the engine marshals as real **GClosure IN-arguments**:

```js
const service = {
  Level: 7,                                  // property (read via the interface XML signature)
  Echo(s) { return `echo:${s}`; },           // method (an Async variant + Promise return also work)
  Boom() { throw new Error('kaboom'); },     // a throw becomes a DBus error (org.gnome.gjs.JSError.*)
};
const impl = Gio.DBusExportedObject.wrapJSObject(interfaceXml, service);
impl.export(Gio.DBus.session, '/org/example/App');
impl.emit_signal('Pinged', new GLib.Variant('(s)', ['ping!']));
impl.emit_property_changed('Level', new GLib.Variant('i', 8)); // updates proxy caches
impl.unexport();                              // releases the registration + its closures
```

The impl surface matches GJS (`export` / `unexport` / `unexport_from_connection`
/ `emit_signal` / `emit_property_changed` / `flush` / `get_object_path`, plus
node-gi's usual camelCase aliases). The full round-trip — exported method,
property get/set through `org.freedesktop.DBus.Properties`, a throwing method
returning a DBus error, `emit_signal`, `emit_property_changed` updating a
proxy's cached property, and unexport — runs byte-identical to gjs
(`dbus/export-scenario.mjs`, cross-checked against `gjs -m` under
`dbus-run-session` by `npm run test:dbus`). Lifetime: the registration ref+sinks
its closures, so the service object lives exactly as long as the registration
(surviving GC with no JS references) and becomes collectable after
`unexport()` — guarded by the `--expose-gc` leg of the dbus suite. A method
handler receives the GJS-appended trailing `Gio.UnixFDList` argument (`null`
when the call carries no fds — verified against gjs; an actual fd-carrying
call arrives as a wrapped `UnixFDList` but deeper fd extraction is untested).
As under GJS, a **sync** self-call from the exporting process deadlocks the
shared main loop that must also service the incoming request — use the async
`NameRemote` forms.

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

// Legacy script modules many older GJS sources use:
const emitter = {};
imports.signals.addSignalMethods(emitter);      // the pure-JS Signals mixin
emitter.connect('ready', () => imports.mainloop.quit());
imports.mainloop.timeout_add(50, () => { emitter.emit('ready'); return false; });
imports.mainloop.run();                          // thin GLib.MainLoop wrapper
```

A follow-up `--app node` build step will inject this automatically for any
bundle that references those globals (so `const Gtk = imports.gi.Gtk` /
`print(...)` GJS source runs unmodified on Node); today it is an explicit import.

The remaining GJS-compatible surface (`import GLib from 'gi://GLib?version=2.0'`,
`const GLib = imports.gi.GLib`, the core overrides, `_promisify`, the legacy
`imports.*` modules) is layered on top of this engine in the gjsify bundler
integration and subsequent drops.

### cairo (`@gjsify/node-gi/cairo`)

cairo is a **foreign struct** in GObject-Introspection: GI does not know the
layout of `cairo_t` / `cairo_surface_t` / `cairo_pattern_t`, so it delegates their
marshalling to a module. GJS ships a native cairo binding + a foreign-struct
registration so that a GI function taking/returning a cairo pointer (e.g. a
`Gtk.DrawingArea` draw-func's `cairo_t`) round-trips to/from the JS cairo objects.
node-gi ports that seam: the same drawing code runs on GJS (native cairo) and Node
(this binding). An npm `cairo` package cannot stand in — a foreign cairo argument
must marshal through the SAME module the engine's foreign-struct seam knows about.

```js
import cairo from '@gjsify/node-gi/cairo'; // bare `cairo` on the --app node build
import { requireGi } from '@gjsify/node-gi/gi';

// Headless drawing — read the pixels back with getData().
const surface = new cairo.ImageSurface(cairo.Format.ARGB32, 64, 48);
const cr = new cairo.Context(surface);
cr.setSourceRGB(0.8, 0.1, 0.1);
cr.rectangle(8, 8, 20, 16);
cr.fill();
cr.$dispose();
surface.flush();
const pixels = surface.getData(); // Uint8Array (stride * height), ARGB32

// The foreign seam: a GI function taking a cairo_t marshals the Context through.
const PangoCairo = requireGi('PangoCairo', '1.0');
const layout = PangoCairo.create_layout(new cairo.Context(surface));

// A Gtk.DrawingArea draw-func receives a cairo_t → a live cairo.Context:
//   area.set_draw_func((_area, ctx, w, h) => { ctx.setSourceRGB(1, 0, 0); … });
```

Ported this slice: `cairo.Context` (drawing + transform ops incl.
`identityMatrix` and the `userToDevice[Distance]` / `deviceToUser[Distance]`
point transforms, state getters, `setDash`/`getDashCount` (+ a net-new
`getDash`), `inFill`/`inStroke`, `newSubPath`, `copyPath`/`copyPathFlat`/
`appendPath` (owned `cairo.Path` handles), `getSource` with concrete-subclass
fan-out, `$dispose`), `cairo.Surface` + `cairo.ImageSurface` (`getData`/
`getWidth`/`getHeight`/`getStride`/`getFormat`/`flush`/`writeToPNG`/
`createFromPNG`), the patterns — `cairo.SolidPattern`,
`cairo.LinearGradient`/`cairo.RadialGradient` (`addColorStopRGB[A]` via the
shared `cairo.Gradient` base), `cairo.SurfacePattern`
(`setExtend`/`getExtend`/`setFilter`/`getFilter`) — the opaque `cairo.Path`,
and the enums (`Format`, `Operator`, `Content`, `Extend`, `Filter`, …). This is
the full surface `@gjsify/canvas2d-core` draws through (headless Canvas 2D).
The native binding paints **byte-for-byte identically to GJS** (verified
pixel-for-pixel against `gjs -m`, incl. gradients / repeating surface patterns /
dashed strokes / path round-trips — `test/cairo-canvas2d.test.mjs`). Deferred:
region objects, the PDF/SVG/PS surfaces, and the text/font ops
(`showText`/`selectFontFace` — canvas2d text rides PangoCairo instead).
