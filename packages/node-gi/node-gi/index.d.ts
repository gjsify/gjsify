// SPDX-License-Identifier: MIT
// @gjsify/node-gi — public type surface (milestone 1: headless-core scaffold).

/** Result of requiring a GObject-Introspection namespace. */
export interface RequiredNamespace {
    /** The namespace name, e.g. "GLib". */
    namespace: string;
    /** The resolved typelib version, e.g. "2.0". */
    version: string;
    /** Number of top-level introspection infos in the namespace. */
    infoCount: number;
}

/**
 * Require a GObject-Introspection namespace and report its resolved version and
 * top-level info count. The Node twin of GJS's `gi://` / `imports.gi` load step.
 */
export function requireNamespace(namespace: string, version?: string): RequiredNamespace;

/** Enumerate the top-level introspection-info names of an already-required namespace. */
export function listInfoNames(namespace: string): string[];

/** The introspection kind of a top-level namespace member. */
export type InfoKind =
    | 'function'
    | 'object'
    | 'interface'
    | 'struct'
    | 'union'
    | 'enum'
    | 'flags'
    | 'constant'
    | 'callback'
    | 'other';

/**
 * Classify a top-level namespace member so the L1 wrapper can decide how to
 * surface it (class vs function vs enum vs constant). Returns `null` when the
 * name is not found in the namespace.
 */
export function findInfo(namespace: string, name: string): { kind: InfoKind } | null;

/** Read a namespace-level GI constant (e.g. `GLib.PRIORITY_DEFAULT`). */
export function getConstantValue(namespace: string, name: string): unknown;

/**
 * Enumerate an enum/flags type's members as `{ rawGiName: number }`. The L1
 * wrapper re-keys them GJS-style (UPPER_CASE, `-` → `_`).
 */
export function getEnumValues(namespace: string, name: string): Record<string, number>;

/**
 * For an enum type registered as a GError domain (e.g. `Gio.IOErrorEnum`), report
 * its domain quark name + numeric quark; `null` for a plain enum.
 */
export function getErrorDomain(namespace: string, name: string): { name: string; quark: number } | null;

/**
 * Register the L1 GLib.Error factory the engine calls when a GI invoke fails, so
 * a failed sync call throws a real `GLib.Error` (instanceof, with `.matches()`).
 */
export function setErrorBuilder(
    builder: (domainName: string, domainQuark: number, code: number, message: string) => Error,
): void;

/** Prepend a directory to the GIRepository typelib search path. */
export function prependSearchPath(path: string): void;
/** Prepend a directory GI searches for the SHARED LIBRARY a typelib names. */
export function prependLibraryPath(path: string): void;

/**
 * Invoke a namespace-level GObject-Introspection function (not an instance
 * method) with primitive/string/object args. OUT and INOUT parameters are
 * supported for fundamentals (numbers/booleans), strings (utf8/filename) and
 * GObjects/enums/flags; only IN/INOUT args are passed in `args`.
 *
 * The return follows the GJS convention: the function's own return value (when
 * non-void) followed by each OUT/INOUT value in argument order — a single value
 * is returned bare, several as an Array, none as `undefined`. Compound OUT types
 * (arrays, GList/GHashTable, structs) are a later milestone and throw a clear
 * "not yet supported" error.
 */
export function callFunction(namespace: string, functionName: string, args?: unknown[]): unknown;

/**
 * Invoke an instance method on a GObject handle with primitive/string/object/enum
 * args, including OUT/INOUT parameters. The method is resolved against the
 * instance's introspection type (own + implemented-interface methods, then up
 * the parent chain). The Node twin of `obj.method(...)`. See {@link callFunction}
 * for the OUT/INOUT return-tuple convention.
 */
export function callMethod(handle: GObjectHandle, methodName: string, args?: unknown[]): unknown;

/**
 * `true` iff {@link callMethod} would resolve an invocable instance method for
 * `methodName` (literal introspected name or snake_case alias, walking the same
 * own/interface/parent chain). Feature detection — never throws for a merely
 * unknown name; a non-introspectable instance reports `false`.
 */
