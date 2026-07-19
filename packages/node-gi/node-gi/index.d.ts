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
export function getErrorDomain(
  namespace: string,
  name: string,
): { name: string; quark: number } | null;

/**
 * Register the L1 GLib.Error factory the engine calls when a GI invoke fails, so
 * a failed sync call throws a real `GLib.Error` (instanceof, with `.matches()`).
 */
export function setErrorBuilder(
  builder: (domainName: string, domainQuark: number, code: number, message: string) => Error,
): void;

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
 * `true` iff {@link callMethod} would resolve an invocable instance method for
 * `methodName` (literal introspected name or snake_case alias, walking the same
 * own/interface/parent chain). Feature detection — never throws for a merely
 * unknown name; a non-introspectable instance reports `false`.
 */
export function hasMethod(handle: GObjectHandle, methodName: string): boolean;

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
export function callParentVfunc(
  handle: GObjectHandle,
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
 * Drain ready GLib sources + re-arm the auto-pump's libuv wake-ups now (no-op
 * unless {@link startMainLoop} armed the pump on this env). The L1 layer wires
 * this to `process.on('beforeExit')` to bootstrap an otherwise-empty libuv loop;
 * rarely needed directly.
 */
export function pumpKick(): void;

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
  resolver: (
    handle: GObjectHandle,
    handlerName: string,
  ) => ((...args: unknown[]) => unknown) | undefined,
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
  callFunction: typeof callFunction;
  callMethod: typeof callMethod;
  hasMethod: typeof hasMethod;
  callStaticMethod: typeof callStaticMethod;
  newObject: typeof newObject;
  registerClass: typeof registerClass;
  constructType: typeof constructType;
  getTemplateChild: typeof getTemplateChild;
  getProperty: typeof getProperty;
  setProperty: typeof setProperty;
  hasProperty: typeof hasProperty;
  getTypeName: typeof getTypeName;
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
  pumpKick: typeof pumpKick;
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
