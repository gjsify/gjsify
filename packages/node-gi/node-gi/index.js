// SPDX-License-Identifier: MIT
// @gjsify/node-gi — thin ESM loader for the native GObject-Introspection addon.
//
// Reference: refs/node-gtk (romgrk, MIT). Hand-authored and at the package root:
// a native package's JS entry is a loader, not a tsc artifact, and the repo
// ignores `lib/`. The addon is Node-API (ABI-stable), so the same binary loads on
// Node, Bun and Deno; runtime-specific behaviour is gated off RUNTIME below.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { hostTarget, nativeCandidates, packageRoot } from './native-paths.js';
import { describeAddonLoadFailure } from './load-diagnostics.js';
import {
    activateBundledGtkRuntime,
    activateGiLibraryPath,
    maybePrependGtkRuntimeDllPath,
    maybeReexecForGtkRuntime,
    maybeWireGtkWindowingEnv,
} from './gtk-runtime.js';

// macOS bundled GTK: dyld reads DYLD_FALLBACK_LIBRARY_PATH only at launch, and GI
// needs it to g_module_open typelib backers (get_type / Pango / Gdk / Graphene) by
// leaf soname — so the re-exec must happen BEFORE the addon's GTK closure is
// dlopen'd. Never returns when it re-execs.
maybeReexecForGtkRuntime();

// Windows bundled GTK: Windows re-reads the DLL search path at every LoadLibrary
// (unlike dyld's launch-time capture), so mutating process.env.PATH in-process
// before the require() below covers both the static DLL imports and the runtime
// g_module_open of typelib backers — no re-exec needed.
maybePrependGtkRuntimeDllPath();

// Windows full-windowing GTK: point GSETTINGS_SCHEMA_DIR / GDK_PIXBUF_MODULE_FILE /
// XDG_DATA_DIRS / FONTCONFIG_* at the data a real GTK window needs. Strict no-op for
// the display-free bundle, which therefore loads byte-unchanged.
maybeWireGtkWindowingEnv();

const require = createRequire(import.meta.url);
const here = packageRoot;

/**
 * Which JS runtime we are on. The addon loads on all four: Node/Bun/Deno implement
 * Node-API natively, GJS hosts it through the `@gjsify/napi` shim. The libuv main-loop
 * bridge (startMainLoop) is Node-only — Deno exports no libuv symbols and Bun panics on
 * uv_backend_fd — so Bun/Deno use gi.js's portable GLib-iteration pump, and GJS needs
 * neither (its host loop already IS GLib's default main context). Detection order is
 * load-bearing: GJS first via `imports` + `print` (no other runtime defines both), then
 * Bun/Deno, which both expose a `process` shim.
 * @type {'bun' | 'deno' | 'gjs' | 'node'}
 */
export const RUNTIME =
    typeof globalThis.imports !== 'undefined' && typeof globalThis.print === 'function'
        ? 'gjs'
        : typeof globalThis.Bun !== 'undefined'
          ? 'bun'
          : typeof globalThis.Deno !== 'undefined'
            ? 'deno'
            : 'node';

/** Whether we are on Node.js (the only runtime with the libuv main-loop bridge). */
export const isNodeRuntime = RUNTIME === 'node';

// GJS host mode: `GjsifyNapi.init()` installs the loader as
// `globalThis.__gjsifyNapiLoadAddon` and re-installs it if another consumer (the
// @gjsify/napi L1) already captured + deleted it. Needs the GjsifyNapi typelib
// resolvable via GI_TYPELIB_PATH/LD_LIBRARY_PATH.
function gjsLoadAddon(path) {
    let load = globalThis.__gjsifyNapiLoadAddon;
    if (typeof load !== 'function') {
        const GjsifyNapi = globalThis.imports?.gi?.GjsifyNapi;
        if (!GjsifyNapi || !GjsifyNapi.init()) {
            throw new Error(
                '@gjsify/node-gi: GJS host mode needs the @gjsify/napi shim — the GjsifyNapi ' +
                    'typelib is not loadable (point GI_TYPELIB_PATH and LD_LIBRARY_PATH at its prebuild).',
            );
        }
        load = globalThis.__gjsifyNapiLoadAddon;
        if (typeof load !== 'function') {
            throw new Error('@gjsify/node-gi: GjsifyNapi.init() did not install the addon loader.');
        }
        // Capture-then-delete, the same no-side-channel discipline as the L1.
        delete globalThis.__gjsifyNapiLoadAddon;
    }
    return load(path);
}