export function hasMethod(handle: GObjectHandle, methodName: string): boolean;

/**
 * The CLASS-level twin of {@link hasMethod}: `true` iff `Ns.Type` declares an
 * invocable instance method by that name (literal introspected name or
 * snake_case alias), across own, implemented-interface and inherited methods.
 * Answers by TYPE rather than by instance handle, which is what lets a class
 * prototype resolve its methods before any instance of it exists.
 */
export function hasClassMethod(namespace: string, typeName: string, methodName: string): boolean;

/**
 * The JS-visible IN-arg count of an instance method — what gjs reports as the
 * materialized function's `length` (IN/INOUT args minus array-length and
 * callback user_data/destroy-notify slots) — or -1 when the name does not
 * resolve to an invocable instance method. Resolution is shared with
 * {@link hasClassMethod}, so `classMethodArity(...) >= 0` answers both
 * questions in one call.
 */
export function classMethodArity(namespace: string, typeName: string, methodName: string): number;

/**
 * Invoke a type-level constructor/static function (e.g. `Gio.File.new_for_path`,
 * `Gtk.Label.new`) — a function found on a type but taking no instance. The Node
 * twin of `Ns.Class.method(...)`. OUT/INOUT params follow {@link callFunction}'s
 * return-tuple convention.
 */
export function callStaticMethod(namespace: string, typeName: string, methodName: string, args?: unknown[]): unknown;

/**
 * Construct a boxed/plain struct instance — the `new <Struct>()` path (GJS
 * gi/boxed.cpp parity). A struct WITH a 'new' constructor routes to it with
 * `args` (e.g. `GLib.MainLoop`); a struct WITHOUT one and ZERO args is
 * zero-allocated (`Graphene.Rect`, `Gdk.RGBA`); args without a 'new' throw.
 */
export function constructStruct(namespace: string, typeName: string, args?: unknown[]): unknown;

/**
 * Opaque handle to a live GObject instance, owned by node-gi and released when
 * the handle is garbage-collected. Pass it back to {@link getProperty} /
 * {@link setProperty} / {@link getTypeName}.
 */
export type GObjectHandle = { readonly __nodeGiGObject: unique symbol };

/**
 * Construct a GObject of `namespace.typeName` with optional construct/settable
 * properties. Milestone 1: fundamental-typed properties (numbers, booleans,
 * strings, enums/flags).
 */
export function newObject(namespace: string, typeName: string, props?: Record<string, unknown>): GObjectHandle;

/**
 * Opaque handle to a registered GType (from {@link registerClass}). Pass it to
 * {@link constructType}.
 */
export type TypeHandle = { readonly __nodeGiGType: unique symbol };

/** A custom GObject property declaration for {@link registerClass}. */
export interface PropertySpec {
    /** Property name (canonical, e.g. "my-prop"). */
    name: string;
    /** Value type. */
    type: 'string' | 'boolean' | 'int' | 'uint' | 'int64' | 'uint64' | 'double' | 'float';
    /** `GParamFlags` bitfield (default `G_PARAM_READWRITE`). */
    flags?: number;
    /** Default value (type-appropriate). */
    default?: string | number | boolean;
    /** Minimum (numeric types). */
    minimum?: number;
    /** Maximum (numeric types). */
    maximum?: number;
}

/** A custom GObject signal declaration for {@link registerClass}. */
export interface SignalSpec {
    /** Signal name (e.g. "my-signal"). */
    name: string;
    /** Parameter types (same vocabulary as {@link PropertySpec.type}, plus "object"). */
    paramTypes?: string[];
    /** Return type ("void" by default). */
    returnType?: string;
    /** `GSignalFlags` bitfield (default `G_SIGNAL_RUN_LAST`). */
    flags?: number;
}

/**
 * Custom vfunc overrides for a {@link registerClass} subtype: a map from a parent
 * GObject vfunc name (e.g. `"constructed"`) to the JS function that overrides it.
 * The override is invoked as a method on the instance — `this` is the GObject
 * handle — with the vfunc's declared arguments as JS arguments, and its return is
 * marshalled back to C. An override can chain up to the parent implementation via
 * {@link callParentVfunc} (the engine half of `super.vfunc_<name>(...)`).
 */
