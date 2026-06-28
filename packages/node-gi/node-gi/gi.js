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

// GJS accepts both snake_case and camelCase for methods/properties. Map a JS
// accessor to the GI method name (snake_case) and to a GObject property name
// (kebab-case); a name that is already in the target case passes through.
function camelToSnake(name) {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function toKebab(name) {
  return name.replace(/([A-Z])/g, '-$1').replace(/_/g, '-').toLowerCase();
}

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

// Object-typed return values become chainable instance proxies; boxed/struct
// handles (e.g. GMainLoop) become method-routing proxies; everything else
// (primitives, strings, null) passes through.
function wrapReturn(value) {
  if (native.isGObjectHandle(value)) return wrapInstance(value);
  if (native.isBoxedHandle(value)) return wrapBoxed(value);
  return value;
}

// Wrap a boxed/struct handle so its methods are callable GJS-style
// (`mainLoop.run()`, `mainLoop.quit()`, snake_case or camelCase). Boxed types
// have no GObject properties/signals, so only method routing is provided.
function wrapBoxed(handle) {
  const target = { [HANDLE]: handle };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === HANDLE) return handle;
      if (typeof prop !== 'string' || RESERVED.has(prop)) return t[prop];
      return (...args) =>
        wrapReturn(native.callBoxedMethod(handle, camelToSnake(prop), unwrapArgs(args)));
    },
    has(t, prop) {
      return prop === HANDLE || prop in t;
    },
  });
}

// Walk a JS prototype chain (excluding Object.prototype) for an own property
// descriptor of `prop` — used to surface a registerClass subclass's own methods
// /getters/setters on the GObject wrapper.
function findProtoDescriptor(proto, prop) {
  for (let p = proto; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, prop);
    if (d !== undefined) return d;
  }
  return undefined;
}

// Wrap a live GObject handle as a GJS-shaped instance. When `userProto` is given
// (a registerClass subclass's prototype) the wrapper resolves the user class's
// own prototype members FIRST — so `inst.myMethod()` runs the JS method with the
// wrapper as `this` — then falls back to GObject property get/set and GI method
// routing. `.connect()/.emit()/.disconnect()` work in both modes.
function wrapInstance(handle, userProto) {
  const target = { [HANDLE]: handle };
  const proxy = new Proxy(target, {
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
      if (userProto !== undefined) {
        const desc = findProtoDescriptor(userProto, prop);
        if (desc !== undefined) {
          if (typeof desc.value === 'function') return (...args) => desc.value.apply(proxy, args);
          if (typeof desc.get === 'function') return desc.get.call(proxy);
          return desc.value;
        }
      }
      const propName = toKebab(prop);
      if (native.hasProperty(handle, propName)) {
        return wrapReturn(native.getProperty(handle, propName));
      }
      // Surface a plain JS field previously written on THIS wrapper. NOTE: plain
      // (non-GObject-property) fields are per-wrapper, NOT shared across the
      // vfunc<->instance boundary in this milestone — a vfunc's `this` is a
      // distinct wrapper over the same GObject (the native engine mints a fresh
      // handle per call; the unified-identity wrapper cache arrives with the
      // toggle-ref work). Use GObject PROPERTIES for state that must cross that
      // boundary (those live in C and ARE consistent). See the block comment on
      // registerClass.
      if (userProto !== undefined && prop in t) return t[prop];
      return (...args) => wrapReturn(native.callMethod(handle, camelToSnake(prop), unwrapArgs(args)));
    },
    set(t, prop, value) {
      if (typeof prop === 'string') {
        if (userProto !== undefined) {
          const desc = findProtoDescriptor(userProto, prop);
          if (desc !== undefined && typeof desc.set === 'function') {
            desc.set.call(proxy, value);
            return true;
          }
        }
        const propName = toKebab(prop);
        if (native.hasProperty(handle, propName)) {
          native.setProperty(handle, propName, unwrapArg(value));
          return true;
        }
      }
      t[prop] = value;
      return true;
    },
    has(t, prop) {
      if (prop === HANDLE || prop in t) return true;
      if (typeof prop === 'string') {
        // A subclass's own prototype member (method/getter) and any GObject
        // property of the instance both count as `in` the wrapper. (Introspected
        // GI methods are resolved dynamically and are intentionally not reported.)
        if (userProto !== undefined && findProtoDescriptor(userProto, prop) !== undefined) return true;
        if (native.hasProperty(handle, toKebab(prop))) return true;
      }
      return false;
    },
  });
  return proxy;
}

