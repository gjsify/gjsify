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

// Symbol carrying the user-class prototype (a registerClass subclass) on a wrapped
// instance. Stored on the target rather than captured in the proxy closure so a
// later wrap with a userProto can UPGRADE an already-cached generic wrapper in
// place (preserving identity + expandos) — see wrapInstance.
const USER_PROTO = Symbol('nodeGiUserProto');

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

// Symbol carrying an enum object's GError-domain descriptor ({ name, quark }) so
// GLib.Error.prototype.matches can resolve an error-enum (e.g. Gio.IOErrorEnum)
// to the domain it represents. Attached by makeEnum when the enum is registered
// as a GError domain; read by errorDomainOf.
const ERROR_DOMAIN = Symbol('nodeGiErrorDomain');

// ---- GLib.Error (the GError surface, L1) ----
//
// A real Error subclass mirroring GJS's GLib.Error: `.domain`, `.code`,
// `.message` plus `.matches(domain, code)` (the g_error_matches semantics — true
// when the error's domain AND code both match). The engine throws an instance of
// this on a failed sync GI invoke (via the builder registered below), and
// `requireGi('GLib').Error` is this constructor, so a caught error is
// `instanceof GLib.Error` exactly as under GJS.
//
// Divergence from GJS (documented): GJS's `.domain` is the numeric GQuark; here
// `.domain` is the quark NAME string (more useful in a Node context, and the task
// permits either). The numeric quark is kept on `.domainQuark`. `matches()`
// accepts the domain as an error-enum object (Gio.IOErrorEnum), a name string, or
// a numeric quark, so all the idiomatic call shapes work.

// Resolve a `matches` domain argument to a { name?, quark? } descriptor.
function errorDomainOf(domain) {
  if (domain === null || domain === undefined) return null;
  if (typeof domain === 'object' && domain[ERROR_DOMAIN] !== undefined) return domain[ERROR_DOMAIN];
  if (typeof domain === 'string') return { name: domain };
  if (typeof domain === 'number') return { quark: domain };
  return null;
}

class GLibError extends Error {
  // GJS-shaped public constructor: `new GLib.Error(domain, code, message)` where
  // `domain` may be an error-enum object, a quark name string, or a numeric quark.
  constructor(domain, code, message) {
    super(typeof message === 'string' ? message : '');
    this.name = 'GLib.Error';
    const d = errorDomainOf(domain);
    this.domain = d !== null && d.name !== undefined ? d.name : typeof domain === 'string' ? domain : undefined;
    this.domainQuark = d !== null && d.quark !== undefined ? d.quark : typeof domain === 'number' ? domain : undefined;
    this.code = code;
  }

  // g_error_matches: true when the error's domain + code both match. Accepts the
  // domain as an error-enum object / name string / numeric quark (errorDomainOf).
  matches(domain, code) {
    const d = errorDomainOf(domain);
    if (d === null) return false;
    const domainMatch =
      (d.name !== undefined && d.name === this.domain) ||
      (d.quark !== undefined && d.quark === this.domainQuark);
    return domainMatch && code === this.code;
  }

  toString() {
    return `GLib.Error ${this.domain}: ${this.message}`;
  }
}

// The engine calls this on a failed GI invoke with the GError's authoritative
// fields (quark name + numeric quark + code + message) to build the thrown error.
function buildGError(domainName, domainQuark, code, message) {
  const error = new GLibError(domainName, code, message);
  error.domain = domainName;
  error.domainQuark = domainQuark;
  return error;
}
native.setErrorBuilder(buildGError);

// Symbol stamping a makeClass prototype with its { namespace, typeName }, so
// Gio._promisify can record WHICH introspected class a registration belongs to
// (introspected instances have no live prototype chain to resolve by). Read in
// _promisify; matched against the instance's GType via native.isInstanceOf.
const CLASS_INFO = Symbol('nodeGiClassInfo');

