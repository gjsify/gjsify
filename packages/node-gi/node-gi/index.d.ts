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

/** Prepend a directory to the GIRepository typelib search path. */
export function prependSearchPath(path: string): void;

/**
 * Invoke a namespace-level GObject-Introspection function (not an instance
 * method) with IN-only primitive/string arguments. Returns the marshalled
 * return value. Milestone 1: numbers, booleans and strings.
 */
export function callFunction(namespace: string, functionName: string, args?: unknown[]): unknown;

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

/** Read a GObject property. */
export function getProperty(handle: GObjectHandle, name: string): unknown;

/** Write a GObject property. */
export function setProperty(handle: GObjectHandle, name: string, value: unknown): void;

/** The runtime GType name of a GObject handle (e.g. "GSimpleAction"). */
export function getTypeName(handle: GObjectHandle): string;

declare const native: {
  requireNamespace: typeof requireNamespace;
  listInfoNames: typeof listInfoNames;
  prependSearchPath: typeof prependSearchPath;
  callFunction: typeof callFunction;
  newObject: typeof newObject;
  getProperty: typeof getProperty;
  setProperty: typeof setProperty;
  getTypeName: typeof getTypeName;
};
export default native;
