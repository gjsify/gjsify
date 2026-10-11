// THE GOBJECT VECTORS, ON THE DEVICE, AGAINST THE ENGINE THIS APP ACTUALLY GOT.
//
// `driveGObjectVectors` and `createSubsetSubject` are both imported, not re-made: the subject is
// the shipped one (`@gjsify/adwaita-gobject-native/src/vector-subject.ts`), the same door the CI
// leg drives in `engine.node-gi.spec.ts`. The only difference between the two legs is where
// `requireGi` comes from — a desktop GI stack there, the APK's `libnode_gi.so` here — which is the
// claim ADR 0105 stage 4 makes about the plugin: it adds a payload, not a dialect.
//
// THE ENGINE IS THE REGISTERED ONE, not a freshly built one. `registeredEngine()` is what the port
// built its namespace on, so the rows run against the engine this app is really using; a second
// `createRealGioEngine(requireGi)` would pass the same rows while saying nothing about the app.
// In the control run the slot is empty and the engine is the core's own `PURE_JS_ENGINE` — the
// same 24 rows, so the two runs are comparable row by row and differ in one thing only.
import { PURE_JS_ENGINE, registeredEngine, type GObjectEngine } from '@gjsify/adwaita-core';
import { driveGObjectVectors } from '@gjsify/adwaita-core/conformance';
import { createSubsetSubject, SUBSET_SUBJECT_NAME } from '@gjsify/adwaita-gobject-native';

import { describe, expect, it } from '../reporter.js';

/** The engine the app is backed by, named so the logcat suite line says which run this was. */
function appEngine(): { engine: GObjectEngine; label: string } {
    const registered = registeredEngine();
    return registered === undefined
        ? { engine: PURE_JS_ENGINE, label: 'adwaita-core on the default engine (no opt-in)' }
        : { engine: registered, label: SUBSET_SUBJECT_NAME };
}

export default async function gobjectVectors(): Promise<void> {
    const { engine, label } = appEngine();
    await driveGObjectVectors(createSubsetSubject(engine, `${label}, on an Android device`), {
        describe,
        expect,
        it,
    });
}
