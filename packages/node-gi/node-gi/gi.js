// SPDX-License-Identifier: MIT
// @gjsify/node-gi/gi — the L1 GJS-compatibility layer over the native engine: it turns
// the engine primitives into a GJS-shaped namespace object, so `requireGi('Gio','2.0')`
// gives the same surface as `import Gio from 'gi://Gio?version=2.0'` under GJS. This is
// the seam the bundler's --app node target rewrites `gi://Ns?version=X` onto.
//
// Reference: gjs/modules/esm/gi.js for the require shape; node-gtk (romgrk, MIT) for the
// binding lineage. Hand-authored JS — the package ships no build step.
import * as native from './index.js';
// From node:timers, not the globals, for two reasons: setImmediate is a Node/Bun global
// but Deno only exposes it here; and a GJS source running through the bridge routinely
// replaces the global timers with GLib-backed ones (`@gjsify/node-globals/register`
// swaps them for `GLib.timeout_add`), which deadlocks the pump — the timer meant to
// dispatch GLib sources would itself be a GLib source nobody dispatches.
import { setImmediate, setInterval, clearInterval } from 'node:timers';
// Same reasoning for `process`: `globalThis.process` may be the `@gjsify/process`
// polyfill, whose EventEmitter never emits the runtime's 'beforeExit', so the
// loop-liveness hooks below would silently never fire.
import runtimeProcess from 'node:process';
import { createGioDBus } from './overrides/gio-dbus.js';

// The raw native GObject handle on a wrapped instance, so it can be unwrapped again
// when passed back into the engine as a GI argument.
const HANDLE = Symbol('nodeGiHandle');

// The user-class prototype (a registerClass subclass) on a wrapped instance. On the
// target rather than in the proxy closure, so a later wrap carrying a userProto can
// UPGRADE an already-cached generic wrapper in place, preserving identity + expandos.
const USER_PROTO = Symbol('nodeGiUserProto');

// Names that must NEVER be treated as a GI method or property — otherwise awaiting,
// printing or inspecting a wrapper would call into GObject (a stray `then` alone would
// make every wrapper look thenable).
const RESERVED = new Set(['then', 'toString', 'valueOf', 'constructor', 'inspect']);

// GJS accepts both snake_case and camelCase for methods/properties: map a JS accessor
// to the GI method name (snake_case) and to a GObject property name (kebab-case); a
// name already in the target case passes through.
function camelToSnake(name) {
    return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function toKebab(name) {
    return name
        .replace(/([A-Z])/g, '-$1')
        .replace(/_/g, '-')
        .toLowerCase();
}

// Repeated passes of the same callback must marshal to the SAME native-facing function:
// stable identity, one ffi/GClosure wrapper per user fn.
const callbackShims = new WeakMap();

// A JS function crossing INTO the engine (a GI callback arg, or a JS fn marshalled as a
// GClosure IN-arg) is wrapped so C sees GJS's calling convention: each native arg goes
// through wrapReturn (a GObject handle becomes the cached chainable instance, a GVariant
// a GLib.Variant wrapper, …) and the JS return is unwrapped back to its native handle —
// a GLib.Variant wrapper returned from e.g. a DBus get-property closure must reach the
// engine as the raw variant handle.
function wrapCallbackFn(fn) {
    let shim = callbackShims.get(fn);
    if (shim === undefined) {
        shim = (...args) => unwrapArg(fn(...args.map(wrapReturn)));
        callbackShims.set(fn, shim);
    }
    return shim;
}

function unwrapArg(value) {
    if (value !== null && typeof value === 'object' && value[HANDLE] !== undefined) {
        return value[HANDLE];
    }
    // An ARRAY is a container whose ELEMENTS need the same unwrapping, and until this
    // line they did not get it: only the top-level argument was unwrapped, so an array
    // of GObjects reached the engine as an array of JS wrappers and
    // `NodeGiToGIArgument`'s GI_TYPE_TAG_INTERFACE branch — which accepts nothing but
    // an External carrying the handle — threw
    // `expected a GObject handle as a container element`. That is EVERY GI method
    // taking an array of objects, not one method: measured on
    // `Gio.ListStore.splice(0, n, [a, b])`, where `append(a)` on the same store
    // succeeded because one GObject as a top-level arg was always unwrapped.
    //
    // `Array.isArray`, not `typeof value === 'object'`: a Uint8Array is a
    // GByteArray/guint8[] argument the engine reads directly, and mapping over it here
    // would turn it into a plain Array and lose that.
    //
    // Recursive, so a nested array and a GObject inside one are handled by the same
    // rule rather than by a second one that drifts — and this is now the same shape
    // `wrapReturn` has carried all along for the OTHER direction. That asymmetry is
    // why the gap stayed invisible: a container coming BACK had its elements wrapped,
    // a container going IN did not, and nothing read both lines at once.
    if (Array.isArray(value)) return value.map(unwrapArg);
    if (typeof value === 'function') return wrapCallbackFn(value);
    return value;
}

function unwrapArgs(args) {
    return args.map(unwrapArg);
}

// Normalize a construct-property dict: KEY to the GObject canonical (kebab) property
// name, VALUE unwrapped to its native handle. GJS accepts camelCase, snake_case or
// already-dashed keys, while the native layer looks each key up against the GParamSpec
// by its canonical dashed name — `{maximumSize:400}` would otherwise miss
// `maximum-size`. Reusing `toKebab` keeps construction and property accessors on one
// normalization. Idempotent, since GObject canonicalizes `_`↔`-`.
function unwrapProps(props) {
    const out = {};
    for (const key of Object.keys(props)) out[toKebab(key)] = unwrapArg(props[key]);
    return out;
}

// An enum object's GError-domain descriptor ({ name, quark }), so GLib.Error.matches
// can resolve an error-enum (Gio.IOErrorEnum) to the domain it represents. Attached by
// makeEnum when the enum is registered as a GError domain.
const ERROR_DOMAIN = Symbol('nodeGiErrorDomain');

// GLib.Error, L1: the engine throws one of these on a failed sync GI invoke (via the
// builder registered below) and `requireGi('GLib').Error` is this constructor, so a
// caught error is `instanceof GLib.Error` exactly as under GJS.
//
// Deliberate divergence from GJS: `.domain` is the quark NAME string (GJS's is the
// numeric GQuark), with the numeric quark on `.domainQuark`. `matches()` accepts the
// domain as an error-enum object, a name string or a numeric quark.

// Resolve a `matches` domain argument to a { name?, quark? } descriptor.
function errorDomainOf(domain) {
    if (domain === null || domain === undefined) return null;
    if (typeof domain === 'object' && domain[ERROR_DOMAIN] !== undefined) return domain[ERROR_DOMAIN];
    if (typeof domain === 'string') return { name: domain };
    if (typeof domain === 'number') return { quark: domain };
    return null;
}

class GLibError extends Error {
    // `new GLib.Error(domain, code, message)`, where `domain` may be an error-enum
    // object, a quark name string, or a numeric quark.
    constructor(domain, code, message) {
        super(typeof message === 'string' ? message : '');
        this.name = 'GLib.Error';
        const d = errorDomainOf(domain);
        this.domain = d !== null && d.name !== undefined ? d.name : typeof domain === 'string' ? domain : undefined;
        this.domainQuark =
            d !== null && d.quark !== undefined ? d.quark : typeof domain === 'number' ? domain : undefined;
        this.code = code;
    }

    // g_error_matches: true when the error's domain AND code both match.
    matches(domain, code) {
        const d = errorDomainOf(domain);
        if (d === null) return false;
        const domainMatch =
            (d.name !== undefined && d.name === this.domain) || (d.quark !== undefined && d.quark === this.domainQuark);
        return domainMatch && code === this.code;
    }

    toString() {
        return `GLib.Error ${this.domain}: ${this.message}`;
    }
}

// Called by the engine on a failed GI invoke, with the GError's authoritative fields.
function buildGError(domainName, domainQuark, code, message) {
    const error = new GLibError(domainName, code, message);
    error.domain = domainName;
    error.domainQuark = domainQuark;
    return error;
}
// The CLASS is registered with the builder, because the engine needs it the other
// way round too: a `GError`-typed IN argument recognises a caught (or `new`-ed)
// GLib.Error by `instanceof` and rebuilds a real GError from its fields, so an
// application can hand back the error it is holding (`GLib.propagate_error`,
// `Gst.Message.new_error`). One call, so builder and class cannot drift apart.
native.setErrorBuilder(buildGError, GLibError);

// Stamps a makeClass prototype with its { namespace, typeName } so Gio._promisify can
// record WHICH introspected class a registration belongs to — matched against the
// instance's GType via native.isInstanceOf when the promisified prototype is not the
// one the instance resolves through.
const CLASS_INFO = Symbol('nodeGiClassInfo');

// Promisified async methods: GI method name (snake_case) → registrations
// `{ namespace?, typeName?, wrapper }`. An instance whose concrete GType resolves to a
// DIFFERENT prototype than the promisified one (a private GLocalFile against
// Gio.File.prototype) reaches the wrapper only through this registry; when two classes
// promisify the SAME method name it picks the registration whose class the instance is-a.
const promisifiedMethods = new Map();

function wrapReturn(value) {
    if (native.isGObjectHandle(value)) return wrapInstance(value);
    // A GLib.Variant is ALSO a boxed handle by tag, so it must be checked first to get
    // the Variant ergonomics rather than a plain method-routing proxy.
    if (native.isVariantHandle(value)) return wrapVariant(value);
    // A GParamSpec is a distinct GObject fundamental, tagged separately from boxed.
    if (native.isParamSpecHandle(value)) return wrapParamSpec(value);
    if (native.isFundamentalHandle(value)) return wrapFundamental(value);
    if (native.isBoxedHandle(value)) return wrapBoxed(value);
    // A multi-value OUT tuple (return + OUT params), or a container OUT, is a plain
    // Array whose ELEMENTS may themselves be handles (GLib.Regex.match → [matched,
    // GLib.MatchInfo]), so recurse rather than leave a raw External. A Node Buffer is
    // not Array.isArray, so byte arrays pass through untouched.
    if (Array.isArray(value)) return value.map(wrapReturn);
    return value;
}

// GJS parity: the engine prepends the EMITTER as the first arg, so a positional handler
// `(obj, …params) => …` binds correctly (for `notify::x` the args are (object, pspec)).
// The emitter is itself a GObject arg, so wrapReturn turns it into the cached,
// toggle-ref-canonical instance.
function wrapSignalCallback(cb) {
    return (...args) => cb(...args.map(wrapReturn));
}

// Resolve a Gtk.Template `<signal handler="…">` handler NAME to a dispatcher calling the
// instance's bound JS method, for the native template-callback scope. Mirrors GJS's
// `_createClosure` in its Gtk override.
//
// LAZY by necessity: the engine resolves template signals during the C-side
// constructType (init_template → create_closure), which runs BEFORE this layer attaches
// the user-class prototype to the instance proxy. Deferring the lookup to FIRE time
// means `this` is the full userProto-carrying wrapper — the SAME cached proxy the user
// constructed. Emitter at param 0, as in wrapSignalCallback.
function resolveTemplateCallback(handle, handlerName) {
    return (...args) => {
        const proxy = wrapInstance(handle);
        const userProto = proxy[USER_PROTO];
        const desc = userProto !== undefined ? findProtoDescriptor(userProto, handlerName) : undefined;
        if (desc === undefined || typeof desc.value !== 'function') {
            throw new Error(
                `Gtk.Template: signal handler '${handlerName}' is not defined on ${proxy.constructor?.name ?? 'the instance'}`,
            );
        }
        return desc.value.apply(proxy, args.map(wrapReturn));
    };
}
native.setTemplateCallbackResolver(resolveTemplateCallback);

// Run a registered class's JS constructor for a GObject the ENGINE instantiated from C
// — typically a GtkBuilder composite-template InternalChild, which has no JS-`new` to
// drive the ctor, so the overridden `constructor` vfunc calls this with the canonical
// handle + GType name. Setting `adoptHandle` before Reflect.construct makes the
// makeClass base ctor ADOPT that handle instead of creating a second GObject, so the
// ctor body's `this._x = …` land as expandos on the one wrapper GtkBuilder-fetched
// children later resolve to. GJS does the same in gjs_object_constructor's
// native-construction branch.
function runCtorForCObject(handle, gtypeName) {
    const cls = classesByGType.get(gtypeName);
    if (cls === undefined) return; // not a node-gi-registered class (shouldn't happen)
    const prev = adoptHandle;
    adoptHandle = handle;
    try {
        // No props: GtkBuilder already applied the construct properties to the C object;
        // the ctor's `params` arg is conventionally optional for a template child.
        Reflect.construct(cls, []);
    } finally {
        adoptHandle = prev;
    }
}
native.setConstructCallback(runCtorForCObject);

// A non-GObject GObject-fundamental (GskRenderNode, GdkEvent) as an OPAQUE,
// round-trippable handle: the native tagged External already carries the pointer and
// drops the held ref on GC via the type's own unref func, so L1 need only expose it
// under HANDLE for unwrapArg to feed back into a fundamental-typed IN arg. No method
// dispatch — these are pass-through intermediates (build → hand to a consumer → drop),
// which is what the GSK screenshot/render path needs.
function wrapFundamental(handle) {
    return { [HANDLE]: handle, [Symbol.toStringTag]: 'GIFundamental' };
}

// A boxed/struct/union handle: methods callable GJS-style (`mainLoop.run()`, snake_case
// or camelCase) and FIELDS readable/writable as plain properties (`union.long_ = 5`).
// Resolution rule, verified against gjs 1.88's find_unique_js_field_name: a name that is
// BOTH resolves to the METHOD, and gjs renames the colliding field to `_name`. Hence
// boxedMemberKind checks methods first — 1 = method, 2 = field, 0 = neither,
// 3 = undecidable.
function wrapBoxed(handle) {
    const target = { [HANDLE]: handle };
    const methodDispatch =
        (prop) =>
        (...args) =>
            wrapReturn(native.callBoxedMethod(handle, camelToSnake(prop), unwrapArgs(args)));
    return new Proxy(target, {
        get(t, prop) {
            if (prop === HANDLE) return handle;
            if (typeof prop !== 'string' || RESERVED.has(prop)) return t[prop];
            // A field written through the set trap below lands as an expando on the
            // target (gjs likewise allows writing a GI-unwritable boxed field to a JS
            // expando); surface it before consulting introspection.
            if (Object.hasOwn(t, prop)) return t[prop];
            // GBytes has no introspected `to_array`; gjs adds `toArray` to
            // GLib.Bytes.prototype, so mirror it via the introspected get_data(). Gated
            // on the boxed type so it never shadows a same-named method on another struct.
            if (prop === 'toArray' && native.boxedTypeName(handle) === 'GBytes') {
                return () => wrapReturn(native.callBoxedMethod(handle, 'get_data', []));
            }
            const snake = camelToSnake(prop);
            // kind 0 (type info resolved, not a member) must read `undefined` to match
            // gjs: a fabricated dispatcher would make `typeof boxed.noSuchName` report
            // 'function' and break duck-typing checks. Kind 3 (unregistered struct, no
            // static info) keeps the dispatcher fallback, so a genuine method still
            // resolves and an unknown one throws a clear error at call time.
            const kind = native.boxedMemberKind(handle, snake);
            if (kind === 2) return wrapReturn(native.getBoxedField(handle, snake));
            if (kind === 0) return undefined;
            return methodDispatch(prop);
        },
        set(t, prop, value) {
            if (prop === HANDLE || typeof prop !== 'string' || RESERVED.has(prop)) {
                return Reflect.set(t, prop, value);
            }
            const snake = camelToSnake(prop);
            if (native.boxedMemberKind(handle, snake) === 2) {
                native.setBoxedField(handle, snake, unwrapArg(value));
                return true;
            }
            return Reflect.set(t, prop, value);
        },
        has(t, prop) {
            if (prop === HANDLE || prop in t) return true;
            if (typeof prop !== 'string') return false;
            return native.boxedMemberKind(handle, camelToSnake(prop)) !== 0;
        },
    });
}

// The GJS-shaped GObject.ParamSpec surface a `notify` handler's second arg and any
// GParamSpec-typed value surface as. Carries [HANDLE] so it round-trips back into the
// engine and `instanceof GObject.ParamSpec` recognises it. value_type/owner_type are
// native GType handles, like gjs's GType objects.
function wrapParamSpec(handle) {
    const prop = (which) => native.paramSpecProp(handle, which);
    const pspec = {
        [HANDLE]: handle,
        get name() {
            return prop('name');
        },
        get nick() {
            return prop('nick');
        },
        get blurb() {
            return prop('blurb');
        },
        get flags() {
            return prop('flags');
        },
        get value_type() {
            return prop('valueType');
        },
        get owner_type() {
            return prop('ownerType');
        },
        get default_value() {
            return wrapReturn(prop('defaultValue'));
        },
        get_name: () => prop('name'),
        get_nick: () => prop('nick'),
        get_blurb: () => prop('blurb'),
        get_default_value: () => wrapReturn(prop('defaultValue')),
    };
    return pspec;
}

// GLib.Variant ergonomics, mirroring GJS's GLib override. The three unpack depths the
// native unpacker implements:
//   unpack()          children stay Variants
//   deepUnpack()      one level; nested `v` values (an a{sv} value) STAY Variants
//   recursiveUnpack() fully plain JS, discarding the `v` type info

// Re-wrap what variantUnpack left in place: any GLib.Variant handle still in the result
// becomes a wrapper; arrays and plain dicts are walked.
function wrapVariantResult(value) {
    if (value === null || typeof value !== 'object') return value;
    if (native.isVariantHandle(value)) return wrapVariant(value);
    if (value instanceof Uint8Array) return value; // `ay` bytes
    if (Array.isArray(value)) return value.map(wrapVariantResult);
    const out = {};
    for (const key of Object.keys(value)) out[key] = wrapVariantResult(value[key]);
    return out;
}

// Carries [HANDLE] so the wrapper round-trips back into the engine as a GVariant IN
// argument (action.activate(variant), new_stateful state, change_state value, …).
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
            return (...args) => wrapReturn(native.callBoxedMethod(handle, camelToSnake(prop), unwrapArgs(args)));
        },
        has(t, prop) {
            return prop === HANDLE || (typeof prop === 'string' && Object.hasOwn(api, prop)) || prop in t;
        },
    });
}