export type VFuncMap = Record<string, (this: GObjectHandle, ...args: unknown[]) => unknown>;

/** Custom properties, signals + vfunc overrides installed on a {@link registerClass} subtype. */
export interface RegisterClassOptions {
    properties?: PropertySpec[];
    signals?: SignalSpec[];
    vfuncs?: VFuncMap;
    /**
     * A Gtk.Widget composite template. Either inline UI-XML (a `Uint8Array`/Buffer
     * or a string) installed via `gtk_widget_class_set_template`, or a
     * `"resource:///…"` path string installed via
     * `gtk_widget_class_set_template_from_resource`. Installed in the subtype's
     * `class_init`; `gtk_widget_init_template` runs at construction.
     */
    template?: Uint8Array | string;
    /** `gtk_widget_class_set_css_name` for the subtype (optional). */
    cssName?: string;
    /** Template child ids to bind + expose publicly (via `gtk_widget_get_template_child`). */
    children?: string[];
    /** Template child ids to bind as internal children + expose privately. */
    internalChildren?: string[];
}

/**
 * Register a new GObject subclass of `parentNamespace.parentTypeName` named
 * `name`, inheriting the parent's class/instance layout, and return an opaque
 * type handle. `options` installs custom properties (backed by a per-instance
 * value store), signals, and vfunc overrides (an ffi closure written into the new
 * type's class vtable) in the new type's `class_init` — the Node twin of (the
 * engine half of) GJS's `GObject.registerClass`. Each vfunc override captures the
 * parent vtable pointer it displaces, so it can chain up via {@link callParentVfunc}.
 */
export function registerClass(
    name: string,
    parentNamespace: string,
    parentTypeName: string,
    options?: RegisterClassOptions,
): TypeHandle;

/**
 * Chain up to the parent implementation of an overridden vfunc — the engine half
 * of `super.vfunc_<name>(...)`. Invokes the function that was in the instance
 * type's vtable slot BEFORE the {@link registerClass} override was installed (the
 * C default, or a JS override further up the chain), passing `handle` as the
 * instance and `args` as the vfunc's declared IN arguments; returns the marshalled
 * vfunc return (or `undefined` for a void vfunc). Throws if no overridden vfunc by
 * that name owns a slot on the instance's type, or if the vfunc declares any
 * OUT/INOUT argument (chain-up of those is not yet supported — a catchable throw,
 * never a crash).
 */
export function callParentVfunc(handle: GObjectHandle, vfuncName: string, args?: unknown[]): unknown;

/**
 * Whether `Ns.Type.prototype.vfunc_<vfuncName>` can be dispatched directly — i.e.
 * an ancestor of `typeName` (or one of the interfaces it implements) declares that
 * virtual function AND girepository can locate its slot in the class's vtable.
 * The gate the L1 class prototype asks before materializing a vfunc member: `false`
 * leaves the name `undefined` (gjs parity for an unknown vfunc) or, for a declared
 * one whose struct offset girepository reports as unknown — GObject's own vfuncs —
 * lets it fall through to the {@link callParentVfunc} chain-up thunk.
 */
export function hasClassVfunc(namespace: string, typeName: string, vfuncName: string): boolean;

/**
 * Invoke the virtual function `Ns.Type` carries in its vtable, with `handle` as the
 * instance — what `new Gtk.Box().vfunc_add_child(builder, child, null)` does on gjs,
 * and the ONLY route to a `Gtk.Buildable` adder (`add_child` is introspected as a
 * vfunc, never as a method). Unlike {@link callParentVfunc} this needs no
 * {@link registerClass} override: the slot comes from the class itself. Same
 * marshalling and same `[returnValue?, ...outArgs]` return convention. Throws if the
 * vfunc is not addressable on that class, or if `handle` is not an instance of it.
 */
export function callClassVfunc(
    handle: GObjectHandle,
    namespace: string,
    typeName: string,
    vfuncName: string,
    args?: unknown[],
): unknown;

