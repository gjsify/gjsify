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
 * Construct a GObject of `namespace.typeName` with optional construct/settable
 * properties, returning an opaque handle owned by node-gi (released on GC).
 * @param {string} namespace e.g. "Gio"
 * @param {string} typeName e.g. "SimpleAction"
 * @param {Record<string, unknown>} [props]
 * @returns {unknown} opaque GObject handle
 */
export const newObject = native.newObject;

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
 * The runtime GType name of a GObject handle (e.g. "GSimpleAction").
 * @param {unknown} handle
 * @returns {string}
 */
export const getTypeName = native.getTypeName;

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
