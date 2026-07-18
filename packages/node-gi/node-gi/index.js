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

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url)); // package root

/**
 * Which JS runtime we are on. The Node-API addon loads on all three, but the
 * libuv-backed main-loop bridge (startMainLoop) is Node-only — Deno exports no
 * libuv symbols and Bun panics on uv_backend_fd — so Bun/Deno use the portable
 * GLib-iteration pump instead (see gi.js). Detection order matters: Bun and Deno
 * both expose a `process` shim, so probe their own globals first.
 * @type {'bun' | 'deno' | 'node'}
 */
export const RUNTIME =
  typeof globalThis.Bun !== 'undefined'
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

function loadNative() {
  for (const candidate of nativeCandidates()) {
    if (existsSync(candidate)) return require(candidate);
  }
  throw new Error(
    `@gjsify/node-gi: native addon not found for ${RUNTIME} on ${process.platform}-${process.arch}. ` +
      `Expected a prebuild at prebuilds/${process.platform}-${process.arch}/node_gi.node or a local build. ` +
      'Run `node-gyp rebuild` in ' +
      here +
      ' (requires a C++ toolchain and the girepository-2.0 / glib-2.0 development headers), ' +
      'or install a package build that ships a prebuild for your platform.',
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
 * the process loop. Idempotent and harmless until a GLib loop actually runs (it
 * adds no libuv handle, so it neither keeps Node alive nor pumps libuv on its
 * own). The L1 layer calls it once when a namespace is first required.
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

export default native;
