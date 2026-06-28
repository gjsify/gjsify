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
 * method) with IN-only primitive/string arguments. Returns the marshalled
 * return value. Milestone 1: numbers, booleans and strings.
 */
export function callFunction(namespace: string, functionName: string, args?: unknown[]): unknown;

/**
 * Invoke an instance method on a GObject handle with IN-only
 * primitive/string/object/enum args. The method is resolved against the
 * instance's introspection type (own + implemented-interface methods, then up
 * the parent chain). The Node twin of `obj.method(...)`.
 */
export function callMethod(handle: GObjectHandle, methodName: string, args?: unknown[]): unknown;

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

/**
 * Register a new GObject subclass of `parentNamespace.parentTypeName` named
 * `name`, inheriting the parent's class/instance layout, and return an opaque
 * type handle. Custom properties/signals and vfunc overrides land in later
 * milestones — the Node twin of (the engine half of) GJS's
 * `GObject.registerClass`.
 */
export function registerClass(
  name: string,
  parentNamespace: string,
  parentTypeName: string,
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
  newObject: typeof newObject;
  registerClass: typeof registerClass;
  constructType: typeof constructType;
  getProperty: typeof getProperty;
  setProperty: typeof setProperty;
  hasProperty: typeof hasProperty;
  getTypeName: typeof getTypeName;
  isGObjectHandle: typeof isGObjectHandle;
  connectSignal: typeof connectSignal;
  emitSignal: typeof emitSignal;
  disconnectSignal: typeof disconnectSignal;
};
export default native;
