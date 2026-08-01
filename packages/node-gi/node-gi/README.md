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
> convention (`[returnValue?, ...outArgs]` — one value bare, several as an Array),
> containers, struct OUT params and **caller-allocates OUT structs** — boxed
> (incl. the GValue auto-unbox) AND plain non-boxed C structs (the engine
> g_malloc0's the struct, the callee fills it in place, JS gets a field-readable
> handle that owns the storage — e.g. the `PangoRectangle`s of
> `PangoLayout.get_pixel_extents()`, the canvas2d `measureText` path). A JS
> `Uint8Array` (or `Buffer`/`DataView`/`ArrayBuffer`) passed where a **`GLib.Bytes`
> IN-arg** is expected is copied into a fresh GBytes and released per transfer
> after the call, exactly as GJS (`GdkPixbuf.Pixbuf.new_from_bytes(pixels, …)`);
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
  under GJS) — **except on macOS arm64 and Windows x64**, where a
  batteries-included, relocated GTK/GI runtime bundle ships so `gi://` works with
  no Homebrew/gvsbuild GTK (Phase 2). node-gi auto-detects a bundle at load and
  prepends its typelib dir to the GIRepository search path (`gtk-runtime.js`).
- **Those bundles are a MANUAL install today.**
  [`@gjsify/gtk-runtime-darwin-arm64`](../gtk-runtime-darwin-arm64) and
  [`@gjsify/gtk-runtime-win32-x64`](../gtk-runtime-win32-x64) are published, and
  node-gi finds either one the moment it is present in the tree — but **no
  package declares them as a dependency**, so nothing installs them for you.
  Install the one for your platform alongside node-gi:

  ```bash
  npm install @gjsify/gtk-runtime-win32-x64      # Windows x64
  npm install @gjsify/gtk-runtime-darwin-arm64   # macOS arm64
  ```

  Both declare `os`/`cpu`, so npm/yarn/pnpm skip them off-platform. Making them
  `optionalDependencies` of this package (which would remove the manual step
  without any consumer-side platform branching) is pending two decisions outside
  this package — the ADR-0003 dependency-direction rule between node-gi's tier
  and the bundles', and `os`/`cpu` filtering in `gjsify install`'s native
  backend, which currently places foreign-platform optional deps.
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
| Promise continuations drain **during** a blocking GLib loop (async DBus replies, `await` chains) | ✅ | ✅ | ✅ |
| Node timers/I/O alive **during** a blocking GLib loop (uv co-pump) | ✅ | — | — |

Bun reaches full parity with Node on the core surface; Deno passes the same
conformance subset since 2.9 (the marshalling/async N-API quirks that excluded
`arrays`/`async-error` on Deno 2.1 are fixed upstream) — the Node-only co-pump
cases are the remaining, by-design gap. The authoritative full suite runs on Node.

Promise draining during a blocking loop is cross-runtime because the engine runs
a **microtask checkpoint at every outermost loop-dispatched GLib→JS callback
boundary**: Node's `napi_make_callback` performs it natively; Bun's and Deno's
do not, so on those runtimes the engine invokes the runtime's own drain
primitive (`bun:jsc` `drainMicrotasks` / Deno `core.runMicrotasks`), registered
at addon load (`src/loop.cc` `NodeGiMaybeDrainMicrotasks`). Without it, an
**async** (Promise-returning) DBus method handler exported via
`Gio.DBusExportedObject.wrapJSObject` never sent its reply on Bun/Deno while a
blocking `run()` owned the thread — the client timed out — while sync handlers
worked (regression: `test/dbus-async.test.mjs`). Runtime *timers/I/O* during a
blocking loop remain Node-only (the uv co-pump).

## Build & test