function makeClass(namespace, typeName) {
  const ctor = function ctor(props) {
    const handle = native.newObject(namespace, typeName, props ? unwrapProps(props) : {});
    return wrapInstance(handle);
  };
  Object.defineProperty(ctor, 'name', { value: typeName, configurable: true });
  ctor.$gtypeName = `${namespace}.${typeName}`;
  // Expose constructor/static methods lazily: Ns.Class.new(...) /
  // Ns.Class.new_for_path(...) (and the camelCase aliases). `new Ns.Class({...})`
  // still goes through the target's [[Construct]] (the default Proxy behaviour).
  return new Proxy(ctor, {
    get(t, prop) {
      if (typeof prop !== 'string' || prop in t || RESERVED.has(prop)) return t[prop];
      const giName = camelToSnake(prop);
      return (...args) =>
        wrapReturn(native.callStaticMethod(namespace, typeName, giName, unwrapArgs(args)));
    },
  });
}

// Surface a boxed/struct type (e.g. GLib.MainLoop) as a class-like object whose
// static/constructor methods route through the engine: `GLib.MainLoop.new(...)`
// and the camelCase alias, plus `new GLib.MainLoop(...)` mapped to the `new`
// constructor. Returned boxed instances are wrapped by {@link wrapBoxed}.
function makeStruct(namespace, typeName) {
  const base = function () {};
  Object.defineProperty(base, 'name', { value: typeName, configurable: true });
  base.$gtypeName = `${namespace}.${typeName}`;
  return new Proxy(base, {
    get(t, prop) {
      if (typeof prop !== 'string' || prop in t || RESERVED.has(prop)) return t[prop];
      const giName = camelToSnake(prop);
      return (...args) =>
        wrapReturn(native.callStaticMethod(namespace, typeName, giName, unwrapArgs(args)));
    },
    construct(_t, args) {
      return wrapReturn(native.callStaticMethod(namespace, typeName, 'new', unwrapArgs(args)));
    },
  });
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

// ---- GObject.registerClass decorator (L1, GJS-shaped) ----
//
// The Node twin of GJS's `GObject.registerClass(meta, class)`. It accepts both
// `registerClass(class)` and `registerClass({ GTypeName?, Properties?, Signals?,
// ... }, class)`, registers a GObject subtype via the native engine, and returns
// a constructor whose `new`-ed instances are usable as GObjects (property get/
// set, `.connect/.emit/.disconnect`) AND expose the user class's own prototype
// methods (resolved before the GObject routing — see wrapInstance).
//
// Caveats (documented, same spirit as the signals/vfunc class-level model):
//  - The user class's JS constructor body is NOT run; GObject-idiomatic init
//    belongs in `vfunc_constructed` (which fires during construction). `super()`
//    chaining maps conceptually to the engine's constructType, not a JS call.
//  - Instances are Proxies over a native handle, not real `instanceof` instances.
//  - Plain (non-GObject-property) JS instance fields do NOT cross the
//    vfunc<->instance boundary in this milestone: inside a vfunc, `this` is a
//    DISTINCT wrapper over the same GObject (the native engine mints a fresh
//    handle per call, so there is no shared per-instance JS object yet). Use
//    GObject PROPERTIES for any state that must be visible both inside a vfunc
//    and on the instance — those live in C and ARE consistent. The unified
//    instance identity (a per-GObject wrapper cache) arrives with the toggle-ref
//    work, tracked separately.
//  - No toggle-ref: a JS↔GObject reference cycle on a custom instance leaks (the
//    same cycle-leak caveat the signal/vfunc layer carries).
//  - Multi-level registered subclassing (registering a subclass of a
//    registerClass'd type) is not yet supported — the native engine resolves the
//    parent by namespace+type, which a registered (non-introspected) parent has
//    no entry for.

// GObject.ParamFlags — the GParamFlags bits the native property builder consumes.
const ParamFlags = Object.freeze({
  READABLE: 1,
  WRITABLE: 2,
  READWRITE: 3,
  CONSTRUCT: 4,
  CONSTRUCT_ONLY: 8,
});

// GObject.SignalFlags — the GSignalFlags bits (native defaults to RUN_LAST).
const SignalFlags = Object.freeze({
  RUN_FIRST: 1,
  RUN_LAST: 2,
  RUN_CLEANUP: 4,
});

// A ParamSpec factory returns a plain descriptor the decorator maps to the
// native PropertySpec. `string`/`boolean` capture (name, nick, blurb, flags,
// default); the numeric kinds capture (name, nick, blurb, flags, min, max,
// default) — matching GJS's GObject.ParamSpec.* argument order.
function paramSpecPlain(type) {
  return (name, nick, blurb, flags, defaultValue) => ({
    $paramSpec: true,
    type,
    name,
    nick,
    blurb,
    flags,
    default: defaultValue,
  });
}

function paramSpecRanged(type) {
  return (name, nick, blurb, flags, minimum, maximum, defaultValue) => ({
    $paramSpec: true,
    type,
    name,
    nick,
    blurb,
    flags,
    minimum,
    maximum,
    default: defaultValue,
  });
}

const ParamSpec = Object.freeze({
  string: paramSpecPlain('string'),
  boolean: paramSpecPlain('boolean'),
  int: paramSpecRanged('int'),
  uint: paramSpecRanged('uint'),
  int64: paramSpecRanged('int64'),
  uint64: paramSpecRanged('uint64'),
  double: paramSpecRanged('double'),
  float: paramSpecRanged('float'),
});

// Walk up the JS class's prototype chain to the nearest node-gi base wrapper
// (carrying `$gtypeName` as "Ns.Type") and split it into the parent namespace +
// type the native engine subclasses. A dotless `$gtypeName` belongs to a
// registerClass'd type (no namespace) — multi-level registered subclassing is
// not yet supported (the native engine resolves the parent by namespace+type, so
// a registered parent can't be looked up); throw a CLEAR error rather than the
// generic "must extend a node-gi GObject class".
function findParentGType(klass) {
  for (let c = Object.getPrototypeOf(klass); typeof c === 'function'; c = Object.getPrototypeOf(c)) {
    const gt = c.$gtypeName;
    if (typeof gt === 'string') {
      const dot = gt.indexOf('.');
      if (dot > 0) {
        return { parentNamespace: gt.slice(0, dot), parentType: gt.slice(dot + 1) };
      }
      throw new TypeError(
        "GObject.registerClass: multi-level registerClass subclassing is not yet supported (parent '" +
          gt +
          "' is a registered type, not an introspected one)",
      );
    }
  }
  return undefined;
}

// Map a GObject.ParamSpec.* descriptor (from meta.Properties) to a native
// PropertySpec. The property name defaults to the Properties key.
function paramSpecToNative(desc, key) {
  if (desc === null || typeof desc !== 'object') {
    throw new TypeError(
      "GObject.registerClass: Properties['" + key + "'] must be a GObject.ParamSpec descriptor",
    );
  }
  const spec = { name: typeof desc.name === 'string' && desc.name.length > 0 ? desc.name : key };
  spec.type = desc.type;
  if (typeof desc.flags === 'number') spec.flags = desc.flags;
  if (desc.default !== undefined) spec.default = desc.default;
  if (typeof desc.minimum === 'number') spec.minimum = desc.minimum;
  if (typeof desc.maximum === 'number') spec.maximum = desc.maximum;
  return spec;
}

// Normalise a signal param/return type to the native type-name vocabulary: a
// string passes through; a ParamSpec descriptor contributes its `.type`.
function normalizeSignalType(t) {
  if (typeof t === 'string') return t;
  if (t !== null && typeof t === 'object' && typeof t.type === 'string') return t.type;
  return undefined;
}

// Map a meta.Signals entry (`{ param_types?, return_type?, flags? }`, GJS keys,
// camelCase also accepted) to a native SignalSpec; the signal name is the key.
function signalSpecToNative(spec, key) {
  const s = spec !== null && typeof spec === 'object' ? spec : {};
  const out = { name: key };
  const params = s.param_types !== undefined ? s.param_types : s.paramTypes;
  if (Array.isArray(params)) {
    out.paramTypes = params.map(normalizeSignalType).filter((t) => t !== undefined);
  }
  const ret = normalizeSignalType(s.return_type !== undefined ? s.return_type : s.returnType);
  if (ret !== undefined) out.returnType = ret;
  if (typeof s.flags === 'number') out.flags = s.flags;
  return out;
}

// Collect every `vfunc_<name>` method on the class's prototype chain into the
// native vfuncs map (key = name without the `vfunc_` prefix). The native engine
// invokes each override with `this` = the raw instance handle; re-wrap it so the
// user's vfunc sees a usable class instance (own methods + property routing).
function collectVfuncs(klass) {
  const vfuncs = {};
  const seen = new Set();
  for (let p = klass.prototype; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const key of Object.getOwnPropertyNames(p)) {
      if (!key.startsWith('vfunc_') || seen.has(key)) continue;
      const desc = Object.getOwnPropertyDescriptor(p, key);
      if (desc === undefined || typeof desc.value !== 'function') continue;
      seen.add(key);
      const userFn = desc.value;
      vfuncs[key.slice('vfunc_'.length)] = function (...args) {
        return userFn.apply(wrapInstance(this, klass.prototype), args);
      };
    }
  }
  return vfuncs;
}

