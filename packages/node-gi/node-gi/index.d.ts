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

/** Prepend a directory to the GIRepository typelib search path. */
export function prependSearchPath(path: string): void;

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
 * Invoke a type-level constructor/static function (e.g. `Gio.File.new_for_path`,
 * `Gtk.Label.new`) — a function found on a type but taking no instance. The Node
 * twin of `Ns.Class.method(...)`. OUT/INOUT params follow {@link callFunction}'s
 * return-tuple convention.
 */
export function callStaticMethod(
  namespace: string,
  typeName: string,
  methodName: string,
  args?: unknown[],
): unknown;

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
export function newObject(
  namespace: string,
  typeName: string,
  props?: Record<string, unknown>,
): GObjectHandle;

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
 * marshalled back to C. Chain-up to the parent vfunc lands in a later milestone,
 * so an override fully replaces the inherited implementation.
 */
export type VFuncMap = Record<string, (this: GObjectHandle, ...args: unknown[]) => unknown>;

/** Custom properties, signals + vfunc overrides installed on a {@link registerClass} subtype. */
export interface RegisterClassOptions {
  properties?: PropertySpec[];
  signals?: SignalSpec[];
  vfuncs?: VFuncMap;
}

/**
 * Register a new GObject subclass of `parentNamespace.parentTypeName` named
 * `name`, inheriting the parent's class/instance layout, and return an opaque
 * type handle. `options` installs custom properties (backed by a per-instance
 * value store), signals, and vfunc overrides (an ffi closure written into the new
 * type's class vtable) in the new type's `class_init` — the Node twin of (the
 * engine half of) GJS's `GObject.registerClass`. vfunc chain-up to the parent
 * implementation lands in a later milestone.
 */
export function registerClass(
  name: string,
  parentNamespace: string,
  parentTypeName: string,
  options?: RegisterClassOptions,
): TypeHandle;

/**
 * Construct a GObject of a registered type handle (from {@link registerClass})
 * with optional construct/settable properties.
 */
export function constructType(typeHandle: TypeHandle, props?: Record<string, unknown>): GObjectHandle;

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
 * the process loop. Idempotent and harmless until a GLib loop actually runs.
 */
export function startMainLoop(): void;

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

declare const native: {
  requireNamespace: typeof requireNamespace;
  listInfoNames: typeof listInfoNames;
  findInfo: typeof findInfo;
  getConstantValue: typeof getConstantValue;
  getEnumValues: typeof getEnumValues;
  prependSearchPath: typeof prependSearchPath;
  callFunction: typeof callFunction;
  callMethod: typeof callMethod;
  callStaticMethod: typeof callStaticMethod;
  newObject: typeof newObject;
  registerClass: typeof registerClass;
  constructType: typeof constructType;
  getProperty: typeof getProperty;
  setProperty: typeof setProperty;
  hasProperty: typeof hasProperty;
  getTypeName: typeof getTypeName;
  isGObjectHandle: typeof isGObjectHandle;
  callBoxedMethod: typeof callBoxedMethod;
  isBoxedHandle: typeof isBoxedHandle;
  variantNew: typeof variantNew;
  variantUnpack: typeof variantUnpack;
  variantGetTypeString: typeof variantGetTypeString;
  isVariantHandle: typeof isVariantHandle;
  startMainLoop: typeof startMainLoop;
  connectSignal: typeof connectSignal;
  emitSignal: typeof emitSignal;
  disconnectSignal: typeof disconnectSignal;
};
export default native;
