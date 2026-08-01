// SPDX-License-Identifier: MIT
// @gjsify/napi — PHASE 1 node-gi workout: the program the nodegi gate bundles
// with `gjsify build --app gjs` and runs under `gjs -m`.
//
// Exercises @gjsify/node-gi (a real N-API .node addon) THROUGH the shim on
// GJS: namespace load (the former startMainLoop/uv step is gated off in gjs
// host mode), GObject construction (MakeGObjectHandle → EnsureDrainAsync →
// napi_create_threadsafe_function), property read/write, signal connect +
// C-triggered emission (napi_make_callback), an off-thread ref/unref churn
// (node-gi's own GThread stress hook → NodeGiToggleNotify off-thread →
// WakeDrain → napi_call_threadsafe_function from a foreign thread while the
// JS thread pumps + forces full GCs), and wrapper collection (napi finalizer
// → node-gi teardown queue → tsfn dispatch → RunTeardown drops the toggle
// ref — observable via NODE_GI_TOGGLE_DEBUG on stderr).
//
// node-gi is imported RELATIVELY (worktree source, not a resolved package)
// so the bundle always exercises THIS repo's node-gi; the addon binary is
// pinned via NODE_GI_NATIVE (import.meta anchors at the bundle, so the
// package-relative prebuild probing cannot work in a bundled app).

import { requireGi } from '../../../node-gi/node-gi/gi.js';
import native, { RUNTIME } from '../../../node-gi/node-gi/index.js';

// GJS's own imports API — available in the host this bundle targets. Using
// the gjs-native GLib for the pump keeps the pump independent of the code
// under test.
const System = globalThis.imports.system;
const GjsGLib = globalThis.imports.gi.GLib;
const mctx = GjsGLib.MainContext.default();

const pump = (n = 25) => {
    for (let i = 0; i < n; i++) mctx.iteration(false);
};

console.log(`runtime=${RUNTIME}`);

// ---- namespace load (no startMainLoop / napi_get_uv_event_loop reached) ----
const Gio = requireGi('Gio', '2.0');
const GLib = requireGi('GLib', '2.0');
console.log(`ns=ok glib=${typeof GLib} gio=${typeof Gio}`);

// ---- GObject construct + properties (arms the drain tsfn) ----
let action = new Gio.SimpleAction({ name: 'probe', enabled: true });
console.log(`name=${action.name}`);
action.set_enabled(false);
console.log(`enabled-after-set=${action.enabled}`);

// ---- signals ----
// notify::enabled from a C-side property write reaches the marshal with no
// emitSignal frame below (depth 0) → the napi_make_callback path.
let notifyHits = 0;
action.connect('notify::enabled', () => {
    notifyHits++;
});
action.set_enabled(true);
// activate: a C emission triggered from JS (action.activate) — also depth 0.
let activateHits = 0;
action.connect('activate', () => {
    activateHits++;
});
action.activate(null);
action.activate(null);
console.log(`notify=${notifyHits} activate=${activateHits}`);

// ---- boxed structs (GLib.KeyFile) ----
const kf = new GLib.KeyFile();
kf.set_string('group', 'key', 'value');
const [str] = [kf.get_string('group', 'key')];
console.log(`keyfile=${str}`);

// ---- off-thread churn: foreign-thread napi_call_threadsafe_function ----
// node-gi's GThread stress hook drives NodeGiToggleNotify from a NON-main
// thread; each 1<->2 refcount crossing enqueues a toggle + WakeDrain — a
// foreign-thread tsfn call racing the JS thread, which meanwhile pumps the
// context and forces full GCs (the mid-GC scheduling window).
const CHURN = Math.max(100, Number(GjsGLib.getenv('NODEGI_GATE_CHURN') ?? '20000') || 20000);
const churned = native.newObject('Gio', 'SimpleAction', { name: 'churn', enabled: true });
native.__stressRefUnrefOffThread(churned, CHURN);
{
    const deadline = GjsGLib.get_monotonic_time() + 60_000_000; // 60 s wall
    let i = 0;
    while (native.__stressRefUnrefRunning()) {
        if (GjsGLib.get_monotonic_time() > deadline) {
            native.__stressRefUnrefStop();
            while (native.__stressRefUnrefRunning()) pump(5);
            break;
        }
        pump(5);
        if (++i % 7 === 0) System.gc();
    }
}
pump(50);
System.gc();
pump(50);
console.log(`churn-survivor=${native.isGObjectHandle(churned)} name=${native.callMethod(churned, 'get_name', [])}`);

// ---- wrapper collection → tsfn-dispatched teardown ----
// Drop every JS ref, force a full GC, and give the two idle hops their loop
// turns: napi finalizer drain (§5c) → node-gi teardown queue + WakeDrain →
// tsfn dispatch → RunTeardown (with NODE_GI_TOGGLE_DEBUG=1 this prints
// "drain: run teardown inst" on stderr — the gate's proof marker).
action = null;
for (let round = 0; round < 6; round++) {
    System.gc();
    pump(50);
}
console.log('teardown-pumped=1');

console.log('PHASE1 NODE-GI WORKOUT COMPLETE');