```bash
npm install          # prebuild if one is staged, else node-gyp (scripts/install.mjs)
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
`node_gi.node`. That candidate order lives in `native-paths.js` and is shared
with the `install` script, so the binary the guard decides not to rebuild is
by construction the binary the loader looks for.

In a checkout `prebuilds/` is gitignored, so `npm install` here always runs the
source build — as do the `npm install --foreground-scripts` steps in
`node-gi.yml` and the `node-gi-prebuild-*` legs in `release.yml`, which need
`build/Release/node_gi.node` for `scripts/stage-prebuild.mjs`. Set
`NODE_GI_BUILD_FROM_SOURCE=1` to force it regardless of a staged prebuild.

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
instances are Proxies over a native handle (but `instanceof` still works — it is
resolved through the GObject type system, see the `instanceof` note below);
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
async Gio op). A `NameAsync` **Promise** `.then` drains *while* a node-gi loop
blocks on all three runtimes (the reply's GI callback settles the Promise and
the microtask checkpoint at that loop-dispatched boundary runs the
continuation). One Node-only divergence remains: when the blocking `run()` is
itself entered inside a live async scope (module top-level evaluation, an
`await`, `node:test`), V8 refuses the nested checkpoint (node-gtk #442/#121) —
the reply still fires and settles the Promise, so it resolves once `run()`
returns; defer the blocking run to a macrotask (what `runAsync` does) or drive
the method through the raw `NameRemote` callback. Bun/Deno do not share that
nesting restriction: their registered drain primitives run even under a
top-level blocking `run()`.

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

// imports.byteArray — the legacy byte-array module, with GJS semantics
// (fromString/toString are zero-terminated + fatal-decode; fromGBytes/toGBytes
// round-trip GLib.Bytes; fromArray wraps in the legacy ByteArray class). This
// is the seam @gjsify/utils' cli()/gbytesToUint8Array — and through them
// @gjsify/os + @gjsify/child_process — read GLib subprocess output with:
const [ok, out] = imports.gi.GLib.spawn_command_line_sync('echo hi');
console.log(imports.byteArray.toString(out));    // 'hi\n'
const bytes = imports.byteArray.toGBytes(Uint8Array.of(1, 2, 3));
imports.byteArray.fromGBytes(bytes);             // Uint8Array [1, 2, 3] (a copy)
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

Building on that seam, the **LIVE `@gjsify/canvas2d` `Canvas2DBridge`** — a
`Gtk.DrawingArea` that wraps an `HTMLCanvasElement` 2D context and blits its Cairo
surface onto the widget each frame — realizes, draws and blits UNCHANGED on
node-gi under a display: an app draws via the standard `canvas.getContext('2d')`
DOM API in `bridge.onReady`, the GTK draw_func fires, the bridge blits
(`cr.setSourceSurface` + `cr.paint`) and the rAF (`add_tick_callback`) path ticks.
The same source builds `--app gjs` and `--app node` and prints byte-identical
output, pixels read back off the canvas included — `test/canvas2d-bridge.test.mjs`
+ `fixtures/canvas2d-bridge-app.ts`. It is a **local/dev verification** (see the
run recipe in the test header), NOT wired into CI: the LIVE bridge pulls the whole
`@gjsify/canvas2d` gi:// graph, so it needs the full gjsify workspace built with a
current-source `@gjsify/cli` (the bare-`cairo`→`@gjsify/node-gi/cairo` and
register-inline fixes the published CLI predates) plus a display and the addon — a
heavyweight from-scratch rebuild not worth gating a minimal CI container on. The
test self-skips in the default `npm test` (no display). One node-only note: a
mapped `Gtk.DrawingArea`'s live `GdkFrameClock` stays an active GLib source after
`app.quit()`, so — matching the documented lifetime divergence — a node-gi GTK
program that must terminate exits explicitly (`process.exit(0)`), whereas `gjs -m`
exits on module completion.

### The live `@gjsify/event-bridge` dispatches DOM events on node-gi

The GTK→DOM event bridge (`@gjsify/event-bridge`'s `attachEventControllers`) —
which attaches GTK4 `EventControllerMotion`/`GestureClick`/`EventControllerScroll`/
`EventControllerKey`/`EventControllerFocus` to a widget and dispatches W3C DOM
events (Mouse/Pointer/Keyboard/Wheel/FocusEvent) — runs UNCHANGED on node-gi. The
shared fixture presents a `Gtk.DrawingArea`, attaches the controllers, and drives a
SYNTHESIZED event through each live `Gtk.EventController*` via `emit(signal, …)`
(the same path the GJS `event-bridge.spec.ts` drives), then asserts the dispatched
DOM event's type / coords / `getModifierState` / key / code. The `Gdk.ModifierType`
flags and `Gdk.keyval_name`/`Gdk.keyval_to_unicode` marshalling produce
byte-identical DOM events under node-gi and `gjs -m` — the same source builds
`--app gjs` and `--app node` and prints the committed golden
(`test/event-bridge.test.mjs` + `fixtures/event-bridge-app.ts`). Every golden line
is deterministic + display-independent (coords clamp to a fixed 400x300 allocation;
key/code/modifiers derive from the Gdk marshalling), so byte-parity is stable.

**`instanceof` across the GObject hierarchy (GJS parity):** `instanceof` for GObject
wrapper classes is wired through the GObject type system — each per-GType wrapper
carries a `Symbol.hasInstance` that resolves via `g_type_is_a` (native
`isInstanceOf`), so `new Gtk.EventControllerMotion() instanceof
Gtk.EventControllerMotion` is `true`, and so is a base class (`… instanceof
Gtk.EventController`), an implemented interface (`simpleAction instanceof Gio.Action`)
and a `registerClass` subclass against its leaf / base / interface — while a sibling
type, an unrelated class, a boxed/`Variant` handle, `null` or a plain object stay
`false`. `test/instanceof.test.mjs` + the cross-runtime golden
`conformance/programs/instanceof-hierarchy.conf.mjs` (gjs/node/bun/deno byte-identical)
guard it. The event-bridge fixture retrieves controllers by ADD ORDER off
`widget.observe_controllers()` as a stylistic choice (identity is preserved and
`emit()` resolves the signal by the live GType) — no longer forced by a gap.
(A second gap the fixture originally routed around — `new
Gdk.Rectangle()` threw `no static method 'new'` — is FIXED: `new <BoxedStruct>()`
now zero-allocates with GJS `gi/boxed.cpp` semantics when the struct has no `new`
constructor (`Graphene.Rect`/`Point`, `Gdk.Rectangle`, `Gdk.RGBA` — the
`@gjsify/devtools` screenshot chain), routes to `new` when it exists, and throws
a clear error for args without one; `test/struct-construct.test.mjs` guards it,
gjs-parity included. The fixture still reads the presented window's real
allocation — simpler and display-truthful.)

**Run it (needs a display + a built workspace + the `gjsify` CLI; self-skips
otherwise):**

```sh
# node-gi (--app node) — the authoritative check vs the committed golden:
export GJSIFY_BIN="$(git rev-parse --show-toplevel)/packages/infra/cli/lib/index.js"
xvfb-run -a dbus-run-session -- \
  env GSK_RENDERER=cairo GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none \
      NODE_GI_NATIVE=build NODE_GI_EB_SKIP_GJS=1 GJSIFY_BIN="$GJSIFY_BIN" \
  node --test test/event-bridge.test.mjs