// Promisified async methods, keyed by GI method name (snake_case) → an array of
// registrations `{ namespace?, typeName?, wrapper }`. Introspected-class instances
// resolve methods dynamically (no prototype chain), so the instance proxy consults
// this registry. Usually one registration per name (fast path); when two classes
// promisify the SAME method name, the instance proxy picks the registration whose
// class the instance is-a (native.isInstanceOf). See _promisify / wrapInstance.
const promisifiedMethods = new Map();

// Object-typed return values become chainable instance proxies; boxed/struct
// handles (e.g. GMainLoop) become method-routing proxies; everything else
// (primitives, strings, null) passes through.
function wrapReturn(value) {
  if (native.isGObjectHandle(value)) return wrapInstance(value);
  // A GLib.Variant is ALSO a boxed handle (by tag), so it must be checked first
  // to give it the Variant ergonomics rather than a plain method-routing proxy.
  if (native.isVariantHandle(value)) return wrapVariant(value);
  if (native.isBoxedHandle(value)) return wrapBoxed(value);
  return value;
}

// Wrap a user's signal callback so each native signal argument is passed through
// {@link wrapReturn} — a GObject arg becomes a chainable instance, a GVariant
// arg (e.g. the value on Gio.SimpleAction::change-state) becomes a GLib.Variant
// wrapper, primitives/plain objects pass through. (The emitter instance is not
// passed in this milestone — see connectSignal.)
function wrapSignalCallback(cb) {
  return (...args) => cb(...args.map(wrapReturn));
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

// ---- GLib.Variant ergonomics (the GJS GLib.Variant override, L1) ----
//
// Mirrors gjs/modules/core/overrides/GLib.js: `new GLib.Variant(sig, value)`
// recursively packs (native variantNew), and the wrapper exposes `.unpack()`,
// `.deepUnpack()`/`.deep_unpack`, `.recursiveUnpack()`, `.get_type_string()` and
// the GJS toString, plus routing of any other GVariant method (n_children,
// get_child_value, print, …) through the boxed-method engine. The deep-vs-
// recursive distinction is honoured in the native unpacker (variantUnpack):
//   unpack()           → variantUnpack(h, false, false): children stay Variants
//   deepUnpack()       → variantUnpack(h, true,  false): one level; nested `v`
//                        values (e.g. an a{sv} value) STAY Variants
//   recursiveUnpack()  → variantUnpack(h, true,  true):  fully plain JS, no
//                        Variants (discards `v` type info)

// Re-wrap the result of variantUnpack: any GLib.Variant handle that the native
// unpacker left in place (an `a{sv}` value under deepUnpack, every child under
// unpack(), …) becomes a GLib.Variant wrapper; arrays/plain dicts are walked.
function wrapVariantResult(value) {
  if (value === null || typeof value !== 'object') return value;
  if (native.isVariantHandle(value)) return wrapVariant(value);
  if (value instanceof Uint8Array) return value; // `ay` bytes
  if (Array.isArray(value)) return value.map(wrapVariantResult);
  const out = {};
  for (const key of Object.keys(value)) out[key] = wrapVariantResult(value[key]);
  return out;
}

// Wrap a boxed GLib.Variant handle with the GJS-shaped Variant surface. Carries
// [HANDLE] so it round-trips back into the engine as a GVariant IN argument
// (action.activate(variant), new_stateful state, change_state value, …).
function wrapVariant(handle) {
  const target = { [HANDLE]: handle };
  const api = {
    unpack: () => wrapVariantResult(native.variantUnpack(handle, false, false)),
    deepUnpack: () => wrapVariantResult(native.variantUnpack(handle, true, false)),
    deep_unpack: () => wrapVariantResult(native.variantUnpack(handle, true, false)),
    recursiveUnpack: () => native.variantUnpack(handle, true, true),
    get_type_string: () => native.variantGetTypeString(handle),
    toString: () => `[object variant of type "${native.variantGetTypeString(handle)}"]`,
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === HANDLE) return handle;
      if (typeof prop !== 'string') return t[prop];
      if (Object.hasOwn(api, prop)) return api[prop];
      if (RESERVED.has(prop)) return t[prop];
      // Any other GVariant method (n_children, get_child_value, print, …).
      return (...args) =>
        wrapReturn(native.callBoxedMethod(handle, camelToSnake(prop), unwrapArgs(args)));
    },
    has(t, prop) {
      return prop === HANDLE || (typeof prop === 'string' && Object.hasOwn(api, prop)) || prop in t;
    },
  });
}

