// SPDX-License-Identifier: MIT
// @gjsify/node-gi — thin ESM loader for the native GObject-Introspection addon.
//
// Reference: refs/node-gtk (romgrk, MIT). Hand-authored loader shim — a native
// package's JS entry is a loader, not a tsc artifact, and the repo ignores
// `lib/`, so it lives at the package root. The native binary is built by
// node-gyp into build/{Release,Debug}; a published package instead ships a
// prebuild under prebuilds/<platform>-<arch>/.
//
// The addon is Node-API (ABI-stable), so it loads unchanged on Node, Bun and
// Deno — the three runtimes that implement Node-API. Runtime-specific behaviour
// (the libuv main-loop bridge is Node-only) is gated in gi.js off RUNTIME below.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import {
    activateBundledGtkRuntime,
    maybePrependGtkRuntimeDllPath,
    maybeReexecForGtkRuntime,
    maybeWireGtkWindowingEnv,
} from './gtk-runtime.js';

// macOS batteries-included GTK: if a relocated bundle ships for this platform,
// re-exec ONCE with DYLD_FALLBACK_LIBRARY_PATH pointed at it BEFORE the addon (and
// its GTK dependency closure) is dlopen'd — dyld only reads that var at launch, and
// GObject-Introspection needs it to g_module_open type backers (get_type / Pango /
// Gdk / Graphene) by leaf soname. No-op off darwin, without a bundle, or once the
// fallback already covers the bundle (the re-exec'd child). Never returns on re-exec.
maybeReexecForGtkRuntime();

// Windows batteries-included GTK: if a bundle ships for this platform, prepend its
// gtk/bin DLL dir to process.env.PATH BEFORE the addon is require()'d below. Windows
// re-reads the DLL search path at each LoadLibrary (unlike dyld's launch-time
// capture), so this in-process PATH mutation is enough for the addon's static DLL
// imports AND the runtime g_module_open of typelib backers — no re-exec needed.
// No-op off win32 / without a bundle.
maybePrependGtkRuntimeDllPath();

// Windows FULL-WINDOWING GTK: when the bundle carries the runtime data a real GTK
// WINDOW needs (compiled GSettings schemas, gdk-pixbuf loaders, icon themes,
// fontconfig — the `--windowing` superset), wire the env vars that locate it
// (GSETTINGS_SCHEMA_DIR / GDK_PIXBUF_MODULE_FILE / XDG_DATA_DIRS / FONTCONFIG_*).
// Strict no-op off win32, without a bundle, or for the display-free bundle (no
// windowing data) — so a display-free bundle load is byte-unchanged.
maybeWireGtkWindowingEnv();

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url)); // package root

/**
 * Which JS runtime we are on. The Node-API addon loads on all four: Node, Bun
 * and Deno implement Node-API natively; under GJS the `@gjsify/napi` shim is
 * the N-API host and the addon is loaded through it (`loadNative` below). The
 * libuv-backed main-loop bridge (startMainLoop) is Node-only — Deno exports no
 * libuv symbols and Bun panics on uv_backend_fd — so Bun/Deno use the portable
 * GLib-iteration pump instead (see gi.js), and GJS needs NEITHER: the host
 * loop already IS GLib's default main context. Detection order matters: GJS is
 * probed first via its own globals (`imports` + `print` — no other runtime
 * defines both), then Bun/Deno (both expose a `process` shim), then Node.
 * @type {'bun' | 'deno' | 'gjs' | 'node'}
 */
export const RUNTIME =
  typeof globalThis.imports !== 'undefined' && typeof globalThis.print === 'function'
    ? 'gjs'
    : typeof globalThis.Bun !== 'undefined'
      ? 'bun'
      : typeof globalThis.Deno !== 'undefined'
        ? 'deno'
        : 'node';

/** Whether we are on Node.js (the only runtime with the libuv main-loop bridge). */
export const isNodeRuntime = RUNTIME === 'node';

function nativeCandidates() {
  const prebuild = join(here, 'prebuilds', `${process.platform}-${process.arch}`, 'node_gi.node');
  const release = join(here, 'build', 'Release', 'node_gi.node');
  const debug = join(here, 'build', 'Debug', 'node_gi.node');
  // NODE_GI_NATIVE pins which binary loads. The package's own test scripts set
  // `build` so local verification always exercises the JUST-BUILT addon — a stale
  // staged prebuild would otherwise shadow build/Release and silently validate
  // the wrong binary (the consumer-facing default below prefers the prebuild).
  const prefer = process.env.NODE_GI_NATIVE;
  if (prefer === 'build') return [release, debug, prebuild];
  if (prefer === 'prebuild') return [prebuild];
  if (prefer) return [prefer]; // an explicit path to a node_gi.node
  // Default: prefer a shipped prebuild so a consumer needs no C toolchain and no
  // node-gyp — the only install path Deno supports (it runs no postinstall build
  // script). Fall back to a locally built addon (Release, then Debug).
  return [prebuild, release, debug];
}

