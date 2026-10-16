// SPDX-License-Identifier: MIT
// @gjsify/node-gi — thin ESM loader for the native GObject-Introspection addon.
//
// Reference: refs/node-gtk (romgrk, MIT). Hand-authored and at the package root:
// a native package's JS entry is a loader, not a tsc artifact, and the repo
// ignores `lib/`. The addon is Node-API (ABI-stable), so the same binary loads on
// Node, Bun and Deno; runtime-specific behaviour is gated off RUNTIME below.
import { RUNTIME, loadNativeHost, LAZY_NATIVE } from '#host';

/**
 * Which JS runtime we are on. Detection — and why each runtime gets the main-loop
 * treatment it gets — lives at the detection site, behind `#host`.
 * @type {'bun' | 'deno' | 'gjs' | 'node' | 'nativescript'}
 */
export { RUNTIME };

/** Whether we are on Node.js (the only runtime with the libuv main-loop bridge). */
export const isNodeRuntime = RUNTIME === 'node';

/**
 * The native engine. Desktop runtimes load it HERE, while this module evaluates, exactly as
 * before. A host that sets `LAZY_NATIVE` (NativeScript: dlopen of `libnode_gi.so` plus its
 * closure costs real cold-start time) defers the load to the first `ensureNative()`, so an app
 * that imports this package but never asks for GObject pays nothing. A failed load throws from
 * `ensureNative()` every time it is asked — a selected real engine still fails loudly, there
 * is no fallback here (ADR 0105 § 4).
 * @type {Record<string, any>}
 */
let native;
let loaded = false;
/** @type {Array<() => void>} */
const loadHooks = [];

/**
 * Load the addon if that has not happened yet, and return it. The L1 layers call this before
 * they touch any binding below.
 * @returns {Record<string, any>}
 */
export function ensureNative() {
    if (loaded) return native;
    const addon = loadNativeHost();
    native = addon;
    requireNamespace = addon.requireNamespace;
    listInfoNames = addon.listInfoNames;
    findInfo = addon.findInfo;
    getConstantValue = addon.getConstantValue;
    getEnumValues = addon.getEnumValues;
    getErrorDomain = addon.getErrorDomain;
    errorDomainInfo = addon.errorDomainInfo;
    setErrorBuilder = addon.setErrorBuilder;
    prependSearchPath = addon.prependSearchPath;
    prependLibraryPath = addon.prependLibraryPath;
    callFunction = addon.callFunction;
    callMethod = addon.callMethod;
    hasMethod = addon.hasMethod;
    hasClassMethod = addon.hasClassMethod;
    classMethodArity = addon.classMethodArity;
    callStaticMethod = addon.callStaticMethod;
    constructStruct = addon.constructStruct;
    newObject = addon.newObject;
    registerClass = addon.registerClass;
    registerClassFromGType = addon.registerClassFromGType;
    constructType = addon.constructType;
    callParentVfunc = addon.callParentVfunc;
    hasClassVfunc = addon.hasClassVfunc;
    callClassVfunc = addon.callClassVfunc;
    getTemplateChild = addon.getTemplateChild;
    getProperty = addon.getProperty;
    setProperty = addon.setProperty;
    hasProperty = addon.hasProperty;
    getTypeName = addon.getTypeName;
    classInfoForTypeName = addon.classInfoForTypeName;
    getGType = addon.getGType;
    isInstanceOf = addon.isInstanceOf;
    isGObjectHandle = addon.isGObjectHandle;
    newGValue = addon.newGValue;
    callBoxedMethod = addon.callBoxedMethod;
    isBoxedHandle = addon.isBoxedHandle;
    boxedMemberKind = addon.boxedMemberKind;
    getBoxedField = addon.getBoxedField;
    setBoxedField = addon.setBoxedField;
    boxedTypeName = addon.boxedTypeName;
    __boxedAddress = addon.__boxedAddress;
    isParamSpecHandle = addon.isParamSpecHandle;
    isFundamentalHandle = addon.isFundamentalHandle;
    paramSpecProp = addon.paramSpecProp;
    variantNew = addon.variantNew;
    variantUnpack = addon.variantUnpack;
    variantGetTypeString = addon.variantGetTypeString;
    isVariantHandle = addon.isVariantHandle;
    startMainLoop = addon.startMainLoop;
    iterateMainContext = addon.iterateMainContext;
    mainContextHasPending = addon.mainContextHasPending;
    makePumpPendingCount = addon.makePumpPendingCount;
    pumpKick = addon.pumpKick;
    setMicrotaskDrain = addon.setMicrotaskDrain;
    connectSignal = addon.connectSignal;
    emitSignal = addon.emitSignal;
    disconnectSignal = addon.disconnectSignal;
    setTemplateCallbackResolver = addon.setTemplateCallbackResolver;
    setConstructCallback = addon.setConstructCallback;
    setPropertySetCallback = addon.setPropertySetCallback;
    storedPropertyNames = addon.storedPropertyNames;
    logSetWriterFunc = addon.logSetWriterFunc;
    logSetWriterDefault = addon.logSetWriterDefault;
    bindPropertyFull = addon.bindPropertyFull;
    bindingGroupBindFull = addon.bindingGroupBindFull;
    setThreadLocale = addon.setThreadLocale;
    textdomain = addon.textdomain;
    bindtextdomain = addon.bindtextdomain;
    localeCategories = addon.localeCategories;
    probeHostOpenGL = addon.probeHostOpenGL;
    currentGLStrings = addon.currentGLStrings;
    loaded = true;
    for (const hook of loadHooks.splice(0)) hook();
    return native;
}