/**
 * GObject.registerClass — register a GObject subclass declared as a JS class.
 * Supports `registerClass(class)` and `registerClass(meta, class)` where meta is
 * `{ GTypeName?, Properties?, Signals?, ... }` (GJS allows both). Returns a
 * constructor; `new Subclass(props)` constructs the GObject and wraps it so the
 * user class's own prototype methods + the GObject property/signal surface are
 * both usable. See the block comment above for the (documented) caveats.
 * @param {Function|Record<string, unknown>} metaOrClass
 * @param {Function} [maybeClass]
 * @returns {Function}
 */
function registerClass(metaOrClass, maybeClass) {
  let meta;
  let klass;
  if (typeof metaOrClass === 'function') {
    klass = metaOrClass;
    meta = {};
  } else {
    meta = metaOrClass !== null && typeof metaOrClass === 'object' ? metaOrClass : {};
    klass = maybeClass;
  }
  if (typeof klass !== 'function') {
    throw new TypeError('GObject.registerClass: expected a class to register');
  }

  const parent = findParentGType(klass);
  if (parent === undefined) {
    throw new TypeError(
      'GObject.registerClass: ' +
        (klass.name || 'the class') +
        ' must extend a node-gi GObject class (e.g. GObject.Object)',
    );
  }

  const properties = [];
  if (meta.Properties !== null && typeof meta.Properties === 'object') {
    for (const key of Object.keys(meta.Properties)) {
      properties.push(paramSpecToNative(meta.Properties[key], key));
    }
  }

  const signals = [];
  if (meta.Signals !== null && typeof meta.Signals === 'object') {
    for (const key of Object.keys(meta.Signals)) {
      signals.push(signalSpecToNative(meta.Signals[key], key));
    }
  }

  const vfuncs = collectVfuncs(klass);

  const gtypeName =
    typeof meta.GTypeName === 'string' && meta.GTypeName.length > 0 ? meta.GTypeName : klass.name;
  if (!gtypeName) {
    throw new TypeError('GObject.registerClass: a GTypeName is required for an anonymous class');
  }

  const typeHandle = native.registerClass(gtypeName, parent.parentNamespace, parent.parentType, {
    properties,
    signals,
    vfuncs,
  });

  const Subclass = function (props) {
    const handle = native.constructType(typeHandle, props ? unwrapProps(props) : {});
    return wrapInstance(handle, klass.prototype);
  };
  Object.defineProperty(Subclass, 'name', { value: gtypeName, configurable: true });
  Subclass.prototype = klass.prototype;
  Subclass.$gtypeName = gtypeName;
  return Subclass;
}