// GJS host mode: the addon is loaded through the @gjsify/napi shim, not
// `require()`. The loader native is `globalThis.__gjsifyNapiLoadAddon`,
// installed by `GjsifyNapi.init()`; if another consumer (the @gjsify/napi L1)
// already captured + deleted it, init() re-defines it (idempotent). The
// GjsifyNapi typelib must be resolvable (GI_TYPELIB_PATH/LD_LIBRARY_PATH →
// the shim prebuild).
function gjsLoadAddon(path) {
  let load = globalThis.__gjsifyNapiLoadAddon;
  if (typeof load !== 'function') {
    const GjsifyNapi = globalThis.imports?.gi?.GjsifyNapi;
    if (!GjsifyNapi || !GjsifyNapi.init()) {
      throw new Error(
        '@gjsify/node-gi: GJS host mode needs the @gjsify/napi shim — the GjsifyNapi ' +
          'typelib is not loadable (point GI_TYPELIB_PATH and LD_LIBRARY_PATH at its prebuild).',
      );
    }
    load = globalThis.__gjsifyNapiLoadAddon;
    if (typeof load !== 'function') {
      throw new Error('@gjsify/node-gi: GjsifyNapi.init() did not install the addon loader.');
    }
    // Capture-then-delete, the same no-side-channel discipline as the L1.
    delete globalThis.__gjsifyNapiLoadAddon;
  }
  return load(path);
}

function loadNative() {
  for (const candidate of nativeCandidates()) {
    if (existsSync(candidate)) {
      return RUNTIME === 'gjs' ? gjsLoadAddon(candidate) : require(candidate);
    }
  }
  throw new Error(
    `@gjsify/node-gi: native addon not found for ${RUNTIME} on ${process.platform}-${process.arch}. ` +
      `Expected a prebuild at prebuilds/${process.platform}-${process.arch}/node_gi.node or a local build. ` +
      'Run `node-gyp rebuild` in ' +
      here +
      ' (requires a C++ toolchain and the girepository-2.0 / glib-2.0 development headers), ' +
      'or install a package build that ships a prebuild for your platform. ' +
      'Under a bundled GJS app (import.meta anchors at the bundle), set NODE_GI_NATIVE to the addon path.',
  );
}

const native = loadNative();

// ---- batteries-included GTK runtime (macOS) ---------------------------------
//
// Before any namespace is required, activate a relocated GTK/GI runtime bundle
// if one ships for this platform (@gjsify/gtk-runtime-<platform>-<arch>, or a
// staged prebuilds/<platform>-<arch>/gtk/). This prepends the bundle's typelib
// dir to the GIRepository search path (env-free) so gi:// namespaces load with
// no Homebrew/system GTK. No-op on platforms without a bundle, and harmless when
// none is present (the addon then uses the host's GTK as before). Darwin-only
// today — see gtk-runtime.js + @gjsify/gtk-runtime-darwin-arm64.
try {
  activateBundledGtkRuntime(native);
} catch {
  // Never fatal: a missing/partial bundle just leaves the host GTK in charge.
}