# Drop NODE_GI_EB_SKIP_GJS to additionally re-prove the golden IS gjs's own output
# (builds + runs --app gjs; needs the workspace CLI, not the published one).
```

`GJSIFY_BIN` must point at the WORKSPACE-built `@gjsify/cli` (`packages/infra/cli/lib/index.js`),
not the published `@gjsify/cli` — the fixture is built with current source, which
carries this session's bundler fixes the published `0.18.0` predates.
### WebGL / `Gtk.GLArea` (the gwebgl seam)

**Definitive: a `Gtk.GLArea` realizes and hands JS a LIVE, CURRENT GL context
under node-gi on a headless software-GL display.** Verified end-to-end by
`test/webgl-glarea.test.mjs` + the ONE dual-runtime source
`fixtures/webgl-glarea-app.ts`: a presented `Gtk.ApplicationWindow` holding a
`Gtk.GLArea` configured exactly like `@gjsify/webgl`'s `WebGLBridge`
(`set_use_es(true)`, `set_required_version(3, 2)`, depth + stencil) realizes
with `get_error() === null`, an **OpenGL ES 3.2** context
(`Gdk.GLContext.get_current()` non-null in both `realize` and `render`), and
the `gwebgl` Vala bridge (`new Gwebgl.WebGLRenderingContextBase()` — the native
class `@gjsify/webgl` wraps) works through it: `getString(GL_VERSION/…)`, a
`getParameterx` **GVariant** round-trip, and a real WebGL draw —
`clearColor(1,0,0,1)` + `clear` + `readPixels` reading back the exact
`255,0,0,255` pixel. The committed golden is byte-identical between `gjs -m`
and `node` (the gjs gold-standard leg re-proves it wherever `gjs` is present;
`NODE_GI_WEBGL_SKIP_GJS=1` skips that leg).

The GL/display env the golden is pinned to (software GL, no GPU needed):

```bash
# X11 (Xvfb or a real display) + mesa llvmpipe + GTK compositing off GL:
xvfb-run -a dbus-run-session -- \
  env GSK_RENDERER=cairo GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none \
    NODE_GI_NATIVE=build node --test test/webgl-glarea.test.mjs