/**
 * Construct a GObject of a registered type handle (from {@link registerClass})
 * with optional construct/settable properties. For a templated type the engine
 * runs `gtk_widget_init_template` on the new instance before returning it.
 */
export function constructType(typeHandle: TypeHandle, props?: Record<string, unknown>): GObjectHandle;

/**
 * Resolve a composite-template child (bound via {@link RegisterClassOptions.children}
 * / {@link RegisterClassOptions.internalChildren}) by id on a templated instance —
 * `gtk_widget_get_template_child(widget, G_OBJECT_TYPE(widget), name)`. Returns the
 * child as a wrapped GObject handle (borrowed; toggle-ref bridged) or `null`.
 */
export function getTemplateChild(handle: GObjectHandle, name: string): GObjectHandle | null;

/** Read a GObject property. */
export function getProperty(handle: GObjectHandle, name: string): unknown;

/** Write a GObject property. */
export function setProperty(handle: GObjectHandle, name: string, value: unknown): void;

/**
 * Whether the instance's type has a GObject property by this name (kebab- or
 * snake-case). The L1 wrapper uses it to route `obj.foo` to a property read vs
 * an `obj.foo()` method call.
 */
export function hasProperty(handle: GObjectHandle, name: string): boolean;

/** The runtime GType name of a GObject handle (e.g. "GSimpleAction"). */
export function getTypeName(handle: GObjectHandle): string;

/**
 * The introspected type that OWNS a runtime GType name — the reverse of
 * {@link getGType}, walking up to the nearest ancestor carrying object info (a
 * private concrete type such as `GLocalFile` has none of its own). Searches only
 * LOADED namespaces, so it never pulls in a typelib as a side effect. `null` when
 * the GType is unknown or no ancestor is introspectable.
 */
export function classInfoForTypeName(gtypeName: string): { namespace: string; name: string } | null;

/**
 * The runtime GType of an introspected registered type, as an opaque node-gi
 * GType handle ({@link TypeHandle} — a tag-distinct External carrying the GType,
 * NOT a number/pointer). The L1 layer surfaces it as a lazy `Ns.Type.$gtype`
 * getter and feeds it to GType-typed GI arguments (`GObject.type_ensure`,
 * `g_param_spec_object`'s value type, …). Returns `null` for an unknown name.
 */
export function getGType(namespace: string, name: string): TypeHandle | null;

/**
 * Whether a GObject handle's GType is-a `namespace.typeName` (g_type_is_a — also
 * true when the type implements an interface). Used by the L1 wrapper to pick the
 * right `Gio._promisify` registration when two classes promisify a same-named method.
 */
export function isInstanceOf(handle: GObjectHandle, namespace: string, typeName: string): boolean;

/**
 * Whether `value` is one of node-gi's GObject-instance handles (tag-checked, no
 * dereference). Lets the L1 wrapper wrap object-typed return values for chaining
 * without misclassifying a {@link TypeHandle}.
 */
export function isGObjectHandle(value: unknown): boolean;

/**
 * Opaque handle to a boxed/struct instance (e.g. a GMainLoop), owned by node-gi
 * and released when garbage-collected (a fully-owned boxed is `g_boxed_free`d).
 * Pass it to {@link callBoxedMethod}.
 */
export type BoxedHandle = { readonly __nodeGiBoxed: unique symbol };

/**
 * Allocate a fresh, zero-initialised GValue and return it as a boxed handle (GType
 * `G_TYPE_VALUE`, owned → freed on GC). GObject.Value has no `g_value_new()`, so the
 * L1 layer (gi.js `makeValueClass`) uses this to build a `new GObject.Value()` and
 * then drives `.init(gtype)` / `.set_*` / `.get_*` / `.copy` / `.unset` through the
 * boxed-method path.
 */
export function newGValue(): BoxedHandle;

/**
 * Invoke an instance method on a boxed/struct handle (e.g. `mainLoop.run()` /
 * `mainLoop.quit()`). The method is resolved against the boxed GType's
 * introspection info and invoked with the boxed pointer as the instance.
 */
export function callBoxedMethod(handle: BoxedHandle, methodName: string, args?: unknown[]): unknown;