// ---- cross-runtime microtask checkpoint (Bun/Deno) --------------------------
//
// Node's napi_make_callback runs the nextTick + microtask checkpoint when its
// callback scope closes, so promise continuations queued by a loop-dispatched
// GLib→JS callback (a DBus method-call closure, a GLib timeout, a GTK signal)
// drain at the callback boundary even while a blocking
// GLib.MainLoop.run()/Gio.Application.run() owns the thread. Bun's and Deno's
// N-API implementations perform NO checkpoint there (Deno's napi_make_callback
// is a plain Function::Call; Deno's own FFI trampoline drains explicitly for
// exactly this reason), and with the runtime's event loop paused for the
// blocking run's lifetime the queue never drained: an async (Promise-returning)
// DBus method handler never sent its reply — the client timed out — while sync
// handlers worked. Register the runtime's own drain primitive with the engine;
// the loop-dispatched trampolines (src/signals.cc / calls.cc / class.cc) invoke
// it after each OUTERMOST callback returns (NodeGiMaybeDrainMicrotasks),
// matching Node's checkpoint and GJS (SpiderMonkey drains the promise-job queue
// when the last JS frame exits). Node never registers — its checkpoint already
// runs natively, so the Node path is byte-identical to before.
// GJS never registers: SpiderMonkey/GJS drains the promise-job queue from its
// own main-loop source whenever the last JS frame exits — the exact semantic
// this checkpoint recreates for Bun/Deno.
if (!isNodeRuntime && RUNTIME !== 'gjs') {
  try {
    let drain = null;
    if (RUNTIME === 'bun') {
      // JSC: drains the VM's microtask queue; callable mid-stack by design
      // (Bun's own processTicksAndRejections calls it from JS).
      ({ drainMicrotasks: drain } = require('bun:jsc'));
    } else if (typeof globalThis.Deno?.internal === 'symbol') {
      // V8: the checkpoint needs BOTH queues. core.runMicrotasks is only
      // Isolate::PerformMicrotaskCheckpoint; Deno's node-compat
      // process.nextTick queue is a SEPARATE deno_core queue
      // (ext:deno_node/_next_tick.ts → core.queueNextTick) that only the
      // runtime's own event loop drains — and that loop is paused for the
      // whole lifetime of a blocking run(). node:stream delivers stream
      // 'end' via process.nextTick (endReadableNT), so with a
      // microtask-only drain any body consumption over a Readable
      // (@gjsify/fetch consumeBody → XHR arrayBuffer/text) got its chunks
      // (microtask-delivered) but never the end: every asset load hung at
      // readyState 3 forever on Deno while the SAME bundle settled on Bun,
      // whose nextTick rides JSC's microtask queue (bun:jsc
      // drainMicrotasks covers it). core.runNextTicks mirrors node's
      // task_queues.js runNextTicks: microtask checkpoint when no ticks
      // are scheduled, full processTicksAndRejections (ticks + microtasks
      // interleaved) when there are — one call, both queues. Regression:
      // test/blocking-run-checkpoint.test.mjs.
      const core = globalThis.Deno[globalThis.Deno.internal]?.core;
      if (typeof core?.runNextTicks === 'function') {
        drain = () => core.runNextTicks();
      } else if (typeof core?.runMicrotasks === 'function') {
        // Older deno_core without runNextTicks: microtask-only drain
        // (pre-fix behaviour — promise continuations settle, nextTick
        // consumers like node:stream 'end' still starve).
        drain = () => core.runMicrotasks();
      }
    }
    if (typeof drain === 'function') native.setMicrotaskDrain(drain);
  } catch {
    // Unregistered ⇒ pre-fix behaviour on this runtime build: promise
    // continuations drain only when the runtime's own loop runs
    // (startMainContextPump); async DBus replies inside a BLOCKING run stay
    // unavailable. Never fatal — the sync surface is unaffected.
  }
}

/**
 * Require a GObject-Introspection namespace and report its resolved version
 * and top-level info count. The Node twin of GJS's gi:// / imports.gi load step.
 * @param {string} namespace e.g. "GLib"
 * @param {string} [version] e.g. "2.0" (omit to let GIRepository resolve)
 * @returns {{ namespace: string, version: string, infoCount: number }}
 */
export const requireNamespace = native.requireNamespace;

/**
 * Enumerate the top-level introspection-info names of an already-required namespace.
 * @param {string} namespace
 * @returns {string[]}
 */
export const listInfoNames = native.listInfoNames;

/**
 * Classify a top-level namespace member (so the L1 wrapper knows whether it is a
 * constructible class, a callable function, an enum, a constant, …). Returns
 * `null` when the name is not found.
 * @param {string} namespace
 * @param {string} name
 * @returns {{ kind: 'function'|'object'|'interface'|'struct'|'union'|'enum'|'flags'|'constant'|'callback'|'other' } | null}
 */
export const findInfo = native.findInfo;

/**
 * Read a namespace-level GI constant (e.g. `GLib.PRIORITY_DEFAULT`) and marshal
 * it to a JS value.
 * @param {string} namespace
 * @param {string} name
 * @returns {unknown}
 */
export const getConstantValue = native.getConstantValue;

/**
 * Enumerate an enum/flags type's members as `{ rawGiName: number }` (the L1
 * wrapper re-keys them GJS-style: UPPER_CASE with `-` → `_`).
 * @param {string} namespace
 * @param {string} name
 * @returns {Record<string, number>}
 */