# GL under llvmpipe: "OpenGL ES 3.2 Mesa …" / "llvmpipe (LLVM …)".
```

**The FULL `@gjsify/webgl` `WebGLBridge` runs too** (same test file, second
fixture `fixtures/webgl-bridge-app.ts`): the complete TS WebGL stack UNCHANGED —
`WebGLBridge` (a `registerClass` `Gtk.GLArea` subclass), `onReady` handing out
`HTMLCanvasElement` + `WebGLRenderingContext` (constants GHashTable, the
`_init()` `getParameterx` GVariant reads, eager WebGL1+2 context construction),
and browser-standard `clearColor(0,0,1,1)` + `clear` + `readPixels` reading the
blue clear back (`bridge-pixel(0,0): 0,0,255,255`), byte-identical gjs ↔ node.
Shader/buffer/texture breadth (a three.js triangle/teapot) is the remaining
follow-up — the seam + context stack are proven.

The tests self-skip without a display, without a `gjsify` CLI, or without the
committed `Gwebgl-0.1` prebuild (`packages/framework/webgl/prebuilds/linux-*`,
which the test itself puts on `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH`); the bridge
test additionally skips when `@gjsify/webgl` is not built. The fixture build
needs a WORKSPACE-built `@gjsify/cli` (point `GJSIFY_BIN` at
`packages/infra/cli/lib/index.js` after
`gjsify workspace @gjsify/cli build --with-dependencies`), like
`canvas2d-bridge`; the gjs gold-standard leg additionally needs the workspace
register libs built (`--app gjs` force-inlines `<pkg>/register`). Two engine
gaps this spike fixed on the way (headless regression coverage in
`test/gerror-return.test.mjs`): GError-typed RETURNS
(`Gtk.GLArea.get_error()` — `GI_TYPE_TAG_ERROR` → a field-readable GLib.Error
boxed) and literal-first method-name resolution (Vala GIRs carry camelCase
names — Gwebgl's `getString` — which the unconditional camelCase→snake_case
alias destroyed; the engine now resolves the literal name first, alias second).

### Excalibur.js renders through WebGL on node-gi (the GTK-bridge capstone)

**Definitive: a REAL WebGL game engine — Excalibur 0.32, the engine behind the
`excalibur-jelly-jumper` showcase and the PixelRPG map-editor — boots, runs its
clock, and renders frames through `@gjsify/webgl`'s `WebGLBridge` UNCHANGED
under node-gi** (`test/excalibur-webgl.test.mjs` + the ONE dual-runtime source
`fixtures/excalibur-webgl-app.ts`). `new ex.Engine({ canvasElement })` builds
against the bridge's `HTMLCanvasElement` (WebGL2 context), `engine.start()`
resolves, the engine's real render pipeline runs (shader compile/link,
`bufferData`, VAOs, `vertexAttribPointer`, `drawArrays`/`drawElements`,
`clearBufferfv` at `RenderTarget.blitToScreen`) for 5 frames, and the committed
golden asserts the pixels read back off the GL framebuffer — the screen-centered
blue Actor and the red engine clear color — **byte-identical between `gjs -m`
and `node`**. The DOM surface (document/HTMLCanvasElement/ResizeObserver/
matchMedia/XHR) comes from the SAME `@gjsify/*` registers the gjs build injects,
via the `--app node` explicit-`--globals` reverse-bridge injection.

Excalibur's real GL + engine usage exposed four core gaps, all fixed at the
engine (each with regression coverage):

- **`GVariant 'ay'` rejects `null`** (`src/variant.cc`) — GJS packs
  `new GLib.Variant('ay', null)` as the EMPTY byte array (`GLib.Bytes(null)`);
  node-gi threw. Exposing call: Excalibur's `texImage2D(..., null)`
  blank-texture allocation at renderer init (`Uint8ArrayToVariant(null)`).
- **Unknown members must be `undefined`, not a throw-on-call thunk**
  (`src/calls.cc` `hasMethod` + the L1 wrapper `get`) — real consumers
  feature-detect optional native methods (`typeof gl.clearBufferfv ===
  'function'` gates `@gjsify/webgl`'s clearBuffer emulation, hit at
  `blitToScreen`); the old always-a-function proxy made that detection lie,
  then threw mid-frame. `hasMethod(handle, name)` resolves through the SAME
  literal-first/snake-alias walk `callMethod` uses.
- **Signal dispatch now runs the microtask checkpoint at its boundary**
  (`src/signals.cc`, `napi_make_callback`) — GJS drains the promise-job queue
  when the outermost JS frame exits; promise chains resolved inside a
  loop-dispatched signal handler (Excalibur's whole `engine.start()` boot,
  queued from the GLArea `render`/`onReady` dispatch) previously lingered
  until the libuv↔GLib bridge's prepare-phase drain.
- **The uv co-pump source must not outrank GTK painting** (`src/loop.cc`) —
  at the default `G_PRIORITY_DEFAULT` a busy Node loop STARVED
  `GDK_PRIORITY_REDRAW`: Excalibur's `requestIdleCallback` polyfill (a
  self-re-arming 1 ms `setTimeout`, run perpetually by its GarbageCollector)
  kept the UvLoopSource ready on every GLib iteration, so ticks/renders/rAF
  froze while plain GLib timeouts kept firing. The source now sits below
  redraw (`G_PRIORITY_HIGH_IDLE + 30`): rendering outranks Node timers,
  browser-like, and Node I/O still runs in every frame gap.

Run it (a LOCAL/dev verification like the other display suites — self-skips
without a display / CLI / prebuild / built workspace):

```sh
export GJSIFY_BIN="$(git rev-parse --show-toplevel)/packages/infra/cli/lib/index.js"
xvfb-run -a dbus-run-session -- \
  env -u FORCE_COLOR GSK_RENDERER=cairo GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 \
      GTK_A11Y=none NODE_GI_NATIVE=build GJSIFY_BIN="$GJSIFY_BIN" \
  node --test test/excalibur-webgl.test.mjs
# Drop NODE_GI_EXCALIBUR_SKIP_GJS to additionally re-prove the golden IS gjs's
# own byte-output (builds + runs --app gjs).
```

The FULL `excalibur-jelly-jumper` showcase builds `--app node`
(`gjsify run build:node`; `gjsify.example.runtimes` includes `node`) and gets
remarkably far on node-gi: the GTK window presents, the devtools control plane
exports over DBus, `Gst.init` runs and every `ex.Sound` constructs its
Gst-backed `AudioContext` (this exposed + fixed the nullable-array `null`
marshalling — `Gst.init(null)`), and Excalibur boots into resource loading.
The remaining blocker is POLYFILL ROUTING, not marshalling: on Node the
GLOBAL `fetch` is the native undici one (the register convention never
overrides an existing native), and `@excaliburjs/plugin-tiled`'s fileLoader
feeds it the root-relative `/res/…` paths that only OUR GJS fetch/XHR resolve
against the program dir — undici rejects them (`Failed to parse URL`), the
Tiled map never loads, and scene init fails. Making the reverse bridge route
`fetch` (and friends) to the `@gjsify/*` polyfills over the runtime natives is
the follow-up that unlocks the full game. (`jsdom` — plugin-tiled's node-side
DOMParser fallback — is aliased to `@gjsify/empty` in `build:node`, mirroring
the plugin's own `"browser": { "jsdom": false }`.)

### A real Adwaita WINDOW realizes + renders (the GTK-GUI capstone)

Beyond the display-free conformance: an UNCHANGED `Adw.Application` +
`Adw.ApplicationWindow` (HeaderBar / WindowTitle / StatusPage) not only
constructs + presents but **realizes and RENDERS a surface** through the GSK
renderer on node-gi — the same in-process capture path `@gjsify/devtools`'
`Screenshot` uses: `Gtk.WidgetPaintable` → `Gtk.Snapshot.to_node()` →
`Gsk.Renderer.render_texture` → `Gdk.Texture.save_to_png_bytes`. A non-empty PNG
is the unambiguous proof that a `GdkSurface` was allocated + a GSK render tree
rasterised — not reachable by any headless program. Guarded by
`test/windowing.test.mjs` + `test/windowing-interactive.test.mjs` (an
`Adw.ApplicationWindow` that RESPONDS to a `Gio.SimpleAction` + a
`Gtk.Button::clicked` through the node-gi signal chain) + `test/widgets.test.mjs`
(the Adwaita widget breadth below) — all self-skip without a display on Linux (the
win32/darwin GDK backend supplies its own display, so they run there), wired into
the Linux `gtk-smoke` + the Windows windowing CI jobs. The
`showcases/gtk/node-gi-window` showcase runs the SAME single source on both GJS
and Node and screenshots the live window over the `org.gjsify.Devtools` DBus
surface.

This exposed one core gap, fixed at the engine:

- **Non-GObject GObject-fundamentals wrap through their introspected ref/unref,
  not `WrapGObject`** (`src/object.cc` `MakeFundamentalHandle` + the
  `src/marshal.cc` return branch). `Gtk.Snapshot.to_node()` returns a
  `GskRenderNode` — introspected as OBJECT_INFO but a GObject FUNDAMENTAL
  (`gi_object_info_get_fundamental`), ref-counted via `gsk_render_node_ref/unref`,
  NOT `g_object_ref`, with `G_IS_OBJECT` FALSE. Routing it through `WrapGObject`
  ran the toggle-ref/qdata dance on a non-GObject → a cascade of
  `g_object_*: assertion 'G_IS_OBJECT (object)' failed` criticals AND a leaked ref.
  It now gets a type-tagged External carrying the raw pointer + the introspected
  unref func as the finalizer hint (`isFundamentalHandle` / L1 `wrapFundamental`,
  an opaque round-trippable pass-through) — GParamSpec + GValue keep their
  dedicated branches, this catches the rest.

### Windows: the FULL-windowing GTK runtime bundle

The batteries-included [`@gjsify/gtk-runtime-win32-x64`](../gtk-runtime-win32-x64)
bundle has two closures: the DEFAULT display-free set (loadable DLLs + typelibs)
and the `--windowing` SUPERSET that adds the runtime DATA a real GTK window needs
on Windows — the gdk-pixbuf loaders + `loaders.cache`, compiled GSettings schemas
(`gschemas.compiled`), the Adwaita/hicolor icon themes + `icon-theme.cache`, and
Fontconfig config/cache. node-gi's loader (`gtk-runtime.js`
`maybeWireGtkWindowingEnv`) detects the windowing data via the `gschemas.compiled`
marker and wires the env (`GSETTINGS_SCHEMA_DIR` / `GDK_PIXBUF_MODULE_FILE` /
`XDG_DATA_DIRS` / `FONTCONFIG_*`); a display-free bundle carries no marker, so the
wiring is a strict no-op and that load is byte-unchanged.

The bundle is not pulled in automatically — `npm install
@gjsify/gtk-runtime-win32-x64` alongside node-gi (see
[Requirements](#requirements)). `resolveGtkRuntimeBundle()` finds it wherever the
package manager placed it: an explicit `GJSIFY_GTK_RUNTIME` dir, a staged
`prebuilds/<target>/gtk/`, the sibling monorepo checkout, or
`require.resolve('@gjsify/gtk-runtime-<target>')` — the last of which covers a
hoisted `node_modules/@gjsify/gtk-runtime-win32-x64`, so no loader change is
needed if the dependency edge is ever declared.

### Adwaita widget breadth realizes + reacts + renders

Beyond one window's chrome: a representative slice of the REAL Libadwaita widget
set constructs, RENDERS and REACTS on node-gi. `test/widgets.test.mjs` builds an
`Adw.PreferencesPage` / `Adw.PreferencesGroup` of `Adw.ActionRow`, `Adw.SwitchRow`,
`Adw.EntryRow`, `Adw.ComboRow` (a `Gtk.StringList` model), `Adw.SpinRow` (a
`Gtk.Adjustment`) and `Adw.ExpanderRow`, plus a `Gtk.ListBox` and a dismissible
`Adw.Toast` via an `Adw.ToastOverlay`. Two tiers, robust on a runner whose surface
may or may not realize:

- **DumpTree** — the widget tree contains every expected type (`AdwSwitchRow`,
  `AdwComboRow`, `AdwEntryRow`, `AdwSpinRow`, `AdwExpanderRow`, `AdwPreferencesPage`,
  `GtkListBox`, …), read via the runtime GType (`$typeName`) the `@gjsify/devtools`
  DumpTree uses — so each class constructs + parents correctly through node-gi.
- **Interaction** — toggling the switch, changing the combo selection, moving the
  spin value, expanding the expander and setting the entry text all drive
  OBSERVABLE property changes AND fire their paired `notify::<prop>` handlers, and a
  toast add → `dismiss()` fires `::dismissed`. This surfaces the `Gtk.StringList` /
  `Gtk.Adjustment` model marshalling (GListModel + object construct props),
  `notify::` property signals and the boxed-model paths — all display-independent, so
  the interaction + DumpTree tier holds headless on Windows CI.
- **Render** — when the surface realizes, the whole preferences surface rasterises
  through the GSK renderer (a non-empty PNG), the strong proof the broad widget set
  renders, not just constructs.

The same widgets back the `showcases/gtk/node-gi-window` "Settings" view (an
`Adw.ViewStack` page reachable from the bottom `Adw.ViewSwitcherBar`, beside the
counter). No engine change and no windowing-bundle change were needed: the rows are
core GTK4/Adwaita widgets backed by the already-bundled `gtk-4-*.dll` / `libadwaita-1`
and the full Adwaita icon theme + compiled schemas the `--windowing` bundle already
ships.

Scoped out of the capstone fixture itself (deliberately): the Gst audio
DECODE/playback path (`decodeAudioData`, `autoaudiosink`) — construction is
proven by the showcase run above, the streaming pipeline is its own follow-up
surface.
