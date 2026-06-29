// SPDX-License-Identifier: MIT
// @gjsify/node-gi — thin ESM loader for the native GObject-Introspection addon.
//
// Reference: refs/node-gtk (romgrk, MIT). Hand-authored loader shim — a native
// package's JS entry is a loader, not a tsc artifact, and the repo ignores
// `lib/`, so it lives at the package root. The native binary is built by
// node-gyp into build/{Release,Debug}.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url)); // package root

function loadNative() {
  const candidates = [
    join(here, 'build', 'Release', 'node_gi.node'),
    join(here, 'build', 'Debug', 'node_gi.node'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return require(candidate);
  }
  throw new Error(
    '@gjsify/node-gi: native addon not built. Run `node-gyp rebuild` in ' +
      here +
      ' (requires a C++ toolchain and the girepository-2.0 / glib-2.0 development headers).',
  );
}

const native = loadNative();

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
 * override runs as a method on the instance (`this` is the GObject handle). vfunc
 * chain-up to the parent implementation lands in a later milestone.
 * @param {string} name unique GType name, e.g. "MyAction"
 * @param {string} parentNamespace e.g. "Gio"
 * @param {string} parentTypeName e.g. "SimpleAction"
 * @param {{ properties?: Array<{name:string,type:string,flags?:number,default?:unknown,minimum?:number,maximum?:number}>, signals?: Array<{name:string,paramTypes?:string[],returnType?:string,flags?:number}>, vfuncs?: Record<string, (...args: unknown[]) => unknown> }} [options]
 * @returns {unknown} opaque type handle
 */
export const registerClass = native.registerClass;

/**
 * Construct a GObject of a registered type handle (from {@link registerClass})
 * with optional construct/settable properties, returning an owned handle.
 * @param {unknown} typeHandle a handle from {@link registerClass}
 * @param {Record<string, unknown>} [props]
 * @returns {unknown} opaque GObject handle
 */
export const constructType = native.constructType;

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
 * Whether `value` is one of node-gi's GObject-instance handles (tag-checked, no
 * dereference). Lets the L1 wrapper wrap object-typed return values for chaining
 * without misclassifying a registerClass type handle.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isGObjectHandle = native.isGObjectHandle;

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
 * the process loop. Idempotent and harmless until a GLib loop actually runs (it
 * adds no libuv handle, so it neither keeps Node alive nor pumps libuv on its
 * own). The L1 layer calls it once when a namespace is first required.
 * @returns {void}
 */
export const startMainLoop = native.startMainLoop;

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

export default native;