/** Whether the addon is loaded now — what the lazy host makes observable. */
export function isNativeLoaded() {
    return loaded;
}

/**
 * Run `hook` once the addon is loaded: now if it is, else straight after the first load. The
 * L1 module-scope registrations (error builder, template resolver, …) go through this, so they
 * run at import on desktop and at first use on a lazy host.
 * @param {() => void} hook
 */
export function onNativeLoaded(hook) {
    if (loaded) hook();
    else loadHooks.push(hook);
}

// Straight re-exports of the native engine surface. Each contract — arguments,
// ownership, the OUT/INOUT return-tuple convention, the keep-alive rules of the
// main-loop group — is documented once in index.d.ts, the published type surface;
// only what index.d.ts does not carry is noted here.
export let requireNamespace;
export let listInfoNames;
export let findInfo;
export let getConstantValue;
export let getEnumValues;
export let getErrorDomain;
export let errorDomainInfo;
export let setErrorBuilder;
export let prependSearchPath;
export let prependLibraryPath;
export let callFunction;
export let callMethod;
export let hasMethod;
export let hasClassMethod;
export let classMethodArity;
export let callStaticMethod;
export let constructStruct;
export let newObject;
export let registerClass;

// Subclass an ALREADY-REGISTERED parent by its GType handle instead of a
// `namespace.typeName`: a registered (dynamic) parent has no introspection entry, so it
// cannot be resolved by name. Custom properties, signals and vfunc slots of registered
// ancestors compose through ordinary GObject inheritance. The L1 `GObject.registerClass`
// picks this variant when the nearest base is itself a registered class.
export let registerClassFromGType;

export let constructType;
export let callParentVfunc;
export let hasClassVfunc;
export let callClassVfunc;
export let getTemplateChild;
export let getProperty;
export let setProperty;
export let hasProperty;
export let getTypeName;
export let classInfoForTypeName;
export let getGType;
export let isInstanceOf;
export let isGObjectHandle;
export let newGValue;
export let callBoxedMethod;
export let isBoxedHandle;
export let boxedMemberKind;
export let getBoxedField;
export let setBoxedField;
export let boxedTypeName;
/** TEST-ONLY: the address a boxed handle wraps, so an ownership rule about pointer
 * IDENTITY can be asserted instead of waited on (see marshal.cc BoxedAddress). */
export let __boxedAddress;
export let isParamSpecHandle;

// True for a non-GObject GObject-fundamental handle (a GskRenderNode from
// Gtk.Snapshot.to_node, a GdkEvent): introspected as object info, but ref-counted
// through its own ref/unref funcs, NOT g_object_ref. L1 surfaces it as an opaque,
// round-trippable pass-through handle.
export let isFundamentalHandle;

export let paramSpecProp;
export let variantNew;
export let variantUnpack;
export let variantGetTypeString;
export let isVariantHandle;
export let startMainLoop;
export let iterateMainContext;
export let mainContextHasPending;
export let makePumpPendingCount;
export let pumpKick;
export let setMicrotaskDrain;
export let connectSignal;
export let emitSignal;
export let disconnectSignal;
export let setTemplateCallbackResolver;

// Registers the L1 callback the engine's overridden `constructor` vfunc invokes to run a
// registered class's JS constructor for a GObject that C instantiated (a GtkBuilder
// composite-template InternalChild): given (instanceHandle, gtypeName) it
// Reflect.constructs the class in adopt mode — see gi.js runCtorForCObject.
export let setConstructCallback;

// Registers the L1 callback the engine's set_property vfunc invokes after storing a
// custom property: given (instanceHandle, propertyName) it runs the class's own JS
// setter — see gi.js runJsPropertySetter. The engine calls it only once the instance
// HAS a wrapper, so a construct-time set never reaches it; those are replayed from
// the base ctor over storedPropertyNames.
export let setPropertySetCallback;

// The custom properties actually SET on an instance (the per-instance store's keys) —
// what that construct-time replay has to push through the class's JS setters.
export let storedPropertyNames;

export let logSetWriterFunc;
export let logSetWriterDefault;
export let bindPropertyFull;
export let bindingGroupBindFull;

// The libintl half of GjsPrivate — the binders GLib's GIR does not publish, plus
// the LC_* constants read from the host's own <locale.h>. Consumed by
// `./gettext.js`; loading THIS module is also what puts the process in the
// environment's locale (the addon's Init does it, as gjs's entry point does).
export let setThreadLocale;
export let textdomain;
export let bindtextdomain;
export let localeCategories;

// win32 only (undefined elsewhere): which OpenGL the process got — see gtk-runtime.js
// activateBundledOpenGL. currentGLStrings asks the implementation behind the context
// current on this thread, so a caller can tell Mesa from a vendor driver.
export let probeHostOpenGL;
export let currentGLStrings;

export { native as default };

// Last, so every `export let` above is initialised before the eager load assigns it.
if (!LAZY_NATIVE) ensureNative();