export const getEnumValues = native.getEnumValues;

/**
 * For an enum type registered as a GError domain (e.g. `Gio.IOErrorEnum`), report
 * its domain quark name + numeric quark; `null` for a plain enum. The L1 wrapper
 * attaches this to the enum object so `error.matches(Gio.IOErrorEnum, code)` can
 * resolve the enum to its error domain.
 * @param {string} namespace
 * @param {string} name
 * @returns {{ name: string, quark: number } | null}
 */
export const getErrorDomain = native.getErrorDomain;

/**
 * Register the L1 GLib.Error factory the engine calls when a GI invoke fails, so
 * a failed sync call throws a real `GLib.Error` (instanceof, with `.matches()`).
 * The builder receives `(domainName, domainQuark, code, message)` and returns the
 * Error to throw. Called once by the L1 layer at load.
 * @param {(domainName: string, domainQuark: number, code: number, message: string) => Error} builder
 * @returns {void}
 */
export const setErrorBuilder = native.setErrorBuilder;

/**
 * Prepend a directory to the GIRepository typelib search path (call before
 * requireNamespace for non-system typelibs).
 * @param {string} path
 * @returns {void}
 */
export const prependSearchPath = native.prependSearchPath;

/**
 * Invoke a namespace-level GObject-Introspection function (not an instance
 * method) with IN-only primitive/string arguments. The first marshalling slice;
 * instance methods, OUT/INOUT params and compound types follow.
 * @param {string} namespace e.g. "GLib"
 * @param {string} functionName e.g. "get_host_name"
 * @param {unknown[]} [args]
 * @returns {unknown}
 */
export const callFunction = native.callFunction;

/**
 * Invoke an instance method on a GObject handle with IN-only
 * primitive/string/object/enum args. The method is resolved against the
 * instance's introspection type (own + implemented-interface methods, then up
 * the parent chain) — the Node twin of `obj.method(...)`.
 * @param {unknown} handle a handle from {@link newObject}
 * @param {string} methodName GI method name, e.g. "get_name"
 * @param {unknown[]} [args]
 * @returns {unknown}
 */
export const callMethod = native.callMethod;

/**
 * `true` iff {@link callMethod} would resolve an invocable instance method for
 * `methodName` (literal introspected name or snake_case alias, walking the same
 * own/interface/parent chain). Feature detection — never throws for a merely
 * unknown name; a non-introspectable instance reports `false`. Backs the L1
 * wrapper's GJS-parity property access (`obj.nonexistentMethod === undefined`).
 * @param {unknown} handle a handle from {@link newObject}
 * @param {string} methodName GI method name, e.g. "get_name"
 * @returns {boolean}
 */
export const hasMethod = native.hasMethod;

/**
 * Invoke a type-level constructor/static function (e.g. `Gio.File.new_for_path`,
 * `Gtk.Label.new`) — a function found on a type but taking no instance. The Node
 * twin of `Ns.Class.method(...)`.
 * @param {string} namespace e.g. "Gio"
 * @param {string} typeName e.g. "File"
 * @param {string} methodName e.g. "new_for_path"
 * @param {unknown[]} [args]
 * @returns {unknown}
 */
export const callStaticMethod = native.callStaticMethod;

/**
 * Construct a boxed/plain struct instance — the `new <Struct>()` path (GJS
 * gi/boxed.cpp parity). A struct WITH a 'new' constructor routes to it with
 * `args` (e.g. `GLib.MainLoop`); a struct WITHOUT one and ZERO args is
 * zero-allocated (`Graphene.Rect`, `Gdk.RGBA`); args without a 'new' throw.
 * @param {string} namespace e.g. "Graphene"
 * @param {string} typeName e.g. "Rect"
 * @param {unknown[]} [args]
 * @returns {unknown} boxed handle
 */
export const constructStruct = native.constructStruct;

/**
 * Construct a GObject of `namespace.typeName` with optional construct/settable
 * properties, returning an opaque handle owned by node-gi (released on GC).
 * @param {string} namespace e.g. "Gio"
 * @param {string} typeName e.g. "SimpleAction"
 * @param {Record<string, unknown>} [props]
 * @returns {unknown} opaque GObject handle
 */
export const newObject = native.newObject;