/**
 * Whether `value` is one of node-gi's boxed/struct handles (tag-checked, no
 * dereference). The L1 wrapper uses it to wrap boxed return values with a
 * method-routing proxy.
 */
export function isBoxedHandle(value: unknown): boolean;

/**
 * Classify a name on a boxed/struct/union handle: `0` neither, `1` method,
 * `2` field. Methods take priority (gjs renames a colliding field to `_name`), so
 * L1 wrapBoxed uses this to route method-dispatch vs field get/set.
 */
export function boxedMemberKind(handle: BoxedHandle, name: string): 0 | 1 | 2;

/**
 * Read a named field of a boxed/struct/union handle (`simpleStruct.long_`). Throws
 * if `name` is not a field, or the field is unreadable / unsupported.
 */
export function getBoxedField(handle: BoxedHandle, name: string): unknown;

/**
 * Write a simple-typed field of a boxed/struct/union handle (`union.long_ = 5`).
 * Throws if `name` is not a field, or the field is unwritable / unsupported.
 */
export function setBoxedField(handle: BoxedHandle, name: string, value: unknown): void;

/**
 * The boxed handle's GType name (e.g. `"GBytes"`), or `null` when it carries no
 * registered GType. Lets L1 attach type-specific conveniences (GLib.Bytes.toArray).
 */
export function boxedTypeName(value: unknown): string | null;

/**
 * Opaque handle to a GObject.ParamSpec (a GObject fundamental, ref-counted via
 * `g_param_spec_ref` / `unref`, released on GC). A `notify` handler's second arg
 * and a GParamSpec-typed value surface as one; the L1 wrapper adds the
 * name/nick/blurb/flags/value_type/owner_type/default_value ergonomics.
 */
export type ParamSpecHandle = { readonly __nodeGiParamSpec: unique symbol };

/**
 * Whether `value` is a node-gi GParamSpec handle (tag-checked, no dereference).
 */
export function isParamSpecHandle(value: unknown): boolean;

/**
 * Read a GParamSpec accessor by name: `name` | `nick` | `blurb` | `flags` |
 * `valueType` | `ownerType` | `defaultValue`. Backs the L1 GObject.ParamSpec
 * getters + get_name()/get_nick()/get_blurb()/get_default_value().
 */
export function paramSpecProp(handle: ParamSpecHandle, which: string): unknown;

/**
 * Opaque handle to a GLib.Variant (a boxed handle tagged with the GVariant
 * GType). Reference-counted via GVariant's (de)floating refcount and released on
 * GC. Pass it to {@link variantUnpack} / {@link variantGetTypeString}.
 */
export type VariantHandle = BoxedHandle & { readonly __nodeGiVariant: unique symbol };

/**
 * Build a GVariant from a GVariant type signature + JS value, returning an owned
 * GLib.Variant handle (the floating ref is sunk; released on GC). The recursive
 * native packer behind `new GLib.Variant(signature, value)`. Supports the basics
 * `b y n q i u x t h d s o g`, `v`, `m*` maybe, `a*` arrays (incl. `as`, `ay`,
 * `a{..}` dicts), `(...)` tuples and `{kv}` dict-entries.
 */
export function variantNew(signature: string, value?: unknown): VariantHandle;

/**
 * Unpack a GLib.Variant handle to a JS value. `deep` unpacks container children
 * (a nested `v` stays a Variant unless `recursive`); `recursive` additionally
 * unwraps nested `v` variants to plain JS. Drives the L1 `.unpack()` (deep=false),
 * `.deepUnpack()` (deep=true) and `.recursiveUnpack()` (deep=true, recursive=true).
 */
export function variantUnpack(handle: VariantHandle, deep?: boolean, recursive?: boolean): unknown;

/** The GVariant type string of a GLib.Variant handle (e.g. `"a{sv}"`). */
export function variantGetTypeString(handle: VariantHandle): string;

/**
 * Whether `value` is one of node-gi's GLib.Variant handles (a boxed handle tagged
 * with the GVariant GType; tag-checked, no dereference).
 */
export function isVariantHandle(value: unknown): boolean;

