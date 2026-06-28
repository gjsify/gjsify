// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gi — the L1 GJS-compatibility layer over the native engine.
//
// Turns the low-level primitives (requireNamespace / findInfo / callFunction /
// newObject / callMethod / get|setProperty / connect|emit|disconnectSignal) into
// a GJS-shaped namespace object: `requireGi('Gio', '2.0')` returns an object
// where `Gio.SomeFunction(...)` calls a namespace function, `new Gio.SomeClass({
// prop: value })` constructs a GObject, and the instance exposes `.method(...)`,
// `.prop` (property get/set) and `.connect()/.emit()/.disconnect()` — the same
// surface `import Gio from 'gi://Gio?version=2.0'` gives under GJS.
//
// This is the seam the bundler's --app node target rewrites `gi://Ns?version=X`
// onto. Reference: GJS's gi module (gjs/modules/esm/gi.js) for the require shape;
// node-gtk (romgrk, MIT) for the binding lineage. Hand-authored JS (the package
// ships no build step). Milestone 1 surfaces functions + GObject classes; enums,
// flags, constants, structs/boxed, interface static methods and camelCase
// aliases land in subsequent drops.
import * as native from './index.js';

// Symbol carrying the raw native GObject handle on a wrapped instance, so it can
// be unwrapped again when passed back into the engine as a GI argument.
const HANDLE = Symbol('nodeGiHandle');

// JS-builtin / interop names that must NEVER be treated as a GI method or
// property — otherwise awaiting, printing or inspecting a wrapper would call
// into GObject (e.g. a stray `then` would make a wrapper look thenable).
const RESERVED = new Set(['then', 'toString', 'valueOf', 'constructor', 'inspect']);

function unwrapArg(value) {
  if (value !== null && typeof value === 'object' && value[HANDLE] !== undefined) {
    return value[HANDLE];
  }
  return value;
}

function unwrapArgs(args) {
  return args.map(unwrapArg);
}

function unwrapProps(props) {
  const out = {};
  for (const key of Object.keys(props)) out[key] = unwrapArg(props[key]);
  return out;
}

// Object-typed return values become chainable instance proxies; everything else
// (primitives, strings, null) passes through.
function wrapReturn(value) {
  return native.isGObjectHandle(value) ? wrapInstance(value) : value;
}

function wrapInstance(handle) {
  const target = { [HANDLE]: handle };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === HANDLE) return handle;
      if (typeof prop !== 'string' || RESERVED.has(prop)) return t[prop];
      switch (prop) {
        case 'connect':
          return (signal, cb) => native.connectSignal(handle, signal, cb, false);
        case 'connect_after':
          return (signal, cb) => native.connectSignal(handle, signal, cb, true);
        case 'emit':
          return (signal, ...args) =>
            wrapReturn(native.emitSignal(handle, signal, unwrapArgs(args)));
        case 'disconnect':
          return (id) => native.disconnectSignal(handle, id);
        default:
          break;
      }
      const propName = prop.replace(/_/g, '-');
      if (native.hasProperty(handle, propName)) {
        return wrapReturn(native.getProperty(handle, propName));
      }
      return (...args) => wrapReturn(native.callMethod(handle, prop, unwrapArgs(args)));
    },
    set(t, prop, value) {
      if (typeof prop === 'string') {
        const propName = prop.replace(/_/g, '-');
        if (native.hasProperty(handle, propName)) {
          native.setProperty(handle, propName, unwrapArg(value));
          return true;
        }
      }
      t[prop] = value;
      return true;
    },
    has(t, prop) {
      return prop === HANDLE || prop in t;
    },
  });
}

function makeClass(namespace, typeName) {
  const ctor = function ctor(props) {
    const handle = native.newObject(namespace, typeName, props ? unwrapProps(props) : {});
    return wrapInstance(handle);
  };
  Object.defineProperty(ctor, 'name', { value: typeName, configurable: true });
  ctor.$gtypeName = `${namespace}.${typeName}`;
  return ctor;
}

// Build a frozen enum/flags object keyed GJS-style: member names UPPER_CASED
// with '-' → '_' (e.g. Gio.BusType.SYSTEM, Gio.ApplicationFlags.HANDLES_OPEN).
function makeEnum(namespace, typeName) {
  const raw = native.getEnumValues(namespace, typeName);
  const out = {};
  for (const key of Object.keys(raw)) {
    out[key.toUpperCase().replace(/-/g, '_')] = raw[key];
  }
  return Object.freeze(out);
}

function createNamespace(namespace) {
  const cache = new Map();
  return new Proxy(Object.create(null), {
    get(_t, prop) {
      if (typeof prop !== 'string' || RESERVED.has(prop)) return undefined;
      if (cache.has(prop)) return cache.get(prop);
      const info = native.findInfo(namespace, prop);
      let value;
      if (info === null) {
        value = undefined;
      } else if (info.kind === 'function') {
        value = (...args) => wrapReturn(native.callFunction(namespace, prop, unwrapArgs(args)));
      } else if (info.kind === 'object') {
        value = makeClass(namespace, prop);
      } else if (info.kind === 'enum' || info.kind === 'flags') {
        value = makeEnum(namespace, prop);
      } else if (info.kind === 'constant') {
        value = native.getConstantValue(namespace, prop);
      } else {
        // struct / interface / union / callback: surfaced in a later drop.
        value = undefined;
      }
      cache.set(prop, value);
      return value;
    },
    has(_t, prop) {
      return typeof prop === 'string' && native.findInfo(namespace, prop) !== null;
    },
  });
}

const namespaceCache = new Map();

/**
 * Require a GObject-Introspection namespace and return a GJS-shaped namespace
 * object. The Node twin of `import Ns from 'gi://Ns?version=X'` /
 * `imports.gi.Ns`.
 * @param {string} namespace e.g. "Gio"
 * @param {string} [version] e.g. "2.0"
 * @returns {Record<string, unknown>}
 */
export function requireGi(namespace, version) {
  native.requireNamespace(namespace, version);
  const key = version ? `${namespace}@${version}` : namespace;
  let ns = namespaceCache.get(key);
  if (ns === undefined) {
    ns = createNamespace(namespace);
    namespaceCache.set(key, ns);
  }
  return ns;
}

/**
 * Extract the raw native GObject handle from a wrapped instance (advanced /
 * interop use). Returns the value unchanged if it is not a wrapped instance.
 * @param {unknown} value
 * @returns {unknown}
 */
export function unwrap(value) {
  return unwrapArg(value);
}

export default requireGi;