// Deep-unwrap a pack value: the native `v` case reads a raw boxed handle, not an L1
// Proxy, so a nested GLib.Variant wrapper must collapse to its handle before packing.
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

function makeVariantClass() {
    const ctor = function Variant(signature, value) {
        return packVariant(signature, value);
    };
    Object.defineProperty(ctor, 'name', { value: 'Variant', configurable: true });
    ctor.$gtypeName = 'GLib.Variant';
    ctor.new = (signature, value) => packVariant(signature, value);
    // A wrapped Variant is a Proxy over a bare `{[HANDLE]}` target with no class
    // prototype, so the default `value instanceof GLib.Variant` is always false —
    // recognise any wrapper whose [HANDLE] is a native GVariant boxed handle instead.
    // Real GAction/GSettings/GLib.log_structured code branches on it.
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
            return (...args) => wrapReturn(native.callStaticMethod('GLib', 'Variant', giName, unwrapArgs(args)));
        },
        construct(_t, args) {
            return packVariant(args[0], args[1]);
        },
    });
}

const variantClass = makeVariantClass();

// GObject.Value ergonomics, mirroring GJS's GObject override: `new GObject.Value()` and
// the convenience `new GObject.Value(gtype, value)`. There is no g_value_new(), so
// construction goes through native.newGValue (a zeroed G_TYPE_VALUE boxed handle) and
// the .init/.set_*/.get_*/.copy/.reset/.unset surface routes through wrapBoxed's
// boxed-method dispatch.

// Fundamental GType name → GValue setter. Non-primitive types (enum/flags/boxed/object/
// param/variant) are matched by g_type_is_a below, like gjs's default switch branch.
const GVALUE_PRIMITIVE_SETTERS = {
    gboolean: 'set_boolean',
    gchar: 'set_schar',
    guchar: 'set_uchar',
    gint: 'set_int',
    guint: 'set_uint',
    glong: 'set_long',
    gulong: 'set_ulong',
    gint64: 'set_int64',
    guint64: 'set_uint64',
    gfloat: 'set_float',
    gdouble: 'set_double',
    gchararray: 'set_string',
    GType: 'set_gtype',
    GVariant: 'set_variant',
    GParam: 'set_param',
};

// Mirrors gjs's constructor switch: an exact fundamental → its setter, else g_type_is_a
// → flags/enum/boxed/…
function gvalueSetterFor(gt) {
    const G = requireGi('GObject', '2.0');
    const prim = GVALUE_PRIMITIVE_SETTERS[G.type_name(gt)];
    if (prim !== undefined) return prim;
    if (G.type_is_a(gt, G.TYPE_FLAGS)) return 'set_flags';
    if (G.type_is_a(gt, G.TYPE_ENUM)) return 'set_enum';
    if (G.type_is_a(gt, G.TYPE_VARIANT)) return 'set_variant';
    if (G.type_is_a(gt, G.TYPE_PARAM)) return 'set_param';
    if (G.type_is_a(gt, G.TYPE_BOXED)) return 'set_boxed';
    if (G.type_is_a(gt, G.TYPE_OBJECT)) return 'set_object';
    throw new TypeError(`Invalid type argument '${G.type_name(gt)}' to the GObject.Value constructor`);
}

function buildValue(args) {
    const v = wrapBoxed(native.newGValue());
    if (args.length >= 2) {
        const gt = resolveGTypeArg(args[0]);
        // Resolve the setter BEFORE init so an unsupported type throws a clean JS
        // TypeError instead of driving g_value_init with a value-table-less type — a
        // GLib-CRITICAL that aborts under G_DEBUG=fatal-criticals.
        const setter = gvalueSetterFor(gt);
        v.init(gt);
        v[setter](args[1]);
    }
    return v;
}

// `instanceof GObject.Value` recognises any wrapper over a GValue boxed handle (same
// prototype-less-Proxy reason as GLib.Variant above).
function makeValueClass() {
    const ctor = function Value(...args) {
        return buildValue(args);
    };
    Object.defineProperty(ctor, 'name', { value: 'Value', configurable: true });
    ctor.$gtypeName = 'GObject.Value';
    Object.defineProperty(ctor, Symbol.hasInstance, {
        value(instance) {
            if (instance === null || typeof instance !== 'object') return false;
            const handle = instance[HANDLE];
            return handle !== undefined && native.isBoxedHandle(handle) && native.boxedTypeName(handle) === 'GValue';
        },
        configurable: true,
    });
    return new Proxy(ctor, {
        get(t, prop) {
            if (typeof prop !== 'string' || prop in t || RESERVED.has(prop)) return t[prop];
            const giName = camelToSnake(prop);
            return (...args) => wrapReturn(native.callStaticMethod('GObject', 'Value', giName, unwrapArgs(args)));
        },
        construct(_t, args) {
            return buildValue(args);
        },
    });
}

const valueClass = makeValueClass();

// Overlay the GJS Variant ergonomics on the introspected GLib namespace, leaving
// every other member resolving from introspection. (Additive, like the GObject
// overlay; the introspected struct-based `GLib.Variant` is replaced by the
// ergonomic wrapper class so `new GLib.Variant(...)` + `.deepUnpack()` work.)
// The GLib names the L1 overlay adds/replaces on top of introspection.
// log_set_writer_func / log_set_writer_default mirror gjs's GLib.js overrides:
// gjs routes them through GjsPrivate (a C wrapper) because a GLogWriterFunc can
// fire on any thread and its GLogField array is not generically introspectable —
// node-gi's engine ships the same wrapper natively (logSetWriterFunc /
// logSetWriterDefault, src/private.cc). The JS writer receives
// (logLevel, fields) where fields is a plain object whose values are Uint8Arrays
// of the field bytes (or null for empty fields) — byte-for-byte the shape gjs's
// `{...stringFields.recursiveUnpack()}` produces (verified vs gjs 1.88).
const GLIB_OVERLAY_NAMES = new Set([
    'log_structured',
    'idle_add_once',
    'timeout_add_once',
    'timeout_add_seconds_once',
    'log_set_writer_func',
    'log_set_writer_default',
]);

// GLib.log_structured(domain, level, fields): pack `fields` into an `a{sv}` and hand
// it to the introspected GLib.log_variant — refs/gjs/modules/core/overrides/GLib.js
// log_structured. Each field value is `ay` (Uint8Array), `s` (string) or a Variant
// passed through; anything else is a TypeError, matching gjs.
function makeLogStructured(baseNs) {
    return (logDomain, logLevel, fields) => {
        const variantFields = {};
        for (const key of Object.keys(fields)) {
            const field = fields[key];
            if (field instanceof Uint8Array) variantFields[key] = variantClass('ay', field);
            else if (typeof field === 'string') variantFields[key] = variantClass('s', field);
            else if (field instanceof variantClass) variantFields[key] = field;
            else {
                throw new TypeError(
                    `Unsupported value ${field}, log_structured supports GLib.Variant, Uint8Array, and string values.`,
                );
            }
        }
        baseNs.log_variant(logDomain, logLevel, variantClass('a{sv}', variantFields));
    };
}

function decorateGLibNamespace(baseNs) {
    // Per-namespace cache of the overlay functions that need the introspected baseNs
    // (log_structured → log_variant; the *_once helpers → idle_add/timeout_add).
    const cache = new Map();
    const overlay = (prop) => {
        if (cache.has(prop)) return cache.get(prop);
        let value;
        if (prop === 'log_structured') value = makeLogStructured(baseNs);
        // The one-shot idle/timeout conveniences (gjs GLib.js): auto-remove the source
        // after the callback runs, so the callback needs no `return SOURCE_REMOVE`.
        else if (prop === 'idle_add_once') {
            value = (priority, callback) =>
                baseNs.idle_add(priority, () => {
                    callback();
                    return baseNs.SOURCE_REMOVE;
                });
        } else if (prop === 'timeout_add_once') {
            value = (priority, interval, callback) =>
                baseNs.timeout_add(priority, interval, () => {
                    callback();
                    return baseNs.SOURCE_REMOVE;
                });
        } else if (prop === 'timeout_add_seconds_once') {
            value = (priority, interval, callback) =>
                baseNs.timeout_add_seconds(priority, interval, () => {
                    callback();
                    return baseNs.SOURCE_REMOVE;
                });
        } else if (prop === 'log_set_writer_func') {
            // The gjs GLib.js shape: a non-function clears the JS writer (logs fall
            // back to the default writer); a function becomes the structured-log
            // writer. NOTE (GLib contract, identical under gjs): the underlying
            // g_log_set_writer_func may only ever be installed ONCE per process — a
            // second install aborts inside GLib itself.
            value = (writerFunc) => {
                if (typeof writerFunc !== 'function') native.logSetWriterFunc(null);
                else native.logSetWriterFunc(writerFunc);
            };
        } else if (prop === 'log_set_writer_default') {
            value = () => native.logSetWriterDefault();
        }
        cache.set(prop, value);
        return value;
    };
    return new Proxy(baseNs, {
        get(t, prop) {
            if (prop === 'Variant') return variantClass;
            // GLib.Error is the L1 GError subclass (the engine throws instances of it,
            // and `new GLib.Error(domain, code, message)` constructs one), shadowing the
            // introspected boxed type so `instanceof GLib.Error` + `.matches()` work.
            if (prop === 'Error') return GLibError;
            if (typeof prop === 'string' && GLIB_OVERLAY_NAMES.has(prop)) return overlay(prop);
            return t[prop];
        },
        has(t, prop) {
            return (
                prop === 'Variant' ||
                prop === 'Error' ||
                (typeof prop === 'string' && GLIB_OVERLAY_NAMES.has(prop)) ||
                prop in t
            );
        },
    });
}