// Merge convenience flag names UNDER an introspected enum: the introspected
// members WIN (so every real bit — incl. LAX_VALIDATION / EXPLICIT_NOTIFY /
// DETAILED / NO_RECURSE — keeps its true value), and the convenience names only
// fill a gap if a platform's typelib happens not to introspect a combined value
// (e.g. READWRITE). Returns the convenience table verbatim if introspection
// yielded no usable enum.
function mergeFlags(introspected, convenience) {
  if (introspected === null || typeof introspected !== 'object') return convenience;
  return Object.freeze({ ...convenience, ...introspected });
}

// Overlay the GJS `GObject` runtime statics on top of the introspected GObject
// namespace proxy — ADDITIVELY, never shadowing. `registerClass` + `ParamSpec`
// are genuinely new. `ParamFlags` / `SignalFlags` are FULL introspected
// bitfields: returning a hardcoded 5-member table would make every other member
// read `undefined` (→ coerces to 0 in `FLAGS | GObject.ParamFlags.X`, silently
// dropping the bit), so they resolve to the introspected enum (convenience names
// merged underneath as a fallback). `GObject.Object` etc. keep resolving from
// introspection. Merged enums are cached so identity is stable.
const OVERLAY_NAMES = new Set(['registerClass', 'ParamSpec', 'ParamFlags', 'SignalFlags']);