/**
 * Register a new GObject subclass of `parentNamespace.parentTypeName` named
 * `name`, inheriting the parent's class/instance layout, and return an opaque
 * type handle. Construct instances of it with {@link constructType}. The optional
 * `options` installs custom properties (backed by a per-instance value store),
 * signals, and vfunc overrides in the new type's `class_init` — the Node twin of
 * (the engine half of) GJS's `GObject.registerClass`. A `vfuncs` entry maps a
 * parent vfunc name (e.g. `constructed`) to a JS function that overrides it; the
 * override runs as a method on the instance (`this` is the GObject handle) and can
 * chain up to the parent implementation via {@link callParentVfunc}.
 * @param {string} name unique GType name, e.g. "MyAction"
 * @param {string} parentNamespace e.g. "Gio"
 * @param {string} parentTypeName e.g. "SimpleAction"
 * @param {{ properties?: Array<{name:string,type:string,flags?:number,default?:unknown,minimum?:number,maximum?:number}>, signals?: Array<{name:string,paramTypes?:string[],returnType?:string,flags?:number}>, vfuncs?: Record<string, (...args: unknown[]) => unknown> }} [options]
 * @returns {unknown} opaque type handle
 */
export const registerClass = native.registerClass;

/**
 * Register a new GObject subclass of an ALREADY-REGISTERED parent type, given the
 * parent's GType handle (from a previous {@link registerClass} / its `$gtype`)
 * rather than a `namespace.typeName`. This is the multi-level registered-of-
 * registered path: a registered (dynamic) parent has no introspection entry, so it
 * cannot be resolved by name. Inherited custom properties, signals and vfunc slots
 * of registered ancestors compose for free through normal GObject inheritance. The
 * L1 `GObject.registerClass` picks this variant (over {@link registerClass}) when
 * the nearest base is itself a registered class.
 * @param {string} name unique GType name, e.g. "AdwStorybookClamp"
 * @param {unknown} parentGType a GType handle from {@link registerClass} (the parent's `$gtype`)
 * @param {{ properties?, signals?, vfuncs?, template?, cssName?, children?, internalChildren? }} [options]
 * @returns {unknown} opaque type handle
 */
export const registerClassFromGType = native.registerClassFromGType;

/**
 * Construct a GObject of a registered type handle (from {@link registerClass})
 * with optional construct/settable properties, returning an owned handle. For a
 * templated type the engine runs `gtk_widget_init_template` before returning.
 * @param {unknown} typeHandle a handle from {@link registerClass}
 * @param {Record<string, unknown>} [props]
 * @returns {unknown} opaque GObject handle
 */
export const constructType = native.constructType;

/**
 * Chain up to the parent implementation of an overridden vfunc — the engine half
 * of `super.vfunc_<name>(...)`. Invokes the function that was in the instance
 * type's vtable slot BEFORE the registerClass override was installed (the C
 * default, or a JS override further up the chain), with `handle` as the instance
 * and `args` as the vfunc's declared arguments; returns the marshalled vfunc
 * return (or undefined for a void vfunc). The L1 layer wires it to
 * `super.vfunc_<name>` via the introspected base class's prototype chain. Throws
 * if no overridden vfunc by that name owns a slot on the instance's type.
 * @param {unknown} handle a GObject handle (the instance / `this` in the override)
 * @param {string} vfuncName the vfunc name without the `vfunc_` prefix, e.g. "constructed"
 * @param {unknown[]} [args] the vfunc's declared IN arguments
 * @returns {unknown}
 */
export const callParentVfunc = native.callParentVfunc;

/**
 * Resolve a Gtk.Widget composite-template child (bound via the registerClass
 * Children/InternalChildren options) by id on a templated instance —
 * `gtk_widget_get_template_child(widget, G_OBJECT_TYPE(widget), name)`. Returns the
 * child as a wrapped GObject handle (borrowed; owned by the parent via the
 * template) or `null`. The L1 layer assigns it onto the instance (`this.<name>` /
 * `this._<name>`).
 * @param {unknown} handle a templated GObject handle from {@link constructType}
 * @param {string} name the template child id
 * @returns {unknown} opaque child GObject handle, or null
 */
export const getTemplateChild = native.getTemplateChild;

/**
 * Read a GObject property.
 * @param {unknown} handle a handle from {@link newObject}
 * @param {string} name property name (kebab- or snake-case as GObject expects)
 * @returns {unknown}
 */
export const getProperty = native.getProperty;

/**
 * Write a GObject property.
 * @param {unknown} handle a handle from {@link newObject}
 * @param {string} name property name
 * @param {unknown} value
 * @returns {void}
 */
