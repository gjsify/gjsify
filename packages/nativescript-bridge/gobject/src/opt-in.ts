// The one call an app makes to put real GObject behind the subset — ADR 0105 § 4.
//
// `createRealGioEngine(requireGi)` builds the engine; `registerGObjectEngine` from the core is
// where a port finds it. This function is both, in the order that fails EARLY, and it is a
// separate module from `engine.ts` so that the engine stays importable without the slot.
//
// WHY IT MUST FAIL LOUDLY. The payload behind `requireGi` is `@gjsify/gi-runtime-android`'s AAR:
// `libnode_gi.so`, the GLib/GObject/Gio closure, the typelibs. An app that opted in and did not
// get it has a BUILD problem — a missing dependency, an `abiFilters` that dropped its ABI, a
// release that stripped `assets/app/girepository-1.0`. A try/catch around this that fell back to
// the pure-JS engine would turn that build problem into an app that works, differently, forever,
// and "which engine backs this subset" would stop being answerable from inside it. So the first
// thing this does is reach all the way through to a real `GObject`, and a failure propagates with
// the name of the package that was supposed to supply it.
//
// WHEN TO CALL IT. Before the port's module body runs, which in ESM means from a module imported
// BEFORE `@gjsify/adwaita-nativescript/gobject`:
//
// ```ts
// // app/engine-opt-in.ts
// import requireGi from '@gjsify/node-gi/gi';
// import { useRealGObjectEngine } from '@gjsify/adwaita-gobject-native';
// useRealGObjectEngine(requireGi);
//
// // app/app.ts
// import './engine-opt-in.js'; // FIRST — side-effect import, nothing below it may precede it
// import { Application } from '@gjsify/adwaita-nativescript';
// ```
//
// Calling it later throws rather than being ignored; the core's slot records that it was read.

import { registerGObjectEngine, type GObjectEngine } from '@gjsify/adwaita-core';

import { createRealGioEngine, type RequireGi } from './engine.js';

/** What a failed opt-in names, so the message points at a dependency and not at a stack frame. */
const PAYLOAD_PACKAGE = '@gjsify/gi-runtime-android';

/**
 * Builds the real-GObject engine over `requireGi` and registers it as THE engine of this app.
 * Returns it, so a caller that wants to assert on `engine.name` can.
 *
 * Throws — never falls back — when `requireGi` cannot produce GObject, and when the core's slot
 * was already read or already filled. The app passes `requireGi` itself (`@gjsify/node-gi/gi`'s
 * default export) for the reason in `engine.ts`' header: nothing in this package may import the
 * bridge statically.
 */
export function useRealGObjectEngine(requireGi: RequireGi): GObjectEngine {
    let engine: GObjectEngine;
    try {
        // `createRealGioEngine` resolves GObject eagerly, so this is the whole reachability proof:
        // the addon loaded, the closure resolved, `GObject-2.0.typelib` was found and parsed.
        engine = createRealGioEngine(requireGi);
    } catch (cause) {
        const error = new Error(
            `useRealGObjectEngine: real GObject is not reachable, so the opt-in cannot be honoured. ` +
                `requireGi('GObject', '2.0') failed — the app opted in but '${PAYLOAD_PACKAGE}' did not ` +
                'deliver: check that it is a dependency of the app, that the APK carries ' +
                "'lib/<abi>/libnode_gi.so' for this device's ABI, and that NativeScript extracted " +
                "'app/girepository-1.0' into the app's files dir. Remove the opt-in to run on pure JS.",
        );
        // `cause` by assignment and not `new Error(msg, { cause })`: this package's `lib` is
        // es2020, where neither the second argument nor `ErrorOptions` exists. The own property is
        // what the option sets anyway, and losing the underlying dlopen message would make a
        // wrong-ABI APK indistinguishable from a missing typelib.
        (error as { cause?: unknown }).cause = cause;
        throw error;
    }
    registerGObjectEngine(engine);
    return engine;
}