// Deep-unwrap a pack value so any nested GLib.Variant wrapper (carried at a `v`
// position, e.g. an a{sv} value) reaches the native packer as its raw handle —
// the native `v` case reads a raw boxed handle, not an L1 Proxy. Primitives,
// byte arrays, plain arrays and dict objects are walked; HANDLE-carrying
// wrappers collapse to their handle.
function unwrapVariantValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value[HANDLE] !== undefined) return value[HANDLE];
  if (value instanceof Uint8Array) return value; // `ay` bytes
  if (Array.isArray(value)) return value.map(unwrapVariantValue);
  const out = {};
  for (const key of Object.keys(value)) out[key] = unwrapVariantValue(value[key]);
  return out;
}

function packVariant(signature, value) {
  return wrapVariant(native.variantNew(signature, unwrapVariantValue(value)));
}

// `GLib.Variant` as a class-like object: `new GLib.Variant(sig, value)` and the
// deprecated `GLib.Variant.new(sig, value)` both pack via the native engine.
function makeVariantClass() {
  const ctor = function Variant(signature, value) {
    return packVariant(signature, value);
  };
  Object.defineProperty(ctor, 'name', { value: 'Variant', configurable: true });
  ctor.$gtypeName = 'GLib.Variant';
  ctor.new = (signature, value) => packVariant(signature, value);
  // `value instanceof GLib.Variant` — a wrapped Variant is a Proxy over a bare
  // `{[HANDLE]}` target (no class prototype), so the default instanceof always
  // returned false. Recognise any wrapper whose [HANDLE] is a native GVariant
  // boxed handle. Real GAction/GSettings/GLib.log_structured code branches on it.
  Object.defineProperty(ctor, Symbol.hasInstance, {
    value(instance) {
      if (instance === null || typeof instance !== 'object') return false;
      const handle = instance[HANDLE];
      return handle !== undefined && native.isVariantHandle(handle);
    },
    configurable: true,
  });
  return new Proxy(ctor, {
    get(t, prop) {
      if (typeof prop !== 'string' || prop in t || RESERVED.has(prop)) return t[prop];
      // Other static constructors (e.g. new_from_bytes) route through the engine.
      const giName = camelToSnake(prop);
      return (...args) =>
        wrapReturn(native.callStaticMethod('GLib', 'Variant', giName, unwrapArgs(args)));
    },
    construct(_t, args) {
      return packVariant(args[0], args[1]);
    },
  });
}

const variantClass = makeVariantClass();

// Overlay the GJS Variant ergonomics on the introspected GLib namespace, leaving
// every other member resolving from introspection. (Additive, like the GObject
// overlay; the introspected struct-based `GLib.Variant` is replaced by the
// ergonomic wrapper class so `new GLib.Variant(...)` + `.deepUnpack()` work.)
function decorateGLibNamespace(baseNs) {
  return new Proxy(baseNs, {
    get(t, prop) {
      if (prop === 'Variant') return variantClass;
      // GLib.Error is the L1 GError subclass (the engine throws instances of it,
      // and `new GLib.Error(domain, code, message)` constructs one), shadowing the
      // introspected boxed type so `instanceof GLib.Error` + `.matches()` work.
      if (prop === 'Error') return GLibError;
      return t[prop];
    },
    has(t, prop) {
      return prop === 'Variant' || prop === 'Error' || prop in t;
    },
  });
}