export const setProperty = native.setProperty;

/**
 * Whether the instance's type has a GObject property by this name (kebab- or
 * snake-case). The L1 wrapper uses it to route `obj.foo` to a property read vs
 * an `obj.foo()` method call.
 * @param {unknown} handle
 * @param {string} name
 * @returns {boolean}
 */
export const hasProperty = native.hasProperty;

/**
 * The runtime GType name of a GObject handle (e.g. "GSimpleAction").
 * @param {unknown} handle
 * @returns {string}
 */
export const getTypeName = native.getTypeName;

/**
 * The runtime GType of an introspected registered type, as an opaque node-gi
 * GType handle (a tag-distinct External carrying the GType — NOT a number/pointer).
 * The L1 layer surfaces it as a lazy `Ns.Type.$gtype` getter and feeds it to
 * GType-typed GI arguments (`GObject.type_ensure`, `g_param_spec_object`'s value
 * type, …). Returns `null` for an unknown/unregistered name.
 * @param {string} namespace e.g. "Adw"
 * @param {string} name e.g. "Clamp"
 * @returns {unknown} opaque GType handle, or null
 */
export const getGType = native.getGType;

/**
 * Whether a GObject handle's GType is-a `namespace.typeName` (g_type_is_a — also
 * true when the type implements an interface). Used by the L1 wrapper to pick the
 * right `Gio._promisify` registration when two classes promisify a method of the
 * same name.
 * @param {unknown} handle
 * @param {string} namespace
 * @param {string} typeName
 * @returns {boolean}
 */
export const isInstanceOf = native.isInstanceOf;

/**
 * Whether `value` is one of node-gi's GObject-instance handles (tag-checked, no
 * dereference). Lets the L1 wrapper wrap object-typed return values for chaining
 * without misclassifying a registerClass type handle.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isGObjectHandle = native.isGObjectHandle;

/**
 * Allocate a fresh, zero-initialised GValue and return it as a node-gi boxed
 * handle (GType G_TYPE_VALUE, owned → freed on GC). GObject.Value has no
 * `g_value_new()`, so the L1 layer (gi.js `makeValueClass`) uses this to build a
 * `new GObject.Value()` and then drives `.init(gtype)` / `.set_*` / `.get_*` /
 * `.copy` / `.unset` through the boxed-method path.
 * @returns {unknown} opaque GObject.Value boxed handle
 */
export const newGValue = native.newGValue;

/**
 * Invoke an instance method on a boxed/struct handle (e.g. `mainLoop.run()` /
 * `mainLoop.quit()`). The method is resolved against the boxed GType's
 * introspection info and invoked with the boxed pointer as the instance.
 * @param {unknown} handle a boxed handle (e.g. from `GLib.MainLoop.new(...)`)
 * @param {string} methodName GI method name, e.g. "run"
 * @param {unknown[]} [args]
 * @returns {unknown}
 */
export const callBoxedMethod = native.callBoxedMethod;

/**
 * Whether `value` is one of node-gi's boxed/struct handles (tag-checked, no
 * dereference). The L1 wrapper uses it to wrap boxed return values (GMainLoop,
 * …) with a method-routing proxy.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isBoxedHandle = native.isBoxedHandle;

/**
 * Classify a name on a boxed/struct/union handle: 0 (neither) | 1 (method) |
 * 2 (field). Methods take priority (gjs renames a colliding field to `_name`), so
 * the L1 wrapBoxed uses this to route method-dispatch vs field get/set.
 * @param {unknown} handle a node-gi boxed handle
 * @param {string} name GI member name (snake_case)
 * @returns {number}
 */
export const boxedMemberKind = native.boxedMemberKind;

/**
 * Read a named field of a boxed/struct/union handle (`simpleStruct.long_`).
 * Throws if `name` is not a field, or the field is unreadable/unsupported.
 * @param {unknown} handle a node-gi boxed handle
 * @param {string} name GI field name (snake_case)
 * @returns {unknown}
 */
export const getBoxedField = native.getBoxedField;

/**
 * Write a simple-typed field of a boxed/struct/union handle (`union.long_ = 5`).
 * Throws if `name` is not a field, or the field is unwritable/unsupported.
 * @param {unknown} handle a node-gi boxed handle
 * @param {string} name GI field name (snake_case)
 * @param {unknown} value
 * @returns {void}
 */
export const setBoxedField = native.setBoxedField;