// Overlay the GJS Gio runtime statics on the introspected Gio namespace —
// additively. `_promisify` is the genuinely-new helper (refs/gjs Gio.js); the
// DBus surface (Gio.DBus, Gio.DBusProxy.makeProxyWrapper, Gio.DBusExportedObject)
// is built by createGioDBus (overrides/gio-dbus.js) over the introspected Gio +
// the ergonomic GLib. Every other member keeps resolving from introspection.
function decorateGioNamespace(baseNs) {
    // Lazily construct the DBus surface: it needs the ergonomic GLib (`new
    // GLib.Variant`), and building it only on first `Gio.DBus*` access keeps a plain
    // `import Gio` (no DBus) from pulling GLib in.
    let dbus;
    const getDBus = () => {
        if (dbus === undefined) {
            dbus = createGioDBus({ Gio: baseNs, GLib: requireGi('GLib', '2.0'), unwrap: unwrapArg, native });
        }
        return dbus;
    };
    return new Proxy(baseNs, {
        get(t, prop) {
            if (prop === '_promisify') return promisify;
            if (prop === 'DBus') return getDBus().DBus;
            if (prop === 'DBusProxy') return getDBus().DBusProxy;
            if (prop === 'DBusExportedObject') return getDBus().DBusExportedObject;
            return t[prop];
        },
        has(t, prop) {
            return (
                prop === '_promisify' ||
                prop === 'DBus' ||
                prop === 'DBusProxy' ||
                prop === 'DBusExportedObject' ||
                prop in t
            );
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

// Whether `proto` is the SAME as, or a more-derived descendant of, `maybeAncestor`
// (i.e. `maybeAncestor` lies on `proto`'s prototype chain). Used to decide whether a
// later wrapInstance userProto should UPGRADE a cached one: on a multi-level chain a
// vfunc firing during construction wraps the instance with the OVERRIDING ancestor's
// prototype before the leaf ctor wraps it with the leaf's, so the leaf (descendant)
// proto must be allowed to supersede the ancestor's — but never the reverse.
function isProtoSameOrDescendantOf(proto, maybeAncestor) {
    for (let p = proto; p !== null; p = Object.getPrototypeOf(p)) {
        if (p === maybeAncestor) return true;
    }
    return false;
}

// L1 proxy-identity cache (the user-visible half of the toggle-ref bridge). The
// native engine now returns the CANONICAL External per GObject (same GObject ⇒
// same handle), so we cache the per-instance Proxy keyed by that handle: the same
// GObject always yields the same L1 wrapper, so `===` holds at the ergonomic
// layer and a plain JS field set on a wrapper survives a round-trip + GC (the
// External is kept alive by the toggle-up root while C owns the object, which in
// turn keeps this WeakMap entry — and the proxy + its fields — alive).
const instanceCache = new WeakMap();

// ---- signal-handler bookkeeping (JS function → connected handler ids) ----
//
// node-gi connects signals through PRIVATE GClosures (a JS callback wrapped in a C
// closure — see signals.cc), so the GObject cannot map a JS function back to its
// handler ids the way gjs's signal_handler_find can. gjs reaches this via its own
// per-instance private-closure registry (Gi.signals_{block,unblock,disconnect}_
// symbol, refs/gjs/modules/core/overrides/GObject.js); we keep the equivalent map
// here, populated at connect() time, so GObject.signal_handlers_{block,unblock,
// disconnect}_by_func can resolve a function to its ids. Keyed by the canonical
// native handle (a WeakMap, so it is collected with the object). Divergence
// (documented): disconnecting a handler by a route OTHER than the L1 `.disconnect(id)`
// / a by-func disconnect (e.g. the introspected GObject.signal_handler_disconnect)
// leaves a stale id here; a following block/unblock/disconnect-by-func would then act
// on a dead id (native.disconnectSignal already guards is_connected; block/unblock
// would g_warning). Normal connect→block/unblock/disconnect flows are exact.
const signalHandlerIds = new WeakMap(); // handle → Map<jsFunc, Set<handlerId>>

function recordSignalHandler(handle, fn, id) {
    let byFn = signalHandlerIds.get(handle);
    if (byFn === undefined) {
        byFn = new Map();
        signalHandlerIds.set(handle, byFn);
    }
    let ids = byFn.get(fn);
    if (ids === undefined) {
        ids = new Set();
        byFn.set(fn, ids);
    }
    ids.add(id);
}

// Drop a handler id from the per-instance registry (on disconnect), pruning an
// emptied function entry so a later by-func lookup reports zero matches.
function forgetSignalHandlerId(handle, id) {
    const byFn = signalHandlerIds.get(handle);
    if (byFn === undefined) return;
    for (const [fn, ids] of byFn) {
        if (ids.delete(id) && ids.size === 0) byFn.delete(fn);
    }
}

// The connected handler ids for a given JS function on an instance (a fresh array;
// empty when the function was never connected on this instance).
function handlerIdsForFunc(handle, fn) {
    const ids = signalHandlerIds.get(handle)?.get(fn);
    return ids === undefined ? [] : [...ids];
}

// ---- G3 mutate-in-place registry ----
//
// registerClass registers the GType for the GIVEN class and returns that SAME
// class (GJS-faithful — refs/gjs/modules/core/overrides/GObject.js mutates `klass`
// and returns it), so both `const X = registerClass(…,C)` and
// `static { registerClass(…,C) }` (return discarded) leave the same symbol bound
// to the registered GType. The construction that produces the registered GType is
// moved to the introspected base ctor (makeClass), keyed on `new.target`: when
// `new Sub(args)` runs and `Sub` is registered here, the base ctor builds the
// registered GType via constructType + wraps it, and RETURNS that wrapper. Because
// a base constructor that returns an object substitutes `this` in every derived
// ctor (ES `super` semantics), this single routing point makes the whole super()
// chain construct the right GType, return the canonical toggle-ref wrapper carrying
// the leaf's prototype, and run every user ctor body against it — exactly how GJS
// instantiates `new.target`'s `$gtype` rather than the literal base. Keyed by the
// JS class → { typeHandle, children?, internalChildren? } (children move here from
// the old throwaway Subclass so init_template'd children are surfaced on the
// instance). Multi-level registered-of-registered chains (G2) are supported: the
// registry is also consulted by findParentGType to resolve a REGISTERED parent's
// GType handle (subclassing via native.registerClassFromGType), and the new.target
// routing keys on the leaf so construction is correct at any depth.
const registeredClasses = new Map();

// GTypeName → registered JS class, the reverse of registeredClasses. The engine's
// NodeGiConstructor hands runCtorForCObject (below) the C-created instance's GType
// NAME (g_type_name), which this resolves back to the class to Reflect.construct.
const classesByGType = new Map();

// When set (by runCtorForCObject), the makeClass base ctor ADOPTS this pre-existing
// canonical handle instead of constructing a second GObject — so a C/GtkBuilder-
// created instance's user ctor body runs on the wrapper the engine already built.
// A module-scoped latch is safe: it is set immediately before a synchronous
// Reflect.construct and consumed by the base ctor before any nested construction.
let adoptHandle;

// Surface a templated type's bound children on a freshly-constructed instance
// (GJS convention: public `this.<name>`, internal `this._<name>`, '-' → '_'). The
// engine already ran init_template during constructType, so getTemplateChild
// resolves each. Assigned through the proxy (set trap → stored as an instance
// expando), exactly as the old Subclass did.
function assignTemplateChildren(instance, handle, reg) {
    if (reg.children !== undefined) {
        for (const childName of reg.children) {
            instance[childName.replace(/-/g, '_')] = wrapReturn(native.getTemplateChild(handle, childName));
        }
    }
    if (reg.internalChildren !== undefined) {
        for (const childName of reg.internalChildren) {
            instance[`_${childName.replace(/-/g, '_')}`] = wrapReturn(native.getTemplateChild(handle, childName));
        }
    }
}

// Push construct-time GObject-property values through the class's own JS SETTERS.
//
// A class can declare a GObject property (`Properties: { displayWidth: ParamSpec }`,
// often CONSTRUCT with a default) AND a matching JS accessor
// (`get/set displayWidth` over a `_displayWidth` backing field). On GJS the property
// set vfunc delegates to the JS setter (`JS_SetProperty`), so the CONSTRUCT default
// reaches `_displayWidth` at construction. node-gi builds the wrapper AFTER
// g_object_new, so at construct time there is no USER_PROTO to route through — the
// value lands only in the engine's per-instance store, and the class's getter
// (reading `_displayWidth`) sees `undefined` (the Learn6502 Display "DrawingArea is
// required" wall). Once USER_PROTO is attached (here, right after construction), read
// each such property's construct value back out (from the store, or the ParamSpec
// default) and run it through the JS setter — the node-gi analogue of GJS applying a
// CONSTRUCT property via the JS setter, and BEFORE the user ctor body runs (same
// order as GJS). Only properties whose name resolves to a prototype SETTER are
// touched, so a plain GObject property (no JS accessor) keeps the store as its single
// backing store — unchanged.
function flushConstructProperties(instance, handle, reg) {
    if (reg.constructPropertyNames === undefined) return;
    const up = instance[USER_PROTO];
    if (up === undefined) return;
    for (const name of reg.constructPropertyNames) {
        const desc = findProtoDescriptor(up, name);
        if (desc === undefined || typeof desc.set !== 'function') continue;
        desc.set.call(instance, wrapReturn(native.getProperty(handle, name)));
    }
}

// ---- Gio.Application.runAsync (L1, GJS-shaped) ----
//
// The Node twin of GJS's `Gio.Application.prototype.runAsync`
// (refs/gjs/modules/core/overrides/Gio.js → `GLib.MainLoop.prototype.runAsync`
// in GLib.js). GJS returns a Promise and defers the blocking run() via
// `setMainLoopHook`, so the program's already-queued microtasks/promises settle
// before the GLib loop takes over the thread, then resolves with run()'s integer
// exit status when the app quits/exits.
//
// On Node there is no main-loop hook — libuv is always the process loop and the
// libuv↔GLib bridge (addon.cc UvLoopSource, attached to the DEFAULT GMainContext
// that g_application_run iterates) co-pumps libuv during a blocking run(). The
// faithful analogue is therefore to defer the blocking run() to a MACROTASK
// (setImmediate). This:
//   • returns the Promise immediately — runAsync does NOT block the caller the
//     way a bare `app.run()` would,
//   • lets the caller's already-queued microtasks/promises drain first, and
//   • runs run() OUTSIDE the caller's async/await scope, so the node-gtk
//     #442/#121 nested-microtask-checkpoint caveat (see mainloop.test.mjs) does
//     NOT bite: promise continuations queued before runAsync drain normally WHILE
//     the app runs, because the bridge's microtask checkpoint is no longer
//     deferred to an outer await frame.
//
// Mirrors GJS exactly in that the `argv` argument is ignored (GJS's runAsync
// takes no parameters and calls `this.run()` with an empty command-line) — so an
// `app.runAsync([programInvocationName, ...ARGV])` source behaves identically on
// gjs and node. Resolves once; run() is invoked once (no double-run / leak).
//
// Same shape on all three runtimes: the deferred blocking run() drives the app's
// GLib loop (activate → the app's own GLib sources → quit → run returns the exit
// status). The Node-only EXTRA is the uv↔GLib bridge co-pumping Node's own event
// loop DURING the blocking run, so a Node timer/promise scheduled before runAsync
// fires while the app runs. Bun/Deno have no such bridge, so their own event loop
// is paused for the app's lifetime (exactly as GJS, where the GLib loop IS the
// process loop) — for concurrent runtime-loop + GLib work there, drive GLib with
// startMainContextPump instead of a blocking run.
function applicationRunAsync(handle) {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            try {
                resolve(wrapReturn(native.callMethod(handle, 'run', unwrapArgs([[]]))));
            } catch (error) {
                reject(error);
            }
        });
    });
}