/**
 * Attach the libuv-backed GSource to the default GLib main context so a blocking
 * GLib main loop (`GLib.MainLoop.run()`, `Gio.Application.run()`) keeps Node's
 * timers, promises and I/O alive — the Node twin of GJS running the GLib loop as
 * the process loop. Also arms the uv-driven GLib auto-pump for the non-blocking
 * case: pending GLib sources (Gio async completions, GLib timeouts/idles, DBus)
 * dispatch from Node's own event loop, so async gi:// code needs no explicit
 * mainloop. Idempotent.
 */
export function startMainLoop(): void;

/**
 * Iterate the default GLib main context once, dispatching any ready sources.
 * Pure GLib (no libuv) — the portable main-loop primitive on Bun/Deno, driven
 * from a JS timer via the L1 `startMainContextPump`. Returns whether a source
 * was dispatched.
 */
export function iterateMainContext(mayBlock?: boolean): boolean;

/**
 * Whether the default GLib main context holds work a *pumping* runtime must stay
 * alive for: a scheduled source (an armed timeout/idle) or an in-flight
 * scope=async GI callback. Pure GLib — the query half of the keep-alive contract
 * the L1 `startMainContextPump` uses on Bun/Deno to decide whether its timer
 * holds the runtime's event loop open. Node reads the same facts inline in the
 * uv auto-pump.
 */
export function mainContextHasPending(): boolean;

/**
 * Create an `Int32Array(1)` view over the same JS-armed-work counter
 * `mainContextHasPending()` reads (`view[0] > 0` is equivalent). Reading the
 * view is a plain memory access — no call into the addon — which the Bun/Deno
 * pump's idle beat depends on: on Deno, entering the addon from a timer tick
 * during the between-test-files GC window reproduces the #47 boxed-handle
 * teardown SIGSEGV. Lazy factory: the @gjsify/napi shim loud-stubs external
 * arraybuffers and never arms the portable pump, so it must not run at Init.
 */
export function makePumpPendingCount(): Int32Array;

/**
 * Drain ready GLib sources + re-arm the auto-pump's libuv wake-ups now (no-op
 * unless {@link startMainLoop} armed the pump on this env). The L1 layer wires
 * this to `process.on('beforeExit')` to bootstrap an otherwise-empty libuv loop;
 * rarely needed directly.
 */
export function pumpKick(): void;

/**
 * Register the runtime-native microtask drain (Bun: `bun:jsc` drainMicrotasks;
 * Deno: core.runMicrotasks) the engine invokes after each OUTERMOST
 * loop-dispatched GLib→JS callback returns, so Promise continuations (async
 * DBus replies, `await` chains) drain during a blocking GLib loop. Registered
 * automatically at addon load on Bun/Deno; never registered on Node (its
 * napi_make_callback performs the checkpoint natively).
 */
export function setMicrotaskDrain(drain: () => void): void;

/**
 * Connect a JS callback to a GObject signal; returns a handler id. The callback
 * receives the signal arguments (the emitter instance is not passed in this
 * milestone).
 */
export function connectSignal(
    handle: GObjectHandle,
    signalName: string,
    callback: (...args: unknown[]) => unknown,
    after?: boolean,
): number;

/** Emit a signal; returns the signal's return value (undefined for void signals). */
export function emitSignal(handle: GObjectHandle, signalName: string, args?: unknown[]): unknown;

/** Disconnect a previously connected signal handler. */
export function disconnectSignal(handle: GObjectHandle, handlerId: number): void;

/**
 * Register the L1 resolver mapping a Gtk.Template `<signal handler="…">` handler
 * name to the instance's bound JS method (engine template-callback scope).
 */
export function setTemplateCallbackResolver(
    resolver: (handle: GObjectHandle, handlerName: string) => ((...args: unknown[]) => unknown) | undefined,
): void;

/**
 * Install (or clear, with `null`) the structured-log writer function backing
 * GLib.log_set_writer_func. The writer receives (logLevel, fields) where each
 * field value is a Uint8Array of the field bytes (or null for an empty field),
 * and returns a GLib.LogWriterOutput. NOTE: GLib permits at most ONE install per
 * process (a second aborts in GLib).
 */