/**
 * The boxed handle's GType name (e.g. "GBytes"), or null when it carries no
 * registered GType. Lets the L1 layer attach type-specific conveniences (the
 * GLib.Bytes `toArray` shim) without a per-type wrapper.
 * @param {unknown} value
 * @returns {string | null}
 */
export const boxedTypeName = native.boxedTypeName;

/**
 * Whether `value` is a node-gi GParamSpec handle (tag-checked, no dereference).
 * The L1 wrapper uses it to give a notify handler's pspec / a GParamSpec-typed
 * value the GObject.ParamSpec ergonomics.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isParamSpecHandle = native.isParamSpecHandle;

/**
 * True when `value` is a node-gi non-GObject GObject-fundamental handle (e.g. a
 * GskRenderNode from Gtk.Snapshot.to_node, a GdkEvent) — introspected as object
 * info but ref-counted via its own ref/unref funcs (NOT g_object_ref). The L1
 * wrapper surfaces it as an opaque, round-trippable pass-through handle.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isFundamentalHandle = native.isFundamentalHandle;

/**
 * Read a GParamSpec accessor by name: name | nick | blurb | flags | valueType |
 * ownerType | defaultValue. Backs the L1 GObject.ParamSpec getters + methods.
 * @param {unknown} handle a node-gi GParamSpec handle
 * @param {string} which the accessor name
 * @returns {unknown}
 */
export const paramSpecProp = native.paramSpecProp;

/**
 * Build a GVariant from a GVariant type signature + JS value, returning an owned
 * boxed GLib.Variant handle (the floating ref is sunk; released on GC). The
 * recursive native packer behind `new GLib.Variant(signature, value)`. Supports
 * the basics `b y n q i u x t h d s o g`, `v`, `m*` maybe, `a*` arrays (incl.
 * `as`, `ay`, `a{..}` dicts), `(...)` tuples and `{kv}` dict-entries.
 * @param {string} signature a GVariant type string, e.g. "a{sv}", "(si)", "s"
 * @param {unknown} [value]
 * @returns {unknown} boxed GLib.Variant handle
 */
export const variantNew = native.variantNew;

/**
 * Unpack a GLib.Variant handle to a JS value. `deep` unpacks container children
 * (one level for nested `v` variants, which stay Variants unless `recursive`);
 * `recursive` additionally unwraps nested `v` variants to plain JS. Drives the
 * L1 `.unpack()` (deep=false), `.deepUnpack()` (deep=true) and
 * `.recursiveUnpack()` (deep=true, recursive=true).
 * @param {unknown} handle a handle from {@link variantNew} (or a returned Variant)
 * @param {boolean} [deep]
 * @param {boolean} [recursive]
 * @returns {unknown}
 */
export const variantUnpack = native.variantUnpack;

/**
 * The GVariant type string of a GLib.Variant handle (e.g. "a{sv}").
 * @param {unknown} handle
 * @returns {string}
 */
export const variantGetTypeString = native.variantGetTypeString;

/**
 * Whether `value` is one of node-gi's GLib.Variant handles (a boxed handle
 * tagged with the GVariant GType; tag-checked, no dereference). The L1 wrapper
 * uses it to give returned/unpacked variants the GLib.Variant ergonomics.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isVariantHandle = native.isVariantHandle;

/**
 * Attach the libuv-backed GSource to the default GLib main context so a blocking
 * GLib main loop (`GLib.MainLoop.run()`, `Gio.Application.run()`) keeps Node's
 * timers, promises and I/O alive — the Node twin of GJS running the GLib loop as
 * the process loop. Also arms the uv-driven GLib AUTO-PUMP for the non-blocking
 * case: pending GLib sources (Gio async completions, GLib timeouts/idles, DBus)
 * dispatch from Node's own libuv loop, so a plain `node bundle.mjs` that awaits a
 * Gio async op needs NO explicit mainloop (matching GJS, where the GLib loop is
 * the process loop). An in-flight scope=async callback (GAsyncReadyCallback) and
 * an armed GLib timeout keep the process alive like Node's own pending I/O and
 * timers; a purely-sync program still exits immediately. Idempotent. The L1 layer
 * calls it once when a namespace is first required.
 * @returns {void}
 */
export const startMainLoop = native.startMainLoop;

/**
 * Iterate the default GLib main context once, dispatching any ready sources (GIO
 * async callbacks, GLib timeouts/idles, DBus). Pure GLib — no libuv — so it is the
 * portable main-loop primitive on Bun/Deno, where {@link startMainLoop} can't run.
 * The L1 layer drives it from a JS timer to co-pump GLib while the runtime's own
 * event loop stays in control. Returns true if a source was dispatched.
 * @param {boolean} [mayBlock] block until a source is ready (default false)
 * @returns {boolean}
 */