// ---- portable GLib main-context pump (Bun/Deno) ----
//
// On Node the uv-in-GLib bridge co-pumps libuv during a blocking GLib loop, so a
// GLib loop keeps Node's timers/promises/IO alive. Bun/Deno have no usable libuv,
// so we co-pump the OTHER way: a repeating runtime timer iterates the default GLib
// main context non-blockingly, letting GIO async callbacks / GLib timeouts / DBus
// fire while the runtime's own event loop stays in control — GJS's non-blocking
// main loop, reached from the runtime side. Reference-counted so nested pumps /
// concurrent runAsync calls share one timer.
let pumpTimer = null;
let pumpRefCount = 0;
// How many of those refs belong to the AUTO-armed pump (requireGi's permanent
// hold on Bun/Deno). `pumpRefCount > pumpAutoRefs` therefore means an EXPLICIT
// `startMainContextPump()` caller currently holds the pump.
let pumpAutoRefs = 0;
// Whether the pump timer currently HOLDS the runtime's event loop open (ref'd).
let pumpHoldsRuntime = false;

/** Dispatch every currently-ready GLib source, then return. */
function drainReadySources() {
    let guard = 0;
    while (native.iterateMainContext(false) && guard++ < 100000) {
        /* drain ready sources */
    }
}

// Zero-N-API view over the JS-armed-work counter — `pendingView[0] > 0` is
// `mainContextHasPending()` as a plain V8 memory read. The IDLE beat must not
// enter the addon at all: on Deno, a single napi call from the pump tick during
// the between-test-files GC window reproduces the #47 boxed-handle teardown
// SIGSEGV (measured on the gtk-smoke leg: a query-only tick crashed 3/3, a tick
// that never touches the addon exited 0, the full dispatching tick crashed
// 10/10). So every read on the beat's idle path goes through this view.
// Created LAZILY on the first pump arm (Bun/Deno only): the @gjsify/napi shim
// loud-stubs external arraybuffers, and the gjs host never arms the pump.
let pendingView = null;

/**
 * One pump beat: dispatch if the program owns GLib work, then re-evaluate the
 * keep-alive hold. Both the gate and the hold read the SAME counter, so the
 * auto-armed pump dispatches exactly when it also holds the loop open.
 *
 * DISPATCH is gated like the hold — on the program's OWN GLib work. An EXPLICIT
 * `startMainContextPump()` holder gets unconditional dispatch (its documented
 * contract: co-pump the context, whatever is in it). The AUTO-armed pump
 * dispatches only while a JS-armed GI callback is outstanding (scope=async
 * completions + scope=notified sources), so a FINISHED program stops touching
 * the addon entirely instead of grinding through GDK/GIO's C-armed housekeeping
 * sources forever.
 *
 * That silence is load-bearing on Deno: the documented #47 N-API teardown race
 * is armed by the pump ENTERING the addon between test files (see pendingView
 * above), while stopping/unref'ing the pump at teardown does NOT avoid it.
 * Nothing is lost for a RUNNING program: any JS-observable progress path is
 * counted (a Gio completion is scope=async, a `GLib.timeout_add` is
 * scope=notified), and while one is outstanding the beat drains ALL ready
 * sources, C-armed ones included.
 */
function pumpBeat() {
    if (pumpRefCount > pumpAutoRefs || pendingView[0] > 0) {
        drainReadySources();
    }
    syncPumpKeepAlive();
}

/**
 * Keep-alive accounting — the portable twin of the uv auto-pump's ref/unref
 * policy (`src/loop.cc`): scheduled GLib work (an armed timeout/idle) or an
 * in-flight scope=async GI callback holds the runtime's event loop open;
 * anything else lets it drain.
 *
 * Both halves are load-bearing. Permanently UNREF'd (the pre-fix behaviour) a
 * program whose only pending work lives in GLib dies mid-flight — a bare
 * `await` on a GLib timeout never settles and the runtime exits 0 with the
 * program half-run. Permanently REF'd, a sync-only program would never exit.
 *
 * Consequence, identical to Node's auto-pump: a REPEATING GLib timeout has
 * `setInterval` semantics and keeps the process alive, where `gjs -m` exits once
 * the module settles. That is the one deliberate lifetime divergence from gjs,
 * and it is now the SAME on node, bun and deno rather than node-only.
 */
function syncPumpKeepAlive() {
    if (pumpTimer === null) return;
    const hold = pendingView[0] > 0; // zero-N-API — see pendingView above
    if (hold === pumpHoldsRuntime) return;
    if (hold) pumpTimer.ref?.();
    else pumpTimer.unref?.();
    pumpHoldsRuntime = hold;
}

/**
 * Start co-pumping the default GLib main context from a runtime timer (Bun/Deno).
 * No-op on Node, where the libuv↔GLib bridge already co-pumps. Reference-counted;
 * returns a disposer that decrements the count (clearing the timer at zero).
 *
 * `requireGi` arms this automatically on Bun/Deno (the Node twin of
 * `native.startMainLoop()`), so a plain `bun bundle.mjs` / `deno run bundle.mjs`
 * dispatches GLib sources with no explicit loop — calling it by hand is only
 * needed to hold the pump across a scope that must not depend on that.
 * @returns {() => void}
 */
export function startMainContextPump() {
    // Node: the libuv↔GLib bridge already co-pumps. GJS: the host loop IS
    // GLib's default main context — a JS-timer pump would only iterate the
    // context recursively from within its own dispatch.
    if (native.isNodeRuntime || native.RUNTIME === 'gjs') return () => {};
    pumpRefCount++;
    if (pumpTimer === null) {
        if (pendingView === null) pendingView = native.makePumpPendingCount();
        // ~4 ms cadence: low latency without busy-spinning. Each beat drains every
        // currently-ready source (iterateMainContext(false) returns false when none
        // remain, bounding the inner loop) — gated on the program's own GLib work
        // for the auto-armed pump, see pumpBeat — then re-evaluates the hold.
        pumpTimer = setInterval(pumpBeat, 4);
        // Start UNREF'd: the pump alone must never keep a finished program alive.
        // syncPumpKeepAlive() refs it for exactly as long as GLib has work.
        pumpTimer.unref?.();
        pumpHoldsRuntime = false;
        syncPumpKeepAlive();
    }
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        stopMainContextPump();
    };
}

/** Decrement the main-context pump reference count; clears the timer at zero. */
export function stopMainContextPump() {
    if (native.isNodeRuntime || native.RUNTIME === 'gjs' || pumpRefCount === 0) return;
    pumpRefCount--;
    if (pumpRefCount === 0 && pumpTimer !== null) {
        clearInterval(pumpTimer);
        pumpTimer = null;
        pumpHoldsRuntime = false;
    }
}

// bind_property_full / BindingGroup.bind_full: the transform functions are driven
// by the native GjsPrivate-mirror (src/private.cc) — the same architecture gjs
// uses (GjsPrivate.g_object_bind_property_full / g_binding_group_bind_full),
// because the transform's `to_value` is a write-back GValue no marshaled GClosure
// can reach. The JS contract matches gjs byte-for-byte (verified vs gjs 1.88):
//   (binding, sourceValue) => [ok: boolean, targetValue]
// — sourceValue arrives unpacked, [false, …] leaves the target unchanged, a
// non-Array return is reported and treated as no-transform. This wrapper wraps
// the incoming binding/source into chainable L1 values and unwraps the returned
// target value back to a native handle (object/variant-valued properties).
function wrapBindingTransform(fn) {
    if (typeof fn !== 'function') return null;
    return (binding, value) => {
        const result = fn(wrapReturn(binding), wrapReturn(value));
        if (!Array.isArray(result)) return result; // native reports + treats as FALSE
        return [result[0], unwrap(result[1])];
    };
}

// gjs's GObject.Object.prototype signal-convenience methods + bind_property_full
// (and BindingGroup.bind_full), resolved by JS-accessor name (snake_case or
// camelCase). Returns a `(handle, args) => result` applier, or undefined for a
// name we do not shim. block/unblock route through the introspected
// single-handler g_signal_handler_* functions (verified to marshal a node-gi
// GObject IN-arg); stop_emission_by_name through g_signal_stop_emission_by_name.
function objectPrototypeShim(prop) {
    switch (prop) {
        case 'block_signal_handler':
        case 'blockSignalHandler':
            return (handle, args) =>
                wrapReturn(native.callFunction('GObject', 'signal_handler_block', [handle, args[0]]));
        case 'unblock_signal_handler':
        case 'unblockSignalHandler':
            return (handle, args) =>
                wrapReturn(native.callFunction('GObject', 'signal_handler_unblock', [handle, args[0]]));
        case 'stop_emission_by_name':
        case 'stopEmissionByName':
            return (handle, args) =>
                wrapReturn(native.callFunction('GObject', 'signal_stop_emission_by_name', [handle, args[0]]));
        case 'bind_property_full':
        case 'bindPropertyFull':
            return (handle, args) =>
                wrapReturn(
                    native.bindPropertyFull(
                        handle,
                        args[0],
                        unwrap(args[1]),
                        args[2],
                        args[3],
                        wrapBindingTransform(args[4]),
                        wrapBindingTransform(args[5]),
                    ),
                );
        case 'bind_full':
        case 'bindFull':
            // GObject.BindingGroup.bind_full (gjs: GjsPrivate.g_binding_group_bind_full).
            // Gated per instance: on any OTHER class a genuine `bind_full` method keeps
            // resolving through the normal GI route. NOTE: without this shim the
            // introspected name would resolve to bind_with_closures (its GIR shadow),
            // whose write-back GValue contract a marshaled GClosure cannot satisfy.
            return (handle, args) => {
                if (!native.isInstanceOf(handle, 'GObject', 'BindingGroup')) {
                    return wrapReturn(native.callMethod(handle, 'bind_full', unwrapArgs(args)));
                }
                return wrapReturn(
                    native.bindingGroupBindFull(
                        handle,
                        args[0],
                        unwrap(args[1]),
                        args[2],
                        args[3],
                        wrapBindingTransform(args[4]),
                        wrapBindingTransform(args[5]),
                    ),
                );
            };
        default:
            return undefined;
    }
}

// Per-GType method feature-detection cache backing the wrapper's GJS-parity
// `get` trap: `native.hasMethod` walks the full introspection chain and method
// GETs happen on every `obj.method(...)` call, so presence is memoized per
// concrete GType name (stable for the process lifetime — typelibs don't gain
// methods at runtime).
const methodPresenceCache = new Map(); // typeName -> Map<methodName, boolean>

function instanceHasMethod(handle, name) {
    const typeName = native.getTypeName(handle);
    let perType = methodPresenceCache.get(typeName);
    if (perType === undefined) {
        perType = new Map();
        methodPresenceCache.set(typeName, perType);
    }
    let present = perType.get(name);
    if (present === undefined) {
        present = native.hasMethod(handle, name);
        perType.set(name, present);
    }
    return present;
}

// The JS prototype a wrapper resolves its members through, by runtime GType name.
// Stable for the process — a GType neither gains ancestors nor changes class.
const protoByGTypeName = new Map();

// EVERY wrapper gets a prototype, as in GJS where an instance's [[Prototype]] IS
// its class's prototype: without one, a member assigned to `Ns.Class.prototype` was
// accepted and observable there yet invisible to the instance, which kept reaching
// the native method underneath (#1175) — a spy that reports itself installed and
// then measures nothing. A registerClass subclass's own prototype when the GType is
// one we registered, else the introspected class's.
function protoForInstance(handle) {
    const gtypeName = native.getTypeName(handle);
    if (gtypeName === null) return undefined;
    const cached = protoByGTypeName.get(gtypeName);
    if (cached !== undefined) return cached === null ? undefined : cached;
    const registered = classesByGType.get(gtypeName);
    let proto = registered !== undefined ? registered.prototype : null;
    if (proto === null) {
        // Only LOADED namespaces are searched, and a namespace object is reached
        // through the same per-namespace cache `requireGi` fills, so the prototype
        // resolved here is the very object a program can patch.
        const info = native.classInfoForTypeName(gtypeName);
        const cls = info === null ? undefined : namespaceObject(info.namespace)[info.name];
        if (cls !== undefined && cls !== null) proto = cls.prototype ?? null;
    }
    protoByGTypeName.set(gtypeName, proto);
    return proto === null ? undefined : proto;
}

// Attach a class prototype to a wrapper — as its [[Prototype]] AND as the USER_PROTO
// symbol the traps resolve members through.
//
// The symbol alone is not the link. `constructor` is RESERVED, so the get trap hands
// it straight to the bare target, whose [[Prototype]] was Object.prototype: every
// introspected instance answered `Object` — carrying no `$gtype`, so
// `GObject.type_name(inst.constructor.$gtype)` was `null` and @gjsify/gtk-host's
// adopt() / nearestRegistered() / every descriptor lookup failed with
// "No descriptor registered for null" (99 rows of its node leg). On gjs an instance's
// [[Prototype]] IS its class's prototype and `constructor` is the class object itself
// (measured on gjs 1.88.1), which is what the class prototype's own `constructor`
// back-link — the makeClass Proxy, the object `requireGi` returns — now supplies.
// It is also what puts a class prototype on the chain findProtoDescriptor walks for
// `vfunc_*` (see makeClassPrototype). Works on the wrapper Proxy too: neither
// setPrototypeOf nor the symbol write is trapped, so both reach the target.
function linkInstanceProto(objOrProxy, proto) {
    objOrProxy[USER_PROTO] = proto;
    Object.setPrototypeOf(objOrProxy, proto);
}

