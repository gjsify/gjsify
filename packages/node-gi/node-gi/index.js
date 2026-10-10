// SPDX-License-Identifier: MIT
// @gjsify/node-gi — thin ESM loader for the native GObject-Introspection addon.
//
// Reference: refs/node-gtk (romgrk, MIT). Hand-authored and at the package root:
// a native package's JS entry is a loader, not a tsc artifact, and the repo
// ignores `lib/`. The addon is Node-API (ABI-stable), so the same binary loads on
// Node, Bun and Deno; runtime-specific behaviour is gated off RUNTIME below.
import { RUNTIME, loadNativeHost } from '#host';

/**
 * Which JS runtime we are on. The addon loads on all four: Node/Bun/Deno implement
 * Node-API natively, GJS hosts it through the `@gjsify/napi` shim. The libuv main-loop
 * bridge (startMainLoop) is Node-only — Deno exports no libuv symbols and Bun panics on
 * uv_backend_fd — so Bun/Deno use gi.js's portable GLib-iteration pump, and GJS needs
 * neither (its host loop already IS GLib's default main context). Detection order is
 * load-bearing: GJS first via `imports` + `print` (no other runtime defines both), then
 * Bun/Deno, which both expose a `process` shim.
 * NativeScript's Android runtime reports `'nativescript'` (host.nativescript.js).
 * @type {'bun' | 'deno' | 'gjs' | 'node' | 'nativescript'}
 */
export { RUNTIME };

/** Whether we are on Node.js (the only runtime with the libuv main-loop bridge). */
export const isNodeRuntime = RUNTIME === 'node';

const native = loadNativeHost();

// Straight re-exports of the native engine surface. Each contract — arguments,
// ownership, the OUT/INOUT return-tuple convention, the keep-alive rules of the
// main-loop group — is documented once in index.d.ts, the published type surface;
// only what index.d.ts does not carry is noted here.
export const requireNamespace = native.requireNamespace;
export const listInfoNames = native.listInfoNames;
export const findInfo = native.findInfo;
export const getConstantValue = native.getConstantValue;
export const getEnumValues = native.getEnumValues;
export const getErrorDomain = native.getErrorDomain;
export const setErrorBuilder = native.setErrorBuilder;
export const prependSearchPath = native.prependSearchPath;
export const prependLibraryPath = native.prependLibraryPath;
export const callFunction = native.callFunction;
export const callMethod = native.callMethod;
export const hasMethod = native.hasMethod;
export const hasClassMethod = native.hasClassMethod;
export const classMethodArity = native.classMethodArity;
export const callStaticMethod = native.callStaticMethod;
export const constructStruct = native.constructStruct;
export const newObject = native.newObject;
export const registerClass = native.registerClass;

// Subclass an ALREADY-REGISTERED parent by its GType handle instead of a
// `namespace.typeName`: a registered (dynamic) parent has no introspection entry, so it
// cannot be resolved by name. Custom properties, signals and vfunc slots of registered
// ancestors compose through ordinary GObject inheritance. The L1 `GObject.registerClass`
// picks this variant when the nearest base is itself a registered class.
export const registerClassFromGType = native.registerClassFromGType;

export const constructType = native.constructType;
export const callParentVfunc = native.callParentVfunc;
export const hasClassVfunc = native.hasClassVfunc;
export const callClassVfunc = native.callClassVfunc;
export const getTemplateChild = native.getTemplateChild;
export const getProperty = native.getProperty;
export const setProperty = native.setProperty;
export const hasProperty = native.hasProperty;
export const getTypeName = native.getTypeName;
export const classInfoForTypeName = native.classInfoForTypeName;
export const getGType = native.getGType;
export const isInstanceOf = native.isInstanceOf;
export const isGObjectHandle = native.isGObjectHandle;
export const newGValue = native.newGValue;
export const callBoxedMethod = native.callBoxedMethod;
export const isBoxedHandle = native.isBoxedHandle;
export const boxedMemberKind = native.boxedMemberKind;
export const getBoxedField = native.getBoxedField;
export const setBoxedField = native.setBoxedField;
export const boxedTypeName = native.boxedTypeName;
/** TEST-ONLY: the address a boxed handle wraps, so an ownership rule about pointer
 * IDENTITY can be asserted instead of waited on (see marshal.cc BoxedAddress). */
export const __boxedAddress = native.__boxedAddress;
export const isParamSpecHandle = native.isParamSpecHandle;

// True for a non-GObject GObject-fundamental handle (a GskRenderNode from
// Gtk.Snapshot.to_node, a GdkEvent): introspected as object info, but ref-counted
// through its own ref/unref funcs, NOT g_object_ref. L1 surfaces it as an opaque,
// round-trippable pass-through handle.
export const isFundamentalHandle = native.isFundamentalHandle;

export const paramSpecProp = native.paramSpecProp;
export const variantNew = native.variantNew;
export const variantUnpack = native.variantUnpack;
export const variantGetTypeString = native.variantGetTypeString;
export const isVariantHandle = native.isVariantHandle;
export const startMainLoop = native.startMainLoop;
export const iterateMainContext = native.iterateMainContext;
export const mainContextHasPending = native.mainContextHasPending;
export const makePumpPendingCount = native.makePumpPendingCount;
export const pumpKick = native.pumpKick;
export const setMicrotaskDrain = native.setMicrotaskDrain;
export const connectSignal = native.connectSignal;
export const emitSignal = native.emitSignal;
export const disconnectSignal = native.disconnectSignal;
export const setTemplateCallbackResolver = native.setTemplateCallbackResolver;

// Registers the L1 callback the engine's overridden `constructor` vfunc invokes to run a
// registered class's JS constructor for a GObject that C instantiated (a GtkBuilder
// composite-template InternalChild): given (instanceHandle, gtypeName) it
// Reflect.constructs the class in adopt mode — see gi.js runCtorForCObject.
export const setConstructCallback = native.setConstructCallback;

// Registers the L1 callback the engine's set_property vfunc invokes after storing a
// custom property: given (instanceHandle, propertyName) it runs the class's own JS
// setter — see gi.js runJsPropertySetter. The engine calls it only once the instance
// HAS a wrapper, so a construct-time set never reaches it; those are replayed from
// the base ctor over storedPropertyNames.
export const setPropertySetCallback = native.setPropertySetCallback;

// The custom properties actually SET on an instance (the per-instance store's keys) —
// what that construct-time replay has to push through the class's JS setters.
export const storedPropertyNames = native.storedPropertyNames;

export const logSetWriterFunc = native.logSetWriterFunc;
export const logSetWriterDefault = native.logSetWriterDefault;
export const bindPropertyFull = native.bindPropertyFull;
export const bindingGroupBindFull = native.bindingGroupBindFull;

// The libintl half of GjsPrivate — the binders GLib's GIR does not publish, plus
// the LC_* constants read from the host's own <locale.h>. Consumed by
// `./gettext.js`; loading THIS module is also what puts the process in the
// environment's locale (the addon's Init does it, as gjs's entry point does).
export const setThreadLocale = native.setThreadLocale;
export const textdomain = native.textdomain;
export const bindtextdomain = native.bindtextdomain;
export const localeCategories = native.localeCategories;

// win32 only (undefined elsewhere): which OpenGL the process got — see gtk-runtime.js
// activateBundledOpenGL. currentGLStrings asks the implementation behind the context
// current on this thread, so a caller can tell Mesa from a vendor driver.
export const probeHostOpenGL = native.probeHostOpenGL;
export const currentGLStrings = native.currentGLStrings;

export default native;