// Overlay the GJS Gio runtime statics on the introspected Gio namespace —
// additively. `_promisify` is the genuinely-new helper (refs/gjs Gio.js); every
// other member keeps resolving from introspection.
function decorateGioNamespace(baseNs) {
  return new Proxy(baseNs, {
    get(t, prop) {
      if (prop === '_promisify') return promisify;
      return t[prop];
    },
    has(t, prop) {
      return prop === '_promisify' || prop in t;
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

// L1 proxy-identity cache (the user-visible half of the toggle-ref bridge). The
// native engine now returns the CANONICAL External per GObject (same GObject ⇒
// same handle), so we cache the per-instance Proxy keyed by that handle: the same
// GObject always yields the same L1 wrapper, so `===` holds at the ergonomic
// layer and a plain JS field set on a wrapper survives a round-trip + GC (the
// External is kept alive by the toggle-up root while C owns the object, which in
// turn keeps this WeakMap entry — and the proxy + its fields — alive).
const instanceCache = new WeakMap();

// Wrap a live GObject handle as a GJS-shaped instance. When `userProto` is given
// (a registerClass subclass's prototype) the wrapper resolves the user class's
// own prototype members FIRST — so `inst.myMethod()` runs the JS method with the
// wrapper as `this` — then falls back to GObject property get/set and GI method
// routing. `.connect()/.emit()/.disconnect()` work in both modes.
function wrapInstance(handle, userProto) {
  const cached = instanceCache.get(handle);
  if (cached !== undefined) {
    // UPGRADE a cached generic (userProto-less) wrapper when this wrap supplies a
    // userProto — so a subclass instance first seen generically (returned from
    // store.get_item / a signal sender / resurrection) still gets its prototype
    // methods. Never DOWNGRADE: an existing userProto is kept. The userProto lives
    // on the target (read via the proxy here), so the upgrade is in place —
    // identity (===) and any expando fields are preserved.
    if (userProto !== undefined && cached[USER_PROTO] === undefined) {
      cached[USER_PROTO] = userProto;
    }
    return cached;
  }
  const target = { [HANDLE]: handle };
  if (userProto !== undefined) target[USER_PROTO] = userProto;
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === HANDLE) return handle;
      if (typeof prop !== 'string' || RESERVED.has(prop)) return t[prop];
      switch (prop) {
        case 'connect':
          return (signal, cb) => native.connectSignal(handle, signal, wrapSignalCallback(cb), false);
        case 'connect_after':
          return (signal, cb) => native.connectSignal(handle, signal, wrapSignalCallback(cb), true);
        case 'emit':
          return (signal, ...args) =>
            wrapReturn(native.emitSignal(handle, signal, unwrapArgs(args)));
        case 'disconnect':
          return (id) => native.disconnectSignal(handle, id);
        default:
          break;
      }
      const up = t[USER_PROTO];
      if (up !== undefined) {
        const desc = findProtoDescriptor(up, prop);
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
      // Surface a plain JS field previously written on THIS wrapper. With the
      // toggle-ref bridge the wrapper is now CANONICAL (one proxy per GObject,
      // cached by the canonical native handle), so a plain field IS shared across
      // the vfunc<->instance boundary and survives a round-trip + GC while C owns
      // the object — a vfunc's `this` resolves to the same cached proxy as
      // construct, and `store.get_item(x)` returns the same proxy a setter wrote
      // to. Own-property only (set via the `set` trap), so an introspected GI
      // method of the same name is never shadowed unless the user explicitly
      // assigned an expando. (GObject PROPERTIES remain the right choice for state
      // that must also be visible to C / other language bindings.)
      if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
      // LAST resort before treating an unknown name as a GI method: an INHERITED
      // member (Object.prototype.hasOwnProperty / isPrototypeOf / … — RESERVED
      // already covers toString/valueOf/etc.) must resolve to the real function,
      // not a GI callMethod thunk that would throw on `inst.hasOwnProperty('x')`.
      if (prop in t) return t[prop];
      // A Gio._promisify'd async method (registerClass subclasses pick it up via
      // their userProto above; introspected instances have no prototype chain, so
      // they resolve it here from the registry, per-class). Bound to this instance.
      const promisified = resolvePromisified(handle, camelToSnake(prop));
      if (promisified !== undefined) return (...args) => promisified.apply(proxy, args);
      return (...args) => wrapReturn(native.callMethod(handle, camelToSnake(prop), unwrapArgs(args)));
    },
    set(t, prop, value) {
      if (typeof prop === 'string') {
        const up = t[USER_PROTO];
        if (up !== undefined) {
          const desc = findProtoDescriptor(up, prop);
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
        const up = t[USER_PROTO];
        if (up !== undefined && findProtoDescriptor(up, prop) !== undefined) return true;
        if (native.hasProperty(handle, toKebab(prop))) return true;
      }
      return false;
    },
  });
  instanceCache.set(handle, proxy);
  return proxy;
}

// Shared object installed at the BASE of every introspected class's prototype
// chain so `super.vfunc_<name>(...)` inside a registerClass override resolves to a
// chain-up thunk. A registered subclass extends an introspected base (e.g.
// `class X extends GObject.Object`), so `super.vfunc_x` looks up `vfunc_x` on the
// base class's prototype; with this Proxy beneath it, any `vfunc_*` access yields
// a thunk that invokes the captured parent (C) vfunc via native.callParentVfunc,
// with `this` (the canonical wrapper instance) as the GObject. Mirrors GJS, where
// the introspected parent's `vfunc_x` is a thunk into the actual C vtable entry.
// Non-`vfunc_` lookups fall through to Object.prototype (so the base prototype
// keeps its normal object behaviour).
const vfuncChainProto = new Proxy(Object.create(Object.prototype), {
  get(target, prop, receiver) {
    if (typeof prop === 'string' && prop.startsWith('vfunc_')) {
      const vfuncName = prop.slice('vfunc_'.length);
      return function chainUpToParentVfunc(...args) {
        const handle = this !== null && this !== undefined ? this[HANDLE] : undefined;
        if (handle === undefined) {
          throw new TypeError(`super.${prop}(): chain-up requires a node-gi instance as \`this\``);
        }
        return wrapReturn(native.callParentVfunc(handle, vfuncName, unwrapArgs(args)));
      };
    }
    return Reflect.get(target, prop, receiver);
  },
});

function makeClass(namespace, typeName) {
  const ctor = function ctor(props) {
    const handle = native.newObject(namespace, typeName, props ? unwrapProps(props) : {});
    return wrapInstance(handle);
  };
  Object.defineProperty(ctor, 'name', { value: typeName, configurable: true });
  ctor.$gtypeName = `${namespace}.${typeName}`;
  // Put the vfunc chain-up Proxy beneath this base class's prototype so a
  // registerClass subclass's `super.vfunc_<name>(...)` resolves (see above).
  Object.setPrototypeOf(ctor.prototype, vfuncChainProto);
  // Stamp the prototype with its class identity so Gio._promisify(Cls.prototype, …)
  // can record which class a registration belongs to (non-enumerable).
  Object.defineProperty(ctor.prototype, CLASS_INFO, {
    value: { namespace, typeName },
    enumerable: false,
    configurable: true,
  });
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
  // If this enum is registered as a GError domain (Gio.IOErrorEnum, …), attach
  // its domain descriptor (non-enumerable) so GLib.Error.matches(enum, code) can
  // resolve the enum to its domain. A plain enum gets nothing (getErrorDomain → null).
  const domain = native.getErrorDomain(namespace, typeName);
  if (domain !== null) {
    Object.defineProperty(out, ERROR_DOMAIN, { value: domain, enumerable: false });
  }
  return Object.freeze(out);
}

// ---- Gio._promisify (L1, GJS-shaped) ----
//
// The Node twin of GJS's Gio._promisify (refs/gjs/modules/core/overrides/Gio.js).
// Wraps an async method so calling it WITHOUT a trailing GAsyncReadyCallback
// returns a Promise: it invokes the underlying async method passing a callback
// that runs `finishName` and resolves with its return (the OUT-param tuple), or
// rejects with the GLib.Error the finish call throws. Called WITH a trailing
// callback it behaves as the plain async method (no Promise).
//
// Builds on: OUT/INOUT params (finish returns its results via out-params), the
// libuv↔GLib mainloop bridge (the async completion fires on the loop) and GI
// callbacks (the GAsyncReadyCallback). The async op holds a ref on the source
// object and the GAsyncReadyCallback wrapper holds a strong ref to the JS callback
// (which captures the instance proxy), so the wrapper + its GObject stay alive
// until completion — instance identity, toggle-ref #656.

// _async / _begin → _finish; otherwise <name>_finish (GJS's convention).
function deriveFinishName(asyncName) {
  if (asyncName.endsWith('_begin') || asyncName.endsWith('_async')) {
    return `${asyncName.slice(0, -5)}finish`;
  }
  return `${asyncName}_finish`;
}

// Build the promisified wrapper for `asyncName`. Uses `this` (the instance proxy)
// so it works both bound from the registry and as a prototype method.
function makePromisified(asyncName, finishName) {
  const giAsync = camelToSnake(asyncName);
  return function promisified(...args) {
    const handle = this[HANDLE];
    // A trailing callback → plain async method (the caller drives the callback).
    // Wrap it so its (source, result) args are marshalled to wrapped instances —
    // matching the Promise path and GJS, so `source.finish(result)` works.
    if (args.length > 0 && typeof args[args.length - 1] === 'function') {
      const userCb = args[args.length - 1];
      const forwarded = [...args.slice(0, -1), wrapSignalCallback(userCb)];
      return wrapReturn(native.callMethod(handle, giAsync, unwrapArgs(forwarded)));
    }
    const self = this;
    return new Promise((resolve, reject) => {
      // wrapSignalCallback marshals each native callback arg (source, res) through
      // wrapReturn → wrapped instances, so both `source[finishName](res)` and the
      // captured-instance fallback round-trip cleanly.
      const onReady = wrapSignalCallback((source, res) => {
        try {
          const finisher =
            source !== null && source !== undefined && typeof source[finishName] === 'function'
              ? source[finishName].bind(source)
              : self[finishName].bind(self);
          const value = finisher(res);
          // GJS's _promisify drops a leading `true` ok-flag so the dominant
          // finish shape (load_contents_finish, query_info_finish,
          // communicate_utf8_finish, … → [true, …]) resolves to just the
          // payload — keeping one source byte-identical on gjs + node.
          if (Array.isArray(value) && value.length > 1 && value[0] === true) {
            value.shift();
          }
          resolve(value);
        } catch (error) {
          reject(error);
        }
      });
      native.callMethod(handle, giAsync, unwrapArgs([...args, onReady]));
    });
  };
}

/**
 * Gio._promisify(prototype, asyncName, finishName?) — replace an async method so a
 * call without a trailing callback returns a Promise. `finishName` defaults per
 * GJS's convention (`_async`/`_begin` → `_finish`, else `<name>_finish`). Works on
 * any introspected class prototype (e.g. Gio.File.prototype) or a registerClass
 * subclass prototype.
 * @param {object} proto e.g. Gio.File.prototype
 * @param {string} asyncName e.g. "load_contents_async"
 * @param {string} [finishName] e.g. "load_contents_finish"
 * @returns {void}
 */
function promisify(proto, asyncName, finishName = undefined) {
  if (proto === null || typeof proto !== 'object') {
    throw new TypeError('Gio._promisify: prototype must be an object');
  }
  if (typeof asyncName !== 'string') {
    throw new TypeError('Gio._promisify: asyncName must be a string');
  }
  const finish = finishName === undefined ? deriveFinishName(asyncName) : finishName;
  const wrapper = makePromisified(asyncName, finish);
  // Install on the prototype (so proto[asyncName] IS the promisified method, and a
  // registerClass subclass — which resolves its userProto — picks it up) AND in
  // the global registry (introspected instances resolve methods dynamically, with
  // no live prototype chain to walk).
  try {
    proto[asyncName] = wrapper;
  } catch {
    // A frozen/sealed prototype — the registry still makes it work.
  }
  // Record the registration keyed by the GI method name, tagged with the class it
  // was registered on (CLASS_INFO from makeClass) so two classes promisifying the
  // same method name with different finish methods stay disambiguated per-class.
  const info = proto[CLASS_INFO];
  const registration = {
    namespace: info ? info.namespace : undefined,
    typeName: info ? info.typeName : undefined,
    wrapper,
  };
  const key = camelToSnake(asyncName);
  const existing = promisifiedMethods.get(key);
  if (existing === undefined) {
    promisifiedMethods.set(key, [registration]);
  } else {
    // Replace a same-class registration in place; otherwise append (a second class).
    const i = existing.findIndex(
      (r) => r.namespace === registration.namespace && r.typeName === registration.typeName,
    );
    if (i >= 0) existing[i] = registration;
    else existing.push(registration);
  }
}

// Resolve the promisified wrapper for `methodName` on an instance handle. The
// common case is a single registration (fast path); when several classes
// promisified the same method name, pick the one whose class the instance is-a.
function resolvePromisified(handle, methodName) {
  const registrations = promisifiedMethods.get(methodName);
  if (registrations === undefined) return undefined;
  if (registrations.length === 1) return registrations[0].wrapper;
  for (const r of registrations) {
    if (r.namespace !== undefined && native.isInstanceOf(handle, r.namespace, r.typeName)) {
      return r.wrapper;
    }
  }
  // No class matched (or a registerClass registration with no CLASS_INFO) — fall
  // back to the last registration so a single-class misconfig still resolves.
  return registrations[registrations.length - 1].wrapper;
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
// `super.vfunc_<name>(...)` inside the override resolves to a chain-up thunk on the
// introspected base class's prototype (vfuncChainProto → native.callParentVfunc):
// applying the user fn with a custom `this` keeps `super` bound to its lexical home
// object (klass.prototype), so chain-up works through the .apply boundary.
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

  // Gtk.Widget composite template (GJS-shaped meta: Template / Children /
  // InternalChildren / CssName). Template is a Uint8Array/Buffer of inline UI-XML,
  // a "resource:///…" path string, or an inline UI-XML string — passed through to
  // the engine, which installs it in class_init (set_template[_from_resource] +
  // bind_template_child_full) and runs gtk_widget_init_template at construction.
  const options = { properties, signals, vfuncs };
  if (meta.Template !== undefined && meta.Template !== null) options.template = meta.Template;
  if (typeof meta.CssName === 'string' && meta.CssName.length > 0) options.cssName = meta.CssName;
  const children = Array.isArray(meta.Children) ? meta.Children.filter((c) => typeof c === 'string') : [];
  const internalChildren = Array.isArray(meta.InternalChildren)
    ? meta.InternalChildren.filter((c) => typeof c === 'string')
    : [];
  if (children.length > 0) options.children = children;
  if (internalChildren.length > 0) options.internalChildren = internalChildren;

  const typeHandle = native.registerClass(
    gtypeName,
    parent.parentNamespace,
    parent.parentType,
    options,
  );

  const Subclass = function (props) {
    const handle = native.constructType(typeHandle, props ? unwrapProps(props) : {});
    const instance = wrapInstance(handle, klass.prototype);
    // Surface the bound template children on the instance (GJS convention: public
    // `this.<name>`, internal `this._<name>`, '-' → '_'). The engine already ran
    // init_template during construction, so get_template_child resolves each.
    for (const childName of children) {
      instance[childName.replace(/-/g, '_')] = wrapReturn(native.getTemplateChild(handle, childName));
    }
    for (const childName of internalChildren) {
      instance[`_${childName.replace(/-/g, '_')}`] = wrapReturn(
        native.getTemplateChild(handle, childName),
      );
    }
    return instance;
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
    // The GLib namespace carries the GJS-shaped GLib.Variant ergonomics
    // (new GLib.Variant(sig, value) + deepUnpack/unpack/recursiveUnpack) and the
    // GLib.Error class.
    else if (namespace === 'GLib') ns = decorateGLibNamespace(ns);
    // The Gio namespace carries Gio._promisify (async → Promise).
    else if (namespace === 'Gio') ns = decorateGioNamespace(ns);
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