function decorateGObjectNamespace(baseNs) {
  const cache = new Map();
  const resolve = (prop) => {
    if (cache.has(prop)) return cache.get(prop);
    let value;
    if (prop === 'registerClass') value = registerClass;
    else if (prop === 'ParamSpec') value = ParamSpec;
    else if (prop === 'ParamFlags') value = mergeFlags(baseNs.ParamFlags, ParamFlags);
    else if (prop === 'SignalFlags') value = mergeFlags(baseNs.SignalFlags, SignalFlags);
    cache.set(prop, value);
    return value;
  };
  return new Proxy(baseNs, {
    get(t, prop) {
      return typeof prop === 'string' && OVERLAY_NAMES.has(prop) ? resolve(prop) : t[prop];
    },
    has(t, prop) {
      return (typeof prop === 'string' && OVERLAY_NAMES.has(prop)) || prop in t;
    },
  });
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
      } else if (info.kind === 'object' || info.kind === 'interface') {
        // Interfaces are not constructible (`new` throws via newObject) but
        // carry static/constructor methods, e.g. Gio.File.new_for_path.
        value = makeClass(namespace, prop);
      } else if (info.kind === 'enum' || info.kind === 'flags') {
        value = makeEnum(namespace, prop);
      } else if (info.kind === 'constant') {
        value = native.getConstantValue(namespace, prop);
      } else if (info.kind === 'struct' || info.kind === 'union') {
        // Boxed/struct types: static/constructor methods + boxed instances
        // (GLib.MainLoop, …). Field access lands with the broader structs drop.
        value = makeStruct(namespace, prop);
      } else {
        // interface / callback: surfaced in a later drop.
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

// Whether the libuv↔GLib bridge has been attached this process. The native
// startMainLoop is itself idempotent; this just avoids the extra call.
let loopAttached = false;

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
  // Attach the libuv-in-GLib bridge once, so any later blocking GLib loop
  // (GLib.MainLoop.run / Gio.Application.run) keeps Node's event loop alive.
  if (!loopAttached) {
    native.startMainLoop();
    loopAttached = true;
  }
  const key = version ? `${namespace}@${version}` : namespace;
  let ns = namespaceCache.get(key);
  if (ns === undefined) {
    ns = createNamespace(namespace);
    // The GObject namespace also carries the GJS runtime statics (registerClass +
    // ParamSpec/ParamFlags/SignalFlags) layered over its introspected members.
    if (namespace === 'GObject') ns = decorateGObjectNamespace(ns);
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
