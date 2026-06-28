// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gi — L1 GJS-compatibility layer type surface.
//
// The runtime returns a Proxy whose members are resolved dynamically from
// introspection, so the precise per-namespace shape is not statically known
// here. Under gjsify's bundler integration the call site
// `import Ns from 'gi://Ns?version=X'` is typed by the platform-neutral ambient
// `@girs/*` module declarations; this declaration types the bare runtime entry.

/** A GJS-shaped namespace object (members resolved dynamically). */
export type GiNamespace = Record<string, unknown>;

/**
 * Require a GObject-Introspection namespace and return a GJS-shaped namespace
 * object. The Node twin of `import Ns from 'gi://Ns?version=X'` /
 * `imports.gi.Ns`. Members are resolved lazily from introspection: namespace
 * functions become callables, GObject types become constructors whose instances
 * expose `.method(...)`, `.prop` get/set and `.connect()/.emit()/.disconnect()`.
 */
export function requireGi(namespace: string, version?: string): GiNamespace;

/**
 * Extract the raw native GObject handle from a wrapped instance (advanced /
 * interop use). Returns the value unchanged if it is not a wrapped instance.
 */
export function unwrap(value: unknown): unknown;

export default requireGi;
