# node-gi — the GJS-compatible surface (engine, `gi://` layer, cairo)

> Reference detail for [`packages/node-gi/node-gi/README.md`](../packages/node-gi/node-gi/README.md)
> and [`packages/node-gi/AGENTS.md`](../packages/node-gi/AGENTS.md).
> Paths are relative to `packages/node-gi/node-gi/` unless stated otherwise.

The README carries one worked example. This file carries the whole surface, and above all
the places where node-gi DIVERGES from GJS: every divergence below is measured, and a port
that assumes GJS semantics where node-gi differs fails in the consumer rather than here.

## What the engine covers

The capability record of the headless core (milestone 1), kept because it states which
marshalling shapes are proven and which are deferred — the question every new consumer asks
first.

The native engine over
the modern `girepository-2.0` API now does: resolve the default repository,
`require` a namespace, enumerate its infos; call namespace-level functions and
**instance methods** (own + implemented-interface methods, up the parent chain)
with value marshalling (numbers, booleans, strings, GObjects, enums/flags),
including **OUT and INOUT parameters** surfaced per the GJS return-tuple
convention (`[returnValue?, ...outArgs]` — one value bare, several as an Array),
containers, struct OUT params and **caller-allocates OUT structs** — boxed
(incl. the GValue auto-unbox) AND plain non-boxed C structs (the engine
g_malloc0's the struct, the callee fills it in place, JS gets a field-readable
handle that owns the storage — e.g. the `PangoRectangle`s of
`PangoLayout.get_pixel_extents()`, the canvas2d `measureText` path).
A **`GError` parameter** (`GI_TYPE_TAG_ERROR`) marshals in every direction — the
explicit one an API declares, as distinct from the implicit `throws=1` GError the
invoker turns into a thrown `GLib.Error`. An OUT/INOUT slot reads back as a
field-readable `GLib.Error` boxed (`Gst.Message.parse_error()`, `GLib.set_error_literal`),
a slot the callee left alone reads back as `null` rather than an empty error, and an
IN arg takes such a boxed and honours its transfer — borrowed for `(transfer none)`
(`Gst.Message.new_error`), an independent `g_error_copy` for `(transfer full)`
(`g_propagate_error` adopts and frees its `src`). Until #1495 the OUT direction was
refused before the invoke, which put every GStreamer bus-error accessor out of
reach: an application could see that playback stopped and not why. A JS
`Uint8Array` (or `Buffer`/`DataView`/`ArrayBuffer`) passed where a **`GLib.Bytes`
IN-arg** is expected is copied into a fresh GBytes and released per transfer
after the call, exactly as GJS (`GdkPixbuf.Pixbuf.new_from_bytes(pixels, …)`);
construct GObjects and read/write properties (GValue round-trip); connect /
emit / disconnect signals (incl. detailed names like `notify::prop`); and
**register GObject subclasses** (subtype + construct-by-type, inheriting the
parent's properties/methods, plus **custom properties + signals** declared on
the subclass). Ownership rides
N-API finalizers (no V8-GC reentrancy). On top of the engine, an **L1
GJS-compatibility layer** (`@gjsify/node-gi/gi`, `requireGi`) surfaces a
GJS-shaped namespace: `new Gio.SimpleAction({ name })`, `action.name` property
access, `action.get_name()` methods, `.connect()/.emit()/.disconnect()`, and
enums / flags / constants (`Gio.BusType.SESSION`, `GLib.PRIORITY_DEFAULT`);
constructor/static methods (`Gio.File.new_for_path(...)`); and both snake_case
and camelCase accessors. The L1 layer also surfaces a **GJS-shaped
`GObject.registerClass(meta, class)` decorator** (with `GObject.ParamSpec` /
`ParamFlags` / `SignalFlags`): a JS `class extends GObject.Object { … }` with
`Properties` / `Signals` / `vfunc_*` methods becomes a constructor whose
instances carry both the user methods and the GObject property/signal surface.
A **libuv↔GLib mainloop bridge** (`startMainLoop`,
auto-attached by `requireGi`) nests Node's libuv loop inside the GLib loop, so a
blocking `GLib.MainLoop.run()` keeps Node's timers/I/O alive — including the
**boxed/struct slice** that needs (`GLib.MainLoop.new(...)` → a boxed handle →
`.run()`/`.quit()`). The same call arms the **uv-driven auto-pump** for the
NON-blocking case: pending GLib sources (Gio async completions, GLib
timeouts/idles, DBus) dispatch from Node's own event loop, so a plain
`node bundle.mjs` that `await`s a Gio async op needs no explicit mainloop —
matching GJS, where the GLib loop is the process loop. **JS functions marshal as GI callbacks** via an ffi
closure (`GLib.timeout_add`/`idle_add` fire from the loop, the boolean return
drives source continuation; the hidden user_data/destroy slots are auto-filled).
It registers GObject subclasses (subtype + construct-by-type, inheriting the
parent's properties/methods, plus **custom properties + signals**, plus
**vfunc overrides** — a JS function overriding a parent GObject vfunc, hooked
into the new type's class vtable). The gjsify `--app node` bundler integration
already rewrites `gi://` onto the L1 layer. vfunc **chain-up** to the parent
implementation (with the toggle-ref GC bridge) and general struct field access
land in subsequent drops — for now a vfunc override fully replaces the inherited
implementation.

**Wrong-typed arguments THROW as on gjs rather than coercing**: a non-string
for a utf8/filename IN arg is a plain `Error` (`Expected type string for
argument 'name' but got type number`), and a GObject of the wrong GType for an
object/interface IN arg is a `TypeError` (`Object is of type Gtk.Box - cannot
convert to AdwPreferencesGroup`) — both messages byte-identical to gjs, pinned
by the `wrong-arg-type-errors` conformance program. The refusal is
load-bearing, not cosmetic: GTK's own failure mode for a passed-through wrong
pointer is one CRITICAL at exit 0 (`adw_preferences_page_add: assertion
'ADW_IS_PREFERENCES_GROUP (group)' failed`), so a binding that forwards the
value turns every caller's catch-and-recover path into dead code — six of
@gjsify/gtk-host's refused-operation recoveries were unreachable on node while
the same source threw and recovered on gjs. One measured leniency kept: node-gi
accepts BOTH `null` and `undefined` as a NULL string/object (gjs refuses
`undefined` everywhere and `null` for non-nullable args) — see
`status/open-todos.md`.

## The raw engine API (`@gjsify/node-gi`)

The low-level entry points the L1 layer is built on. Most code should use L1 below; these
are what a bespoke binding, or a test that needs to bypass the wrapper, reaches for.

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


## L1 — GJS-shaped surface (`@gjsify/node-gi/gi`)

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

### Class prototypes and the lookup order

`Ns.Class.prototype` is a real prototype: reading a name on it MATERIALIZES the
introspected method behind that name (the JS twin of the `resolve` hook GJS
installs on every GObject prototype), and every wrapper resolves its members
through the prototype of its runtime GType — a `registerClass` subclass's own
prototype, otherwise the introspected class's — before any native fallback. So
instrumenting a method works the way it does on GJS:

```js
const proto = Gio.ZlibDecompressor.prototype;
const original = proto.convert;             // the introspected method
proto.convert = function (...args) {        // instrument it
    calls++;
    return original.apply(this, args);
};
const d = new Gio.ZlibDecompressor({ format: Gio.ZlibCompressorFormat.GZIP });
d.convert === proto.convert;                // true — and the wrapper IS called
proto.convert = original;                   // put it back
```

Until 0.39 an instance ignored its prototype: the assignment stuck, `d.convert`
still reached the native method, and a spy-based test reported itself installed
while measuring nothing. Byte-compared against GJS by the `prototype-chain`
conformance program.

A materialized method also carries gjs's **`Function.length`** — the JS-visible
IN-arg count (IN/INOUT args minus array-length and callback
user_data/destroy-notify slots; gjs's `m_js_in_argc`). The engine derives it
from the SAME skip pre-scan its invoke loop consumes JS arguments with
(`classMethodArity` / `JsInArgCount` in calls.cc), so the arity a method
reports is by construction the arity a call consumes. A rest-args thunk
reported 0 for everything, which @gjsify/gtk-host's descriptor conformance
read as `add_titled() takes 3 argument(s), but GtkStack's takes 0`. Pinned by
the `callable-arity` conformance program. Two shapes still diverge because
their CALLING CONVENTION diverges (see `status/open-todos.md`): a
variable-length caller-allocates OUT array (`Gio.InputStream.read`: gjs 2,
node-gi 1) and a GDestroyNotify with no closure index
(`Gio.MemoryInputStream.add_data`: gjs 1, node-gi 2).

Lookup order on a wrapper: own JS field → the class prototype chain →
`runAsync` / the GObject.js shims → GObject property → inherited `Object.prototype`
member → a `Gio._promisify` registration → introspected method → `undefined`.

Deliberate divergences from GJS, all measured:

- class prototypes are NOT chained to their base classes, so `instanceof` goes
  through `g_type_is_a` (see below) and an interface method materializes once per
  implementing class instead of being one shared function;
- GObject **properties** are not surfaced as prototype accessors — they resolve on
  the instance only;
- a private concrete GType (`GLocalFile`) resolves to its nearest INTROSPECTABLE
  ancestor rather than to the interface GJS would use, which is why
  `Gio._promisify` also keeps a per-class registry.

### `GLib.Variant` (build + unpack, GJS semantics)

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

### `GObject.registerClass` (GJS-shaped decorator)

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
caveat the signal/vfunc layer carries).

### `GObject` conveniences (signals, `GObject.Value`, `Object.new`)

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

### `GLib` conveniences (`log_structured`, one-shot idle/timeout)

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

### `Gio.DBus` (client proxy, name owning + object export)

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
`dbus-run-session` by `npm run test:dbus`, which passes
`--config-file=test/session.conf` — a plain `unix:tmpdir=/tmp` bus, because
dbus-run-session's DEFAULT config cannot start on macOS, where Homebrew's dbus
listens on launchd). Lifetime: the registration ref+sinks
its closures, so the service object lives exactly as long as the registration
(surviving GC with no JS references) and becomes collectable after
`unexport()` — guarded by the `--expose-gc` leg of the dbus suite. A method
handler receives the GJS-appended trailing `Gio.UnixFDList` argument (`null`
when the call carries no fds — verified against gjs; an actual fd-carrying
call arrives as a wrapped `UnixFDList` but deeper fd extraction is untested).
As under GJS, a **sync** self-call from the exporting process deadlocks the
shared main loop that must also service the incoming request — use the async
`NameRemote` forms.

### Promise draining under a blocking loop (all three runtimes)

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

## GJS ambient globals (`@gjsify/node-gi/globals`)

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

## cairo (`@gjsify/node-gi/cairo`)

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

