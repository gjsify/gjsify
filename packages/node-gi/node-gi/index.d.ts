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

declare const native: {
  requireNamespace: typeof requireNamespace;
  listInfoNames: typeof listInfoNames;
  prependSearchPath: typeof prependSearchPath;
};
export default native;