function loadNative() {
    for (const candidate of nativeCandidates()) {
        if (existsSync(candidate)) {
            try {
                return RUNTIME === 'gjs' ? gjsLoadAddon(candidate) : require(candidate);
            } catch (err) {
                // The addon FILE is here and still would not load — on win32/darwin
                // that means a missing GTK dependency closure, but the raw error
                // names only the .node, in the OS's language, about a file that
                // plainly exists (#1063: `Das angegebene Modul wurde nicht
                // gefunden.` on a present node_gi.node; #994: a missing load-time
                // library surfacing as "Unsupported type void, deriving from
                // fundamental void"). The cause is knowable here, so say it.
                throw new Error(describeAddonLoadFailure(candidate, err), { cause: err });
            }
        }
    }
    throw new Error(
        `@gjsify/node-gi: native addon not found for ${RUNTIME} on ${hostTarget()}. ` +
            `Expected a prebuild at prebuilds/${hostTarget()}/node_gi.node or a local build. ` +
            'Run `node-gyp rebuild` in ' +
            here +
            ' (requires a C++ toolchain and the girepository-2.0 / glib-2.0 development headers), ' +
            'or install a package build that ships a prebuild for your platform. ' +
            'Under a bundled GJS app (import.meta anchors at the bundle), set NODE_GI_NATIVE to the addon path.',
    );
}

const native = loadNative();

// Activate a relocated GTK/GI runtime bundle (@gjsify/gtk-runtime-<os>-<arch> or a
// staged prebuilds/<os>-<arch>/gtk/) BEFORE any namespace is required: it prepends the
// bundle's typelib dir to the GIRepository search path env-free, so gi:// namespaces
// load with no Homebrew/system GTK. Darwin + win32 only; without a bundle the addon
// uses the host GTK as before.
try {
    activateBundledGtkRuntime(native);
} catch {
    // Never fatal: a missing/partial bundle just leaves the host GTK in charge.
}

// And where the LIBRARIES those typelibs name actually live. Separate from the
// call above because it is not about a bundle: it applies to whichever GTK the
// policy chose, and it is the only loader repair bun and deno get on macOS —
// the re-exec above is Node-shaped and skips them.
try {
    activateGiLibraryPath(native);
} catch {
    // Same contract as above: never fatal.
}

// Cross-runtime microtask checkpoint (Bun/Deno only). Node's napi_make_callback runs
// the nextTick + microtask checkpoint when its callback scope closes, so promise
// continuations queued by a loop-dispatched GLib→JS callback drain at the callback
// boundary even while a blocking GLib.MainLoop.run()/Gio.Application.run() owns the
// thread; GJS gets the same from SpiderMonkey draining the promise-job queue when the
// last JS frame exits. Bun and Deno checkpoint NOWHERE there (Deno's
// napi_make_callback is a plain Function::Call), and with their event loop paused for
// the blocking run's lifetime the queue never drained: an async DBus method handler
// never sent its reply and the client timed out, while sync handlers worked. So
// register the runtime's own drain primitive; the loop-dispatched trampolines
// (src/signals.cc / calls.cc / class.cc) invoke it after each OUTERMOST callback
// returns (NodeGiMaybeDrainMicrotasks).
if (!isNodeRuntime && RUNTIME !== 'gjs') {
    try {
        let drain = null;
        if (RUNTIME === 'bun') {
            // JSC: drains the VM's microtask queue; callable mid-stack by design
            // (Bun's own processTicksAndRejections calls it from JS).
            ({ drainMicrotasks: drain } = require('bun:jsc'));
        } else if (typeof globalThis.Deno?.internal === 'symbol') {
            // V8: the checkpoint needs BOTH queues. core.runMicrotasks is only
            // Isolate::PerformMicrotaskCheckpoint, while Deno's node-compat
            // process.nextTick queue is a SEPARATE deno_core queue that only the
            // runtime's own event loop drains — and that loop is paused for the whole
            // lifetime of a blocking run(). node:stream delivers 'end' via nextTick
            // (endReadableNT), so a microtask-only drain got body chunks but never the
            // end: every asset load hung at readyState 3 forever on Deno while the SAME
            // bundle settled on Bun, whose nextTick rides JSC's microtask queue.
            // core.runNextTicks covers both queues in one call, like node's
            // task_queues.js. Regression: test/blocking-run-checkpoint.test.mjs.
            const core = globalThis.Deno[globalThis.Deno.internal]?.core;
            if (typeof core?.runNextTicks === 'function') {
                drain = () => core.runNextTicks();
            } else if (typeof core?.runMicrotasks === 'function') {
                // Older deno_core without runNextTicks: promise continuations
                // settle, nextTick consumers like node:stream 'end' still starve.
                drain = () => core.runMicrotasks();
            }
        }
        if (typeof drain === 'function') native.setMicrotaskDrain(drain);
    } catch {
        // Unregistered ⇒ promise continuations drain only when the runtime's own loop
        // runs (startMainContextPump), so async DBus replies inside a BLOCKING run stay
        // unavailable. Never fatal — the sync surface is unaffected.
    }
}

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

export const logSetWriterFunc = native.logSetWriterFunc;
export const logSetWriterDefault = native.logSetWriterDefault;
export const bindPropertyFull = native.bindPropertyFull;
export const bindingGroupBindFull = native.bindingGroupBindFull;

export default native;