export function logSetWriterFunc(
    writer: ((logLevel: number, fields: Record<string, Uint8Array | null>) => number) | null,
): void;

/** Route structured logs back to the default writer (GLib.log_set_writer_default). */
export function logSetWriterDefault(): void;

/**
 * g_object_bind_property_full with JS transform functions (backs
 * GObject.Object.prototype.bind_property_full). Each transform is
 * `(binding, sourceValue) => [ok: boolean, targetValue]`. Returns the GBinding handle.
 */
export function bindPropertyFull(
    source: GObjectHandle,
    sourceProperty: string,
    target: GObjectHandle,
    targetProperty: string,
    flags: number,
    transformTo: ((...args: unknown[]) => unknown) | null,
    transformFrom: ((...args: unknown[]) => unknown) | null,
): GObjectHandle;

/**
 * g_binding_group_bind_full with JS transform functions (backs
 * GObject.BindingGroup.bind_full). Same transform contract as {@link bindPropertyFull}.
 */
export function bindingGroupBindFull(
    group: GObjectHandle,
    sourceProperty: string,
    target: GObjectHandle,
    targetProperty: string,
    flags: number,
    transformTo: ((...args: unknown[]) => unknown) | null,
    transformFrom: ((...args: unknown[]) => unknown) | null,
): void;

declare const native: {
    requireNamespace: typeof requireNamespace;
    listInfoNames: typeof listInfoNames;
    findInfo: typeof findInfo;
    getConstantValue: typeof getConstantValue;
    getEnumValues: typeof getEnumValues;
    getErrorDomain: typeof getErrorDomain;
    setErrorBuilder: typeof setErrorBuilder;
    prependSearchPath: typeof prependSearchPath;
    prependLibraryPath: typeof prependLibraryPath;
    callFunction: typeof callFunction;
    callMethod: typeof callMethod;
    hasMethod: typeof hasMethod;
    hasClassMethod: typeof hasClassMethod;
    classMethodArity: typeof classMethodArity;
    callStaticMethod: typeof callStaticMethod;
    constructStruct: typeof constructStruct;
    newObject: typeof newObject;
    registerClass: typeof registerClass;
    constructType: typeof constructType;
    getTemplateChild: typeof getTemplateChild;
    getProperty: typeof getProperty;
    setProperty: typeof setProperty;
    hasProperty: typeof hasProperty;
    getTypeName: typeof getTypeName;
    classInfoForTypeName: typeof classInfoForTypeName;
    getGType: typeof getGType;
    isInstanceOf: typeof isInstanceOf;
    isGObjectHandle: typeof isGObjectHandle;
    newGValue: typeof newGValue;
    callBoxedMethod: typeof callBoxedMethod;
    isBoxedHandle: typeof isBoxedHandle;
    boxedMemberKind: typeof boxedMemberKind;
    getBoxedField: typeof getBoxedField;
    setBoxedField: typeof setBoxedField;
    boxedTypeName: typeof boxedTypeName;
    isParamSpecHandle: typeof isParamSpecHandle;
    paramSpecProp: typeof paramSpecProp;
    variantNew: typeof variantNew;
    variantUnpack: typeof variantUnpack;
    variantGetTypeString: typeof variantGetTypeString;
    isVariantHandle: typeof isVariantHandle;
    startMainLoop: typeof startMainLoop;
    iterateMainContext: typeof iterateMainContext;
    mainContextHasPending: typeof mainContextHasPending;
    makePumpPendingCount: typeof makePumpPendingCount;
    pumpKick: typeof pumpKick;
    setMicrotaskDrain: typeof setMicrotaskDrain;
    connectSignal: typeof connectSignal;
    emitSignal: typeof emitSignal;
    disconnectSignal: typeof disconnectSignal;
    setTemplateCallbackResolver: typeof setTemplateCallbackResolver;
    logSetWriterFunc: typeof logSetWriterFunc;
    logSetWriterDefault: typeof logSetWriterDefault;
    bindPropertyFull: typeof bindPropertyFull;
    bindingGroupBindFull: typeof bindingGroupBindFull;
};
export default native;