// Wrap a live GObject handle as a GJS-shaped instance. The wrapper resolves its
// class prototype chain FIRST (a registerClass subclass's own methods, anything
// the program put on the introspected prototype) — so `inst.myMethod()` runs the
// JS method with the wrapper as `this` — then falls back to GObject property
// get/set and GI method routing. `userProto` overrides the prototype derived from
// the handle's GType, for the construction paths that already know the leaf class.
// `.connect()/.emit()/.disconnect()` work in both modes.
function wrapInstance(handle, userProto) {
    const cached = instanceCache.get(handle);
    if (cached !== undefined) {
        // UPGRADE a cached wrapper's user prototype when this wrap supplies a MORE
        // DERIVED one: an undefined cache (a subclass instance first seen generically —
        // returned from store.get_item / a signal sender / resurrection), OR a cached
        // ANCESTOR prototype (a multi-level chain where a vfunc fired during constructType
        // wrapped the instance with the OVERRIDING ancestor's prototype, before the leaf
        // ctor's wrapInstance(handle, leaf.prototype) runs — the leaf proto must win so
        // the leaf's OWN methods resolve). Never DOWNGRADE: a more-derived cached proto is
        // kept. The userProto lives on the target (read via the proxy here), so the
        // upgrade is in place — identity (===) and any expando fields are preserved.
        if (userProto !== undefined && userProto !== cached[USER_PROTO]) {
            const current = cached[USER_PROTO];
            if (current === undefined || isProtoSameOrDescendantOf(userProto, current)) {
                linkInstanceProto(cached, userProto);
            }
        }
        return cached;
    }
    const target = { [HANDLE]: handle };
    const proto = userProto ?? protoForInstance(handle);
    if (proto !== undefined) linkInstanceProto(target, proto);
    const proxy = new Proxy(target, {
        get(t, prop) {
            if (prop === HANDLE) return handle;
            if (typeof prop !== 'string' || RESERVED.has(prop)) return t[prop];
            switch (prop) {
                case '$typeName':
                    // The instance's concrete RUNTIME GType name —
                    // g_type_name(G_OBJECT_TYPE(obj)) via native.getTypeName. node-gi hands
                    // back a GENERIC wrapper for a returned handle (it does not downcast to
                    // the runtime GType), so `constructor.$gtype` is the STATIC declared
                    // type; this getter reads the TRUE runtime type. It is the portable seam
                    // @gjsify/devtools' widget-tree DumpTree uses (GJS instead reads the
                    // concrete type off its already-downcast `constructor.$gtype.name`).
                    // Distinct from the CLASS-level `$gtypeName`, which is the DECLARED
                    // namespaced string (e.g. 'Gtk.Widget'); this is the raw runtime GType
                    // name (e.g. 'GtkWidget', 'AdwBin', 'FireworksWindow').
                    return native.getTypeName(handle);
                case 'connect':
                    // Record the (user fn → id) mapping so signal_handlers_*_by_func can
                    // resolve the private-closure handler back to its ids (see the registry).
                    return (signal, cb) => {
                        const id = native.connectSignal(handle, signal, wrapSignalCallback(cb), false);
                        recordSignalHandler(handle, cb, id);
                        return id;
                    };
                case 'connect_after':
                    return (signal, cb) => {
                        const id = native.connectSignal(handle, signal, wrapSignalCallback(cb), true);
                        recordSignalHandler(handle, cb, id);
                        return id;
                    };
                case 'emit':
                    return (signal, ...args) => wrapReturn(native.emitSignal(handle, signal, unwrapArgs(args)));
                case 'disconnect':
                    return (id) => {
                        forgetSignalHandlerId(handle, id);
                        return native.disconnectSignal(handle, id);
                    };
                default:
                    break;
            }
            // A plain JS field previously written on THIS wrapper. With the toggle-ref
            // bridge the wrapper is CANONICAL (one proxy per GObject, cached by the
            // canonical native handle), so a plain field IS shared across the
            // vfunc<->instance boundary and survives a round-trip + GC while C owns the
            // object. Read FIRST, before the class prototype — ordinary JS lookup order.
            // (GObject PROPERTIES remain the right choice for state C must also see; the
            // `set` trap routes those to GObject, so no expando competes with one.)
            if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
            const up = t[USER_PROTO];
            if (up !== undefined) {
                const desc = findProtoDescriptor(up, prop);
                if (desc !== undefined) {
                    if (typeof desc.get === 'function') return desc.get.call(proxy);
                    // The prototype's OWN function, never a re-bound thunk: `this` comes
                    // from the call site anyway, and re-binding breaks the identity a
                    // spy is recognised by — `inst.m === Cls.prototype.m` (#1175).
                    return desc.value;
                }
            }
            // Gio.Application.runAsync — the GJS override (refs/gjs Gio.js + GLib.js):
            // a Promise-returning run() that does NOT block the Node microtask/event
            // loop (see applicationRunAsync). Gated to GApplication instances
            // (g_type_is_a, so Gtk/Adw.Application and registerClass subclasses qualify);
            // placed AFTER the userProto lookup so a subclass may still override it, and
            // before the GI-method fallback since there is no introspected `run_async`.
            if (prop === 'runAsync' && native.isInstanceOf(handle, 'Gio', 'Application')) {
                return () => applicationRunAsync(handle);
            }
            // gjs's GObject.Object.prototype signal conveniences (block_signal_handler /
            // unblock_signal_handler / stop_emission_by_name) + bind_property_full and
            // BindingGroup.bind_full (refs/gjs GObject.js). These are NOT introspected instance
            // methods — they are gjs shims over the namespace-level g_signal_* functions —
            // so route them explicitly before property / GI-method resolution.
            const shim = objectPrototypeShim(prop);
            if (shim !== undefined) return (...args) => shim(handle, args);
            const propName = toKebab(prop);
            if (native.hasProperty(handle, propName)) {
                return wrapReturn(native.getProperty(handle, propName));
            }
            // LAST resort before treating an unknown name as a GI method: an INHERITED
            // member (Object.prototype.hasOwnProperty / isPrototypeOf / … — RESERVED
            // already covers toString/valueOf/etc.) must resolve to the real function,
            // not a GI callMethod thunk that would throw on `inst.hasOwnProperty('x')`.
            if (prop in t) return t[prop];
            // A Gio._promisify'd async method. The prototype lookup above already finds
            // it whenever the promisified prototype is on the instance's chain; the
            // registry covers what a chain cannot reach — a private concrete type
            // (GLocalFile) resolves to its nearest INTROSPECTABLE ancestor, so an
            // instance of it never sees `Gio.File.prototype`. Bound to this instance.
            const promisified = resolvePromisified(handle, camelToSnake(prop));
            if (promisified !== undefined) return (...args) => promisified.apply(proxy, args);
            // GJS parity: an UNKNOWN member is `undefined`, never a throw-on-call
            // thunk — real consumers feature-detect optional native methods
            // (`typeof gl.clearBufferfv === 'function'` gates `@gjsify/webgl`'s
            // clearBuffer emulation; Excalibur's RenderTarget.blitToScreen was the
            // exposing call on node-gi: the old unconditional thunk made the
            // detection lie, then threw mid-frame). Presence is resolved via the
            // SAME native walk callMethod uses (literal-first, snake alias second)
            // and memoized per concrete GType — method GETs happen on every call.
            // The LITERAL accessor name is passed through — the engine resolves it
            // verbatim first (GJS fidelity: GIR names are exposed as-is, incl. Vala
            // camelCase like Gwebgl's `getString`) and only falls back to the
            // snake_case alias. Converting here would destroy a literal camelCase
            // GI name.
            if (instanceHasMethod(handle, prop)) {
                return (...args) => wrapReturn(native.callMethod(handle, prop, unwrapArgs(args)));
            }
            return undefined;
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

// Surface a lazy `$gtype` getter on an introspected class/struct ctor: the real
// GObject GType (a node-gi GType handle), resolved on first read via the engine
// and then cached as a value. GJS exposes `SomeClass.$gtype`; the storybook reads
// `Adw.Clamp.$gtype` + passes `StoryWidget.$gtype` to GObject.type_ensure. Lazy
// (defineProperty getter) so it costs nothing until accessed. `null` (unknown type)
// is also cached. The makeClass/makeStruct Proxy forwards `'$gtype' in t` → the
// target getter (it returns `t[prop]` when `prop in t`).
function defineLazyGType(ctor, namespace, typeName) {
    Object.defineProperty(ctor, '$gtype', {
        configurable: true,
        enumerable: false,
        get() {
            const gt = native.getGType(namespace, typeName);
            Object.defineProperty(ctor, '$gtype', {
                value: gt,
                configurable: true,
                enumerable: false,
                writable: false,
            });
            return gt;
        },
    });
}

// The GObject behind a prototype method's `this`. A prototype function is
// reachable without an instance (`Cls.prototype.m()`, a detached reference), so
// the engine must never be handed `undefined` for the instance argument.
function prototypeMethodHandle(self, where) {
    const handle = self === null || self === undefined ? undefined : self[HANDLE];
    if (handle === undefined) throw new TypeError(`${where}: \`this\` is not a node-gi instance`);
    return handle;
}

// The invocable form of an introspected instance method, as it sits on a class
// prototype: `this` supplies the GObject, so ONE function serves every instance of
// the class and `inst.m === Cls.prototype.m` holds (gjs parity).
//
// `arity` becomes the function's `length`, as on gjs (m_js_in_argc — the
// JS-visible IN args, not the C arg count). A rest-args thunk reports 0, and
// @gjsify/gtk-host's descriptor conformance reads `.length` to hold the widget
// table against the installed GTK — `add_titled() takes 3 argument(s), but
// GtkStack's takes 0` was this thunk, not the typelib.
function makeGiMethod(where, method, arity) {
    const fn = function (...args) {
        return wrapReturn(native.callMethod(prototypeMethodHandle(this, where), method, unwrapArgs(args)));
    };
    Object.defineProperty(fn, 'name', { value: method, configurable: true });
    Object.defineProperty(fn, 'length', { value: arity, configurable: true });
    return fn;
}

// The invocable form of an introspected VFUNC as it sits on a class prototype. Like
// makeGiMethod, but the engine resolves the vtable slot of THIS class (not a captured
// parent pointer), so it works on a plain `new Ns.Class()` — which is what gjs does
// and what `vfunc_add_child` (a GtkBuildable slot with no introspected method form)
// has no other route to.
function makeGiVFunc(namespace, typeName, vfuncName, where) {
    const fn = function (...args) {
        return wrapReturn(
            native.callClassVfunc(prototypeMethodHandle(this, where), namespace, typeName, vfuncName, unwrapArgs(args)),
        );
    };
    Object.defineProperty(fn, 'name', { value: `vfunc_${vfuncName}`, configurable: true });
    return fn;
}

// A class prototype that MATERIALIZES its introspected methods on first look-up —
// the JS twin of the SpiderMonkey `resolve` hook gjs installs on every GObject
// prototype (refs/gjs gi/object.cpp). Without it a node-gi prototype stayed
// permanently empty, so `Cls.prototype.method` read `undefined` and wrapping a
// method had nothing to wrap (#1175). Lazy, not eager: a class like Gtk.Widget
// carries hundreds of inherited methods and a program touches a handful.
function makeClassPrototype(namespace, typeName) {
    const target = {};
    // Put the vfunc chain-up Proxy beneath the prototype so a registerClass
    // subclass's `super.vfunc_<name>(...)` resolves (see vfuncChainProto).
    Object.setPrototypeOf(target, vfuncChainProto);
    // Stamp the prototype with its class identity so Gio._promisify(Cls.prototype, …)
    // can record which class a registration belongs to (non-enumerable).
    Object.defineProperty(target, CLASS_INFO, {
        value: { namespace, typeName },
        enumerable: false,
        configurable: true,
    });
    const where = `${namespace}.${typeName}.prototype`;
    const resolved = new Map(); // accessor name -> method arity (-1 = absent) or vfunc addressability
    // Writable + configurable: a program REPLACES a method to instrument it and puts
    // the original back afterwards, which is the whole point of the prototype.
    // Enumerable, like the methods gjs's resolve hook defines.
    const define = (prop, value) => {
        Object.defineProperty(target, prop, { value, writable: true, enumerable: true, configurable: true });
        return true;
    };
    // Defines the member on the target and reports whether the name resolved, so the
    // traps answer from the target itself and stay within the Proxy invariants (a
    // reported own property must really exist on an extensible target).
    const materialize = (prop) => {
        if (typeof prop !== 'string' || RESERVED.has(prop)) return false;
        if (Object.prototype.hasOwnProperty.call(target, prop)) return true;
        // A vfunc slot. Defining it HERE — rather than leaving it to the vfuncChainProto
        // Proxy below the prototype — is what makes it reachable from an INSTANCE: the
        // wrapper resolves members by descriptor (findProtoDescriptor), and a Proxy that
        // traps only `get` reports no descriptor and no `in`, so `new Gtk.Box()
        // .vfunc_add_child` was `undefined` while `Gtk.Box.prototype.vfunc_add_child` was
        // a function. Gated on the engine being able to ADDRESS the slot, which gives gjs
        // parity two ways: an unknown vfunc name stays `undefined` instead of becoming a
        // throw-on-call thunk, and a name the engine cannot address (GObject's own vfuncs
        // report GI_UNKNOWN as their struct offset) still falls through to the chain-up
        // thunk, so `super.vfunc_dispose()` keeps working.
        if (prop.startsWith('vfunc_')) {
            const vfuncName = prop.slice('vfunc_'.length);
            let addressable = resolved.get(prop);
            if (addressable === undefined) {
                addressable = native.hasClassVfunc(namespace, typeName, vfuncName);
                resolved.set(prop, addressable);
            }
            return addressable && define(prop, makeGiVFunc(namespace, typeName, vfuncName, `${where}.${prop}`));
        }
        // gjs's GObject.Object.prototype members are JS shims over namespace-level
        // functions (see objectPrototypeShim), and `bind_property_full` even HAS an
        // introspected GIR shadow — bind_with_closures, whose GValue write-back a
        // marshaled GClosure cannot satisfy — so the shim must win here too.
        const shim = objectPrototypeShim(prop);
        if (shim !== undefined) {
            return define(prop, function (...args) {
                return shim(prototypeMethodHandle(this, `${where}.${prop}`), args);
            });
        }
        // ONE native call answers both presence (arity >= 0) and the function's
        // `length` — see classMethodArity in calls.cc.
        let arity = resolved.get(prop);
        if (arity === undefined) {
            arity = native.classMethodArity(namespace, typeName, prop);
            resolved.set(prop, arity);
        }
        return arity >= 0 && define(prop, makeGiMethod(where, prop, arity));
    };
    return new Proxy(target, {
        get(t, prop, receiver) {
            materialize(prop);
            return Reflect.get(t, prop, receiver);
        },
        getOwnPropertyDescriptor(t, prop) {
            materialize(prop);
            return Reflect.getOwnPropertyDescriptor(t, prop);
        },
        has(t, prop) {
            return materialize(prop) || Reflect.has(t, prop);
        },
    });
}

function makeClass(namespace, typeName) {
    const ctor = function ctor(props) {
        // G3/G2 construction routing. `new.target` is the leaf class the `new` was
        // applied to and is preserved through every super() hop, so when a registerClass'd
        // subclass is being constructed (directly or up a super() chain — at ANY depth,
        // since the leaf's registered GType already IS the full multi-level type) we build
        // the REGISTERED GType and return its canonical toggle-ref wrapper (carrying the
        // leaf's prototype as USER_PROTO) — which then substitutes `this` in every derived
        // ctor body. `new.target === undefined` (a call without `new`) or `=== proxy` (a
        // direct `new Ns.Class(...)` on the introspected class itself) falls through to the
        // unchanged introspected construction.
        const nt = new.target;
        if (nt !== undefined && nt !== proxy) {
            const reg = registeredClasses.get(nt);
            if (reg !== undefined) {
                let handle;
                if (adoptHandle !== undefined) {
                    // C-created adoption (runCtorForCObject): the engine already built the
                    // GObject; use its canonical handle instead of constructing another.
                    // Consume the latch atomically so a nested `new` in the ctor body takes
                    // the normal constructType path.
                    handle = adoptHandle;
                    adoptHandle = undefined;
                } else {
                    handle = native.constructType(reg.typeHandle, props ? unwrapProps(props) : {});
                }
                const instance = wrapInstance(handle, nt.prototype);
                assignTemplateChildren(instance, handle, reg);
                // Route construct-time property values through the class's JS setters now
                // that USER_PROTO is attached — before the user ctor body runs (GJS order).
                flushConstructProperties(instance, handle, reg);
                return instance;
            }
            // `nt` is a subclass of this introspected GObject class but was NEVER passed to
            // GObject.registerClass(): silently building the introspected BASE type would
            // produce the wrong GType (missing the subclass's props/signals/vfuncs). Throw
            // the GJS-shaped error instead of constructing a misleading instance — the L1
            // analogue of GJS's "are you using GObject.registerClass()?" construct guard
            // (refs/gjs/gi/object.cpp).
            throw new Error(`Object ${nt.name || '(anonymous)'} is not registered with GObject.registerClass()`);
        }
        const handle = native.newObject(namespace, typeName, props ? unwrapProps(props) : {});
        return wrapInstance(handle);
    };
    Object.defineProperty(ctor, 'name', { value: typeName, configurable: true });
    ctor.$gtypeName = `${namespace}.${typeName}`;
    defineLazyGType(ctor, namespace, typeName);
    ctor.prototype = makeClassPrototype(namespace, typeName);
    // `inst instanceof Ns.Class` — GJS parity for the WHOLE GObject hierarchy, not
    // just the leaf class. An instance is a Proxy carrying its class prototype as a
    // SYMBOL rather than as [[Prototype]], and class prototypes are not linked to their
    // bases (no Adw.ApplicationWindow → Gtk.ApplicationWindow → … chain), so the
    // default instanceof (a prototype-chain walk) reported `false` for every base
    // class. Resolve it by the GObject type system instead: `native.isInstanceOf`
    // (g_type_is_a) recognises subclasses AND implemented interfaces, exactly like GJS.
    // Guarded by `isGObjectHandle` first — a bare/boxed/variant handle (or any non-node-gi
    // value) is NOT a GObject, so it must be `false`, never reach `isInstanceOf` (which
    // throws on a non-GObject handle). The makeClass Proxy `get` trap forwards this
    // symbol to the target (`typeof prop !== 'string'` → `t[prop]`), so `instanceof`
    // finds it on the proxy. Overlay-built classes (GLib.Variant / GObject.Value /
    // GObject.ParamSpec) bypass makeClass and keep their own dedicated hasInstance.
    Object.defineProperty(ctor, Symbol.hasInstance, {
        configurable: true,
        value(instance) {
            if (instance === null || typeof instance !== 'object') return false;
            const handle = instance[HANDLE];
            if (handle === undefined || !native.isGObjectHandle(handle)) return false;
            // The introspected class ITSELF → resolve by name: g_type_is_a recognises every
            // subclass AND implemented interface, matching GJS exactly.
            if (this === proxy) return native.isInstanceOf(handle, namespace, typeName);
            // A registerClass'd subclass INHERITS this method (it `extends` the proxy) but
            // must match ITS OWN registered GType, not the shared introspected base — else a
            // sibling subclass or a bare-base instance would wrongly test true. Resolve the
            // instance's runtime GType against the subclass's own `$gtype` through the GObject
            // type system (a live JS prototype chain the subclass instance lacks — the L1
            // wrapper carries the user prototype as a symbol, not as [[Prototype]]).
            const subGType = this.$gtype;
            if (subGType !== undefined && subGType !== null) {
                const G = requireGi('GObject', '2.0');
                return G.type_is_a(G.type_from_name(native.getTypeName(handle)), subGType);
            }
            // A raw (unregistered) subclass / unrelated ctor: ordinary prototype-chain.
            return Function.prototype[Symbol.hasInstance].call(this, instance);
        },
    });
    // Expose constructor/static methods lazily: Ns.Class.new(...) /
    // Ns.Class.new_for_path(...) (and the camelCase aliases). `new Ns.Class({...})`
    // still goes through the target's [[Construct]] (the default Proxy behaviour).
    const proxy = new Proxy(ctor, {
        get(t, prop, receiver) {
            // #667: a raw (UNregistered) subclass that `extends` this introspected class
            // must NOT inherit-read the parent's GType. A registered subclass has its OWN
            // `$gtype` (set in place by registerClass, so it shadows + never reaches this
            // trap); a raw subclass is not a GType, so an inherited read (receiver is the
            // subclass, not this proxy) resolves to undefined. A direct read on the
            // introspected class itself (receiver === proxy) resolves the real lazy GType.
            if (prop === '$gtype' && receiver !== proxy) return undefined;
            if (typeof prop !== 'string' || prop in t || RESERVED.has(prop)) return t[prop];
            // GObject.Object.new(gtype, props) / .new_with_properties(gtype, names,
            // values): gjs's GObject.js statics that construct a GObject from a runtime
            // GType. Not introspected (g_object_new is variadic), so route them to the
            // by-GType constructor (native.constructType accepts any GType handle).
            if (
                namespace === 'GObject' &&
                typeName === 'Object' &&
                (prop === 'new' || prop === 'new_with_properties' || prop === 'newWithProperties')
            ) {
                return objectStaticConstructor(prop);
            }
            const giName = camelToSnake(prop);
            return (...args) => wrapReturn(native.callStaticMethod(namespace, typeName, giName, unwrapArgs(args)));
        },
    });
    // Replacing ctor.prototype dropped the automatic back-link; restore it pointing at
    // the class the user actually holds (the Proxy), not the raw ctor behind it.
    Object.defineProperty(ctor.prototype, 'constructor', {
        value: proxy,
        writable: true,
        enumerable: false,
        configurable: true,
    });
    return proxy;
}

// The GObject.Object.new / new_with_properties statics (gjs GObject.js). `new`
// resolves the GType (a class ctor's $gtype or a GType handle) and constructs it via
// constructType (which accepts an arbitrary GType, returning the canonical wrapper —
// the same routing `new Ns.Class({...})` uses); `new_with_properties` zips the two
// arrays into a prop dict and delegates. Mirrors GJS's `GObject.Object.new`, which
// looks up the constructor for `gtype` and `new`s it with the prop dict.
function objectStaticConstructor(prop) {
    const objectNew = (gtype, props = {}) => {
        const gt = resolveGTypeArg(gtype);
        if (gt === undefined || gt === null) {
            throw new TypeError('GObject.Object.new: a GType (class or Class.$gtype) is required');
        }
        return wrapInstance(native.constructType(gt, props ? unwrapProps(props) : {}));
    };
    if (prop === 'new') return objectNew;
    return (gtype, names, values) => {
        if (!Array.isArray(names) || !Array.isArray(values) || names.length !== values.length) {
            throw new Error('GObject.Object.new_with_properties takes two equal-length arrays (names, values)');
        }
        const props = {};
        for (let i = 0; i < names.length; i++) props[names[i]] = values[i];
        return objectNew(gtype, props);
    };
}

// Surface a boxed/struct type (e.g. GLib.MainLoop) as a class-like object whose
// static/constructor methods route through the engine: `GLib.MainLoop.new(...)`
// and the camelCase alias. `new GLib.MainLoop(...)` routes through the native
// constructStruct — the `new` constructor when the struct has one, else (GJS
// gi/boxed.cpp parity) a ZERO-INITIALIZED instance for zero args
// (`new Graphene.Rect()`, `new Gdk.RGBA()` — the devtools screenshot chain).
// Returned boxed instances are wrapped by {@link wrapBoxed}.
function makeStruct(namespace, typeName) {
    const base = function () {};
    Object.defineProperty(base, 'name', { value: typeName, configurable: true });
    base.$gtypeName = `${namespace}.${typeName}`;
    defineLazyGType(base, namespace, typeName);
    const proxy = new Proxy(base, {
        get(t, prop, receiver) {
            // #667: guard inherited `$gtype` reads (see makeClass) — a raw subclass of a
            // boxed/struct type does not inherit the parent's GType.
            if (prop === '$gtype' && receiver !== proxy) return undefined;
            if (typeof prop !== 'string' || prop in t || RESERVED.has(prop)) return t[prop];
            const giName = camelToSnake(prop);
            return (...args) => wrapReturn(native.callStaticMethod(namespace, typeName, giName, unwrapArgs(args)));
        },
        construct(_t, args) {
            return wrapReturn(native.constructStruct(namespace, typeName, unwrapArgs(args)));
        },
    });
    return proxy;
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
// ... }, class)`, registers a GObject subtype via the native engine, registers the
// GIVEN class IN PLACE, and returns that SAME class (GJS-faithful — see the G3
// registry above). So both `const X = registerClass(…,C)` and the GJS
// `static { registerClass(…,C) }` idiom (return discarded) leave the same symbol
// bound to the registered GType. `new`-ed instances are usable as GObjects
// (property get/set, `.connect/.emit/.disconnect`) AND expose the user class's own
// prototype methods (resolved before the GObject routing — see wrapInstance).
//
// G3 contract (the user JS constructor body now RUNS):
//  - The construction routing lives in the introspected base ctor (makeClass),
//    keyed on `new.target`. `new X(args)` runs X's ctor body against the canonical
//    toggle-ref wrapper, with working `super(args)` semantics (the base ctor
//    returns the wrapper → it substitutes `this` up the whole chain). This REVERSES
//    the previous "ctor body is not run" caveat. `vfunc_constructed` still fires
//    once during construction; a class that inits in BOTH a ctor body and
//    `vfunc_constructed` will run both (normal GJS behaviour) — do not duplicate.
//  - Toggle-ref identity (#656): the `this` in the ctor body, the post-construct
//    wrapper, a vfunc's `this` and a signal-handler's `this` are all the SAME
//    canonical wrapper (===), and a plain JS field set on it survives a round-trip
//    + GC while C owns the object. (A GObject PROPERTY is still the right choice for
//    state that must also be visible to C / other bindings.)
//  - Instances are Proxies over a native handle, not real `instanceof` instances.
//  - Ordering caveat: a `vfunc_constructed` that fires DURING constructType sees a
//    wrapper whose USER_PROTO is attached by the vfunc trampoline (collectVfuncs),
//    so its own user-proto methods resolve; the post-construct `wrapInstance(handle,
//    nt.prototype)` then upgrades the same cached wrapper in place (identity kept).
//  - Multi-level registered subclassing (registering a subclass of a registerClass'd
//    type, at any depth) IS supported (G2): findParentGType resolves a registered
//    parent to its runtime GType handle and registerClass subclasses from it via
//    native.registerClassFromGType. Inherited custom properties, signals and vfuncs
//    of registered ANCESTORS compose for free through normal GObject inheritance
//    (g_object_class_find_property / g_signal_lookup / the owner-type-keyed property
//    store all walk the ancestry). A registered parent must be registered BEFORE the
//    child's static{} runs — ES module evaluation order guarantees this.

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

// Resolve a GObject.ParamSpec.object/.boxed `gtype` argument to a native GType
// handle the engine's BuildParamSpec can consume. The arg is GJS-shaped: a class
// ctor (introspected `Adw.Bin` / `GObject.Object`, or a registered class) whose
// real `$gtype` is the GType handle (G4), or an already-resolved GType handle.
function resolveGTypeArg(gtype) {
    if (gtype === null || gtype === undefined) return gtype;
    if (typeof gtype === 'function' || typeof gtype === 'object') {
        const gt = gtype.$gtype;
        if (gt !== undefined) return gt;
    }
    return gtype; // assume it is already a GType handle
}

// object/boxed ParamSpec factories: `(name, nick, blurb, flags, gtype)` — matching
// GJS's GObject.ParamSpec.object/.boxed argument order. `gtype` is a class ctor
// (its `$gtype` is read) or a GType handle. Produces a real g_param_spec_object /
// g_param_spec_boxed via the engine's BuildParamSpec.
function paramSpecGTyped(type) {
    return (name, nick, blurb, flags, gtype) => ({
        $paramSpec: true,
        type,
        name,
        nick,
        blurb,
        flags,
        gtype: resolveGTypeArg(gtype),
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
    object: paramSpecGTyped('object'),
    boxed: paramSpecGTyped('boxed'),
    // `wrappedPspec instanceof GObject.ParamSpec` — a wrapped GParamSpec (from a
    // notify handler / a GParamSpec-typed value) carries [HANDLE], recognised via
    // the native tag. `instanceof` honours a `[Symbol.hasInstance]` on the RHS even
    // though ParamSpec is a factory object rather than a constructor.
    [Symbol.hasInstance](instance) {
        if (instance === null || typeof instance !== 'object') return false;
        const handle = instance[HANDLE];
        return handle !== undefined && native.isParamSpecHandle(handle);
    },
});

// Walk up the JS class's prototype chain to the nearest node-gi base and describe
// the parent the native engine subclasses from. Two shapes (nearest ancestor wins):
//   - a REGISTERED ancestor (registerClass'd, present in registeredClasses) →
//     `{ parentGTypeHandle }` (its runtime GType handle, from #667). The registered
//     type has no introspection entry, so it must be subclassed from its GType
//     directly (native.registerClassFromGType) — this is what unlocks multi-level
//     registered-of-registered subclassing (G2).
//   - an INTROSPECTED ancestor (a makeClass wrapper carrying a dotted `$gtypeName`
//     like "Adw.Bin") → `{ parentNamespace, parentType }` (resolved by name).
// A registered class carries BOTH a dotless `$gtypeName` AND a registeredClasses
// entry, so the registry check MUST come first.
function findParentGType(klass) {
    for (let c = Object.getPrototypeOf(klass); typeof c === 'function'; c = Object.getPrototypeOf(c)) {
        const reg = registeredClasses.get(c);
        if (reg !== undefined) {
            return { parentGTypeHandle: reg.typeHandle };
        }
        const gt = c.$gtypeName;
        if (typeof gt === 'string') {
            const dot = gt.indexOf('.');
            if (dot > 0) {
                return { parentNamespace: gt.slice(0, dot), parentType: gt.slice(dot + 1) };
            }
            // A dotless `$gtypeName` with no registeredClasses entry should never occur
            // (only registered types are dotless, and they are in the registry); be
            // explicit rather than mis-resolving the namespace split.
            throw new TypeError("GObject.registerClass: parent '" + gt + "' has no resolvable GType");
        }
    }
    return undefined;
}

// Map a GObject.ParamSpec.* descriptor (from meta.Properties) to a native
// PropertySpec. The property name defaults to the Properties key.
function paramSpecToNative(desc, key) {
    if (desc === null || typeof desc !== 'object') {
        throw new TypeError("GObject.registerClass: Properties['" + key + "'] must be a GObject.ParamSpec descriptor");
    }
    const spec = { name: typeof desc.name === 'string' && desc.name.length > 0 ? desc.name : key };
    spec.type = desc.type;
    if (typeof desc.flags === 'number') spec.flags = desc.flags;
    if (desc.default !== undefined) spec.default = desc.default;
    if (typeof desc.minimum === 'number') spec.minimum = desc.minimum;
    if (typeof desc.maximum === 'number') spec.maximum = desc.maximum;
    // object/boxed ParamSpecs carry a value GType handle (passed straight to the
    // engine's BuildParamSpec → g_param_spec_object / g_param_spec_boxed).
    if (desc.gtype !== undefined) spec.gtype = desc.gtype;
    return spec;
}

// Normalise a signal param/return type to the native type-name vocabulary the
// engine resolves with g_type_from_name (src/class.cc TypeNameToGType). THREE
// spellings are accepted, in the order tried:
//   • a string — node-gi's own shorthand ('int', 'GBytes', any registered GType name)
//   • a GObject.ParamSpec descriptor — contributes its `.type`
//   • a GTYPE — `GObject.TYPE_INT`, `SomeClass.$gtype`. This is what GJS documents
//     and what every ported GJS class writes, and it is an OPAQUE tagged External
//     (marshal.cc kGTypeHandleTag): neither a string nor a carrier of `.type`, so it
//     has to be turned back into its canonical name via the introspected
//     `g_type_name()` — the same GType→name round-trip TypeNameToGType inverts.
// `undefined` = "not a type at all"; the caller REJECTS it (see signalSpecToNative).
function normalizeSignalType(t) {
    if (typeof t === 'string') return t;
    if (t === null || typeof t !== 'object') return undefined;
    if (typeof t.type === 'string') return t.type;
    // Lazy + namespaceCache'd; GObject is necessarily loaded already (the caller got
    // here through GObject.registerClass), same shape as the Symbol.hasInstance GType
    // lookup above. `type_name` THROWS a TypeError for anything that is not a GType
    // handle (marshal.cc UnwrapGTypeArg) — that IS the "not a type" answer, and the
    // caller turns it into a message naming the signal, so it is caught here.
    try {
        const name = requireGi('GObject', '2.0').type_name(t);
        return typeof name === 'string' && name.length > 0 ? name : undefined;
    } catch {
        return undefined;
    }
}

function describeSignalType(t) {
    return t === null ? 'null' : typeof t === 'object' ? 'an object' : typeof t === 'string' ? `'${t}'` : String(t);
}

// Map a meta.Signals entry (`{ param_types?, return_type?, flags? }`, GJS keys,
// camelCase also accepted) to a native SignalSpec; the signal name is the key.
//
// An unresolvable entry THROWS, it is never dropped. Dropping is what shipped: the
// GJS-canonical `Signals: { changed: { param_types: [GObject.TYPE_INT] } }` produced
// a signal registered with ZERO parameters, so `emit('changed', 42)` delivered
// nothing and the handler's payload argument was silently `undefined` — no error on
// either side (the engine's own loop skips a G_TYPE_INVALID param too). Measured
// against gjs 1.88 (n_params 1, payload 42) on aarch64.
function signalSpecToNative(spec, key) {
    const s = spec !== null && typeof spec === 'object' ? spec : {};
    const out = { name: key };
    const params = s.param_types !== undefined ? s.param_types : s.paramTypes;
    if (Array.isArray(params)) {
        out.paramTypes = params.map((t, i) => {
            const name = normalizeSignalType(t);
            if (name === undefined) {
                throw new TypeError(
                    `GObject.registerClass: signal '${key}' param_types[${i}] is not a type — pass a GType ` +
                        `(GObject.TYPE_INT, SomeClass.$gtype) or a type name ('int', 'GBytes'), got ${describeSignalType(t)}`,
                );
            }
            return name;
        });
    }
    const rawRet = s.return_type !== undefined ? s.return_type : s.returnType;
    if (rawRet !== undefined) {
        const ret = normalizeSignalType(rawRet);
        if (ret === undefined) {
            throw new TypeError(
                `GObject.registerClass: signal '${key}' return_type is not a type — pass a GType ` +
                    `(GObject.TYPE_INT, SomeClass.$gtype) or a type name ('int', 'GBytes'), got ${describeSignalType(rawRet)}`,
            );
        }
        out.returnType = ret;
    }
    if (typeof s.flags === 'number') out.flags = s.flags;
    return out;
}

// Collect this class's OWN newly-declared `vfunc_<name>` methods into the native
// vfuncs map (key = name without the `vfunc_` prefix). The native engine invokes
// each override with `this` = the raw instance handle; re-wrap it so the user's
// vfunc sees a usable class instance (own methods + property routing).
// `super.vfunc_<name>(...)` inside the override resolves to a chain-up thunk on the
// introspected base class's prototype (vfuncChainProto → native.callParentVfunc):
// applying the user fn with a custom `this` keeps `super` bound to its lexical home
// object (klass.prototype), so chain-up works through the .apply boundary.
//
// Multi-level boundary (G2): the walk STOPS at the first REGISTERED ancestor's
// prototype. A registered ancestor already installed its own vfunc_* trampolines
// into ITS GType's vtable, which this class inherits via the g_type_register_static
// class-struct memcpy. Re-collecting them would install a DUPLICATE trampoline on
// the leaf's GType whose captured parent IS the ancestor's own trampoline, so the
// ancestor's `super.vfunc_*()` (running as the leaf's override) would re-enter
// itself forever (stack overflow). Prototypes of UNREGISTERED mixin classes between
// the leaf and the nearest registered ancestor ARE still collected — they have no
// GType of their own, so their vfuncs only reach the vtable through the leaf.
function collectVfuncs(klass) {
    const vfuncs = {};
    const seen = new Set();
    for (let p = klass.prototype; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        // The INTROSPECTED base's prototype declares no user override, and since it
        // materializes its own `vfunc_*` members on first look-up (makeClassPrototype)
        // it now CARRIES such names: without this boundary a program that read
        // `base.vfunc_activate` before registering a subclass had that vfunc collected
        // as the subclass's own override, installing a trampoline for a slot the user
        // never wrote ("registerClass vfunc 'activate' not found on any ancestor").
        // CLASS_INFO is stamped only by makeClassPrototype, and only OWN counts — a
        // registered subclass's prototype inherits it from its base.
        if (p !== klass.prototype && Object.prototype.hasOwnProperty.call(p, CLASS_INFO)) break;
        const owner = Object.getOwnPropertyDescriptor(p, 'constructor')?.value;
        if (owner !== undefined && owner !== klass && registeredClasses.has(owner)) break;
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
 * `{ GTypeName?, Properties?, Signals?, ... }` (GJS allows both). Registers the
 * GType for the GIVEN class IN PLACE and returns that SAME class (GJS-faithful), so
 * `static { registerClass(…, X) }` (return discarded) leaves `X` itself bound to
 * the registered GType. `new X(props)` constructs the registered GType (routed via
 * the introspected base ctor on `new.target`), runs the user ctor body against the
 * canonical wrapper, and exposes the user class's own prototype methods + the
 * GObject property/signal surface. See the block comment above for the G3 contract.
 * @param {Function|Record<string, unknown>} metaOrClass
 * @param {Function} [maybeClass]
 * @returns {Function} the same `klass` (now registered)
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

    const gtypeName = typeof meta.GTypeName === 'string' && meta.GTypeName.length > 0 ? meta.GTypeName : klass.name;
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

    // Branch on the parent shape (findParentGType): a REGISTERED parent is subclassed
    // from its runtime GType handle (it has no introspection entry); an INTROSPECTED
    // parent is resolved by namespace+type. Construction (the leaf's registered GType
    // via the makeClass new.target routing) is already multi-level-correct either way.
    const typeHandle =
        parent.parentGTypeHandle !== undefined
            ? native.registerClassFromGType(gtypeName, parent.parentGTypeHandle, options)
            : native.registerClass(gtypeName, parent.parentNamespace, parent.parentType, options);

    // G3: register the GType for the GIVEN class IN PLACE (no throwaway Subclass) and
    // return that same class. `$gtypeName`/`$gtype` are defined as OWN properties:
    // `klass` inherits a getter-only `$gtype` accessor from the introspected base ctor
    // (via the makeClass Proxy), so a plain `klass.$gtype = …` assignment would throw
    // in strict mode — defineProperty installs an own data property that shadows it.
    Object.defineProperty(klass, '$gtypeName', {
        value: gtypeName,
        configurable: true,
        writable: true,
    });
    // native.registerClass returns the registered GType as a tag-distinct node-gi
    // GType handle (G4) — surface it as `$gtype` (GObject.type_ensure(X.$gtype),
    // ParamSpec.object(..., X) all read it). It is the SAME handle constructType
    // consumes, so registration and `$gtype` share one carrier.
    Object.defineProperty(klass, '$gtype', {
        value: typeHandle,
        configurable: true,
        enumerable: false,
        writable: false,
    });
    // Record the registration so the introspected base ctor (makeClass) routes
    // `new X(args)` (where new.target === klass) to constructType(typeHandle, …) +
    // the canonical wrapper. Template children move here from the old Subclass.
    // The names of CONSTRUCT / CONSTRUCT_ONLY properties — the ONLY ones GObject
    // applies at construction. The flush (flushConstructProperties) must be limited to
    // these: a plain READWRITE property is NOT set during construction, so running its
    // JS setter early (GObject never would) fires the setter's side effects against
    // still-uninitialised instance state (the SourceView `selectable` → `_signalHandlers`
    // forEach crash). Matches GJS, which only runs setters for props GObject applies at
    // construct. Flags are the ABI-stable G_PARAM_CONSTRUCT (1<<2) | CONSTRUCT_ONLY (1<<3).
    const PARAM_CONSTRUCT_MASK = 0x4 | 0x8;
    const constructPropertyNames = properties
        .filter((p) => typeof p.flags === 'number' && (p.flags & PARAM_CONSTRUCT_MASK) !== 0)
        .map((p) => p.name)
        .filter((n) => typeof n === 'string');
    registeredClasses.set(klass, {
        typeHandle,
        children: children.length > 0 ? children : undefined,
        internalChildren: internalChildren.length > 0 ? internalChildren : undefined,
        // CONSTRUCT-property names, for the construct-property flush (below).
        constructPropertyNames: constructPropertyNames.length > 0 ? constructPropertyNames : undefined,
    });
    // Reverse index for runCtorForCObject: the engine identifies a C-created instance
    // by its GType name (= gtypeName, what native.registerClass registered).
    classesByGType.set(gtypeName, klass);
    // GJS parity: registration must be COMPLETE when registerClass returns. The
    // engine installs the custom properties, signals and vfunc trampolines in
    // class_init (src/class.cc), which GObject runs lazily on the first
    // g_type_class_ref — so without this the declared surface did not exist until the
    // first instance was constructed, and `GObject.signal_lookup('changed',
    // Klass.$gtype)` answered 0 where gjs answers the real signal id (measured: gjs
    // 1.88.1 vs node-gi on aarch64). g_type_class_ref is what forces it, exactly as
    // gjs's own registerClass does; the ref is deliberately never released (a class
    // struct outlives its GType, which is permanent). Placed LAST so every L1 record
    // above is in place before any class_init side effect (a Gtk template install)
    // runs. Idempotent — GObject initialises a class exactly once.
    requireGi('GObject', '2.0').type_class_ref(typeHandle);
    return klass;
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

// GObject.AccumulatorType — gjs's fake enum for signal accumulators (GObject.js,
// "keep in sync with gi/object.c"). Not introspected; a pure convenience table.
const AccumulatorType = Object.freeze({ NONE: 0, FIRST_WINS: 1, TRUE_HANDLED: 2 });

// GObject.signal_handlers_{block,unblock,disconnect}_by_func(instance, fn) — gjs's
// GObject.js by-function handler ops. node-gi connects via PRIVATE closures, so the
// function is resolved to its recorded handler ids (signalHandlerIds), then each is
// blocked/unblocked via the introspected single-handler g_signal_handler_{block,
// unblock} (verified to marshal a node-gi GObject IN-arg) or disconnected via
// native.disconnectSignal. Returns the count of handlers matched, exactly as gjs's
// g_signal_handlers_*_matched-based helpers do.
function signalHandlersBlockByFunc(instance, fn) {
    const handle = unwrapArg(instance);
    const ids = handlerIdsForFunc(handle, fn);
    for (const id of ids) native.callFunction('GObject', 'signal_handler_block', [handle, id]);
    return ids.length;
}
function signalHandlersUnblockByFunc(instance, fn) {
    const handle = unwrapArg(instance);
    const ids = handlerIdsForFunc(handle, fn);
    for (const id of ids) native.callFunction('GObject', 'signal_handler_unblock', [handle, id]);
    return ids.length;
}
function signalHandlersDisconnectByFunc(instance, fn) {
    const handle = unwrapArg(instance);
    const ids = handlerIdsForFunc(handle, fn);
    for (const id of ids) {
        native.disconnectSignal(handle, id);
        forgetSignalHandlerId(handle, id);
    }
    return ids.length;
}
// Matches gjs's non-introspectable guard (GObject.js) — there is no func→data map.
function signalHandlersDisconnectByData() {
    throw new Error(
        'GObject.signal_handlers_disconnect_by_data() is not introspectable. Use ' +
            'GObject.signal_handlers_disconnect_by_func() instead.',
    );
}

// GObject.signal_connect / signal_connect_after / signal_emit_by_name — gjs's
// GObject.js shims that call the instance's OWN connect/connect_after/emit (a
// workaround for classes that shadow those names with their own methods). The
// instance is the L1 wrapper, whose .connect records the id in the by-func registry.
function signalConnect(object, name, handler) {
    return object.connect(name, handler);
}
function signalConnectAfter(object, name, handler) {
    return object.connect_after(name, handler);
}
function signalEmitByName(object, ...nameAndArgs) {
    return object.emit(...nameAndArgs);
}

// Overlay the GJS `GObject` runtime statics on top of the introspected GObject
// namespace proxy — ADDITIVELY. `registerClass` + `ParamSpec` + the signal-by-func
// helpers + `Value` + `AccumulatorType` are genuinely new (or shadow a broken
// introspected member — `Value`, whose struct has no `new()`). `ParamFlags` /
// `SignalFlags` are FULL introspected bitfields: returning a hardcoded 5-member
// table would make every other member read `undefined` (→ coerces to 0 in `FLAGS |
// GObject.ParamFlags.X`, silently dropping the bit), so they resolve to the
// introspected enum (convenience names merged underneath as a fallback).
// `GObject.Object` etc. keep resolving from introspection (with .new added in
// makeClass). Merged enums are cached so identity is stable.
const OVERLAY_NAMES = new Set([
    'registerClass',
    'ParamSpec',
    'ParamFlags',
    'SignalFlags',
    'Value',
    'AccumulatorType',
    'signal_handlers_block_by_func',
    'signal_handlers_unblock_by_func',
    'signal_handlers_disconnect_by_func',
    'signal_handlers_disconnect_by_data',
    'signal_connect',
    'signal_connect_after',
    'signal_emit_by_name',
]);

// The fundamental GObject.TYPE_* constants. GJS defines these in its GObject
// override by looking each name up in libgobject AT RUNTIME (not hardcoding the
// fundamental ints): refs/gjs/modules/core/overrides/GObject.js `_init` —
// `GObject.TYPE_STRING = GObject.type_from_name('gchararray')`, and the
// `_makeDummyClass(obj, name, upperName, gtypeName, …)` helper for the numeric/
// char/gtype family. We resolve them the SAME way through the introspected
// `GObject.type_from_name`, so each constant is the real, process-correct GType —
// an OPAQUE GType handle exactly like GJS (`typeof GObject.TYPE_INT === 'object'`,
// NOT the number 24; `GObject.type_from_name('gint') === GObject.TYPE_INT`), never
// a hardcoded fundamental value. Map: constant name → the registered GType name.
// (TYPE_JSOBJECT is intentionally omitted — 'JSObject' is a GJS-internal boxed type
// that libgobject does not register on a plain node-gi host, so it has no correct
// value here.)
const GTYPE_CONSTANT_NAMES = {
    TYPE_NONE: 'void',
    TYPE_INTERFACE: 'GInterface',
    TYPE_CHAR: 'gchar',
    TYPE_UCHAR: 'guchar',
    TYPE_BOOLEAN: 'gboolean',
    TYPE_INT: 'gint',
    TYPE_UINT: 'guint',
    TYPE_LONG: 'glong',
    TYPE_ULONG: 'gulong',
    TYPE_INT64: 'gint64',
    TYPE_UINT64: 'guint64',
    TYPE_ENUM: 'GEnum',
    TYPE_FLAGS: 'GFlags',
    TYPE_FLOAT: 'gfloat',
    TYPE_DOUBLE: 'gdouble',
    TYPE_STRING: 'gchararray',
    TYPE_POINTER: 'gpointer',
    TYPE_BOXED: 'GBoxed',
    TYPE_PARAM: 'GParam',
    TYPE_OBJECT: 'GObject',
    TYPE_VARIANT: 'GVariant',
    TYPE_GTYPE: 'GType',
    TYPE_UNICHAR: 'gint',
};

function isGObjectOverlayName(prop) {
    return (
        typeof prop === 'string' &&
        (OVERLAY_NAMES.has(prop) || Object.prototype.hasOwnProperty.call(GTYPE_CONSTANT_NAMES, prop))
    );
}

function decorateGObjectNamespace(baseNs) {
    const cache = new Map();
    const resolve = (prop) => {
        if (cache.has(prop)) return cache.get(prop);
        let value;
        if (prop === 'registerClass') value = registerClass;
        else if (prop === 'ParamSpec') value = ParamSpec;
        else if (prop === 'ParamFlags') value = mergeFlags(baseNs.ParamFlags, ParamFlags);
        else if (prop === 'SignalFlags') value = mergeFlags(baseNs.SignalFlags, SignalFlags);
        else if (prop === 'Value') value = valueClass;
        else if (prop === 'AccumulatorType') value = AccumulatorType;
        else if (prop === 'signal_handlers_block_by_func') value = signalHandlersBlockByFunc;
        else if (prop === 'signal_handlers_unblock_by_func') value = signalHandlersUnblockByFunc;
        else if (prop === 'signal_handlers_disconnect_by_func') value = signalHandlersDisconnectByFunc;
        else if (prop === 'signal_handlers_disconnect_by_data') value = signalHandlersDisconnectByData;
        else if (prop === 'signal_connect') value = signalConnect;
        else if (prop === 'signal_connect_after') value = signalConnectAfter;
        else if (prop === 'signal_emit_by_name') value = signalEmitByName;
        else if (Object.prototype.hasOwnProperty.call(GTYPE_CONSTANT_NAMES, prop)) {
            // Resolve the real GType from libgobject via the introspected type_from_name
            // (0 / unregistered → null, matching object.cc's GType marshalling).
            value = baseNs.type_from_name(GTYPE_CONSTANT_NAMES[prop]);
        }
        cache.set(prop, value);
        return value;
    };
    return new Proxy(baseNs, {
        get(t, prop) {
            return isGObjectOverlayName(prop) ? resolve(prop) : t[prop];
        },
        has(t, prop) {
            return isGObjectOverlayName(prop) || prop in t;
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

// The ONE namespace object per GI namespace, as in gjs where `imports.gi.Ns` is a
// singleton. Keyed by NAMESPACE alone: a repository cannot hold two versions at
// once, and keying by `Ns@version` handed `requireGi('Gio','2.0')` and
// `requireGi('Gio')` two independent objects — `Gio.File !== Gio.File` between the
// spellings, a prototype patched through one invisible through the other. Does NOT
// load the typelib (requireGi does that first).
function namespaceObject(namespace) {
    let ns = namespaceCache.get(namespace);
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
        namespaceCache.set(namespace, ns);
    }
    return ns;
}

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
    // Attach the libuv↔GLib integration once. On Node this arms BOTH directions:
    // the uv-in-GLib bridge (a blocking GLib.MainLoop.run / Gio.Application.run
    // keeps Node's event loop alive) AND the uv-driven auto-pump (pending GLib
    // sources — Gio async completions, GLib timeouts/idles, DBus — dispatch from
    // Node's own loop, so async gi:// code works with NO explicit mainloop). This
    // is Node-only: Bun/Deno have no usable libuv (Deno exports no libuv symbols;
    // Bun panics on uv_backend_fd). There, GLib async is co-pumped from the runtime
    // loop via the portable GLib-iteration pump instead (see startMainContextPump /
    // runAsync).
    if (!loopAttached) {
        if (native.isNodeRuntime) {
            native.startMainLoop();
            // Bootstrap kick for the auto-pump: with ONLY unref'd handles active,
            // uv_run exits without running the pump's prepare/check phase at all, so
            // an otherwise-empty loop would never arm GLib's timer/fd wake-ups (a
            // pending top-level await on a GLib timeout would exit-13 unsettled).
            // 'beforeExit' fires exactly when the loop runs empty: drain what is
            // ready and re-arm — if GLib still has scheduled work, the armed (ref'd)
            // uv timer revives the loop; otherwise the process exits normally.
            runtimeProcess.on('beforeExit', () => native.pumpKick());
        } else if (native.RUNTIME !== 'gjs') {
            // Bun/Deno: no libuv to hook, so the portable timer pump IS the auto-pump.
            // Armed HERE, not left to the caller, so that `bun bundle.mjs` /
            // `deno run bundle.mjs` behaves like `node bundle.mjs` and `gjs -m`:
            // GLib sources dispatch with no explicit loop anywhere, and the pump's
            // keep-alive accounting decides when the process may exit. Leaving it
            // opt-in is what made the same bundle exit 0 MID-suite on bun/deno while
            // node ran it to completion.
            startMainContextPump(); // permanent +1 — the auto-pump is never disposed
            // Tag that hold as the AUTO pump's: pumpBeat dispatches for it only while
            // a JS-armed GI callback is outstanding, so a finished program produces
            // no teardown churn (the deno #47 window) — explicit callers keep
            // unconditional dispatch.
            pumpAutoRefs++;
            // The portable analogue of the Node pump's beforeExit kick. The runtime's
            // loop just ran empty, which is exactly the moment an unref'd pump would
            // let the process die with GLib work still outstanding: run one beat —
            // if the program still owns GLib work it drains + re-refs (reviving the
            // loop); if not, the beat stays silent and the process exits.
            runtimeProcess.on('beforeExit', pumpBeat);
        }
        loopAttached = true;
    }
    return namespaceObject(namespace);
}

/**
 * Extract the raw native GObject handle from a wrapped instance (advanced /
 * interop use). Returns the value unchanged if it is not a wrapped instance.
 * @param {unknown} value
 * @returns {unknown}
 */
export function unwrap(value) {
    // NOT unwrapArg: the public unwrap only extracts handles — it must never
    // replace a function with the engine-facing callback shim.
    if (value !== null && typeof value === 'object' && value[HANDLE] !== undefined) {
        return value[HANDLE];
    }
    return value;
}

export default requireGi;