export const iterateMainContext = native.iterateMainContext;

/**
 * Drain ready GLib sources + re-arm the auto-pump's libuv wake-ups NOW (no-op
 * unless {@link startMainLoop} armed the pump, i.e. Node's main env). The L1
 * layer wires this to `process.on('beforeExit')`: with only unref'd handles
 * active, `uv_run` exits without ever running the pump's prepare/check phase, so
 * an otherwise-empty loop would never arm GLib's timer wake-up — beforeExit
 * fires exactly then, and the kick revives the loop while GLib still has
 * scheduled work. Rarely needed directly.
 * @returns {void}
 */
export const pumpKick = native.pumpKick;

/**
 * Register the runtime-native microtask drain the engine runs after each
 * OUTERMOST loop-dispatched GLib→JS callback returns (the cross-runtime
 * microtask checkpoint — see the registration block above). Registered
 * automatically at addon load on Bun/Deno; never call it on Node (its
 * napi_make_callback already checkpoints natively). Exposed for completeness.
 * @param {() => void} drain
 * @returns {void}
 */
export const setMicrotaskDrain = native.setMicrotaskDrain;

/**
 * Connect a JS callback to a GObject signal. Returns a handler id for
 * {@link disconnectSignal}. The callback receives the signal arguments
 * (the emitter instance is not passed in this milestone).
 * @param {unknown} handle a handle from {@link newObject}
 * @param {string} signalName
 * @param {(...args: unknown[]) => unknown} callback
 * @param {boolean} [after] connect in the "after" phase
 * @returns {number} handler id
 */
export const connectSignal = native.connectSignal;

/**
 * Emit a signal on a GObject with optional arguments; returns the signal's
 * return value (or undefined for void signals).
 * @param {unknown} handle
 * @param {string} signalName
 * @param {unknown[]} [args]
 * @returns {unknown}
 */
export const emitSignal = native.emitSignal;

/**
 * Disconnect a previously connected signal handler.
 * @param {unknown} handle
 * @param {number} handlerId from {@link connectSignal}
 * @returns {void}
 */
export const disconnectSignal = native.disconnectSignal;

/**
 * Register the L1 resolver that maps a Gtk.Template `<signal handler="…">` handler
 * name to the instance's bound JS method, for the engine's template-callback scope.
 * @param {(handle: unknown, handlerName: string) => ((...args: unknown[]) => unknown) | undefined} resolver
 * @returns {void}
 */
export const setTemplateCallbackResolver = native.setTemplateCallbackResolver;

/**
 * Register the L1 callback the engine's overridden `constructor` vfunc invokes to
 * run a registered class's JS constructor for a GObject it instantiated from C (a
 * GtkBuilder composite-template InternalChild). Given (instanceHandle, gtypeName)
 * it Reflect.constructs the class in adopt mode (see gi.js runCtorForCObject).
 * @param {(handle: unknown, gtypeName: string) => void} cb
 * @returns {void}
 */
export const setConstructCallback = native.setConstructCallback;

/**
 * Install (or clear, with `null`) the structured-log writer function — the
 * engine's twin of GjsPrivate.log_set_writer_func backing GLib.log_set_writer_func.
 * The writer receives (logLevel: number, fields: Record<string, Uint8Array|null>)
 * and returns a GLib.LogWriterOutput. NOTE: GLib allows at most ONE
 * g_log_set_writer_func install per process (a second install aborts in GLib).
 */
export const logSetWriterFunc = native.logSetWriterFunc;

/**
 * Route structured logs back to the default writer (the engine's twin of
 * GjsPrivate.log_set_writer_default backing GLib.log_set_writer_default).
 */
export const logSetWriterDefault = native.logSetWriterDefault;

/**
 * g_object_bind_property_full with JS transform functions — the engine's twin of
 * GjsPrivate.g_object_bind_property_full backing
 * GObject.Object.prototype.bind_property_full.
 */
export const bindPropertyFull = native.bindPropertyFull;

/**
 * g_binding_group_bind_full with JS transform functions — the engine's twin of
 * GjsPrivate.g_binding_group_bind_full backing GObject.BindingGroup.bind_full.
 */
export const bindingGroupBindFull = native.bindingGroupBindFull;

export default native;
