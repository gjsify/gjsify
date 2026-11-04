// SPDX-License-Identifier: MIT
// @gjsify/napi — weak-sweep stress (#2535): many weak refs, most die in ONE
// GC. The sweep and the finalizer queue must stay linear in the dead count
// (they were O(n*d)); correctness is asserted, the time is printed.
//
//   cd packages/napi/napi
//   GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build timeout 120 gjs test/p05-weak-sweep.js

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
const GLib = imports.gi.GLib;
if (!GjsifyNapi.init()) throw new Error('GjsifyNapi.init() failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

const t = loadAddon('test/lifetime-addon/build/Release/lifetime.node');

const N = 40000; // wrapped objects (each a weak ref with a finalizer)
const KEEP_EVERY = 4; // every 4th stays alive
let failures = 0;
function check(name, actual, expected) {
    if (!Object.is(actual, expected)) {
        failures++;
        printerr(`FAIL ${name}: got ${String(actual)}, expected ${String(expected)}`);
    }
}

const survivors = [];
// Own frame: a loop local of the script would keep the last object alive.
function populate() {
    for (let i = 0; i < N; i++) {
        const o = { i };
        t.wrapCount(o);
        if (i % KEEP_EVERY === 0) survivors.push(o);
    }
}
populate();
const dead = N - survivors.length;

const t0 = GLib.get_monotonic_time();
imports.system.gc();
const sweepMs = (GLib.get_monotonic_time() - t0) / 1000;

const ctx = GLib.MainContext.default();
const t1 = GLib.get_monotonic_time();
while (ctx.iteration(false)) {
    /* drain the finalizer queue */
}
const drainMs = (GLib.get_monotonic_time() - t1) / 1000;

check('every dead object finalized exactly once', t.countFinalized(), dead);
for (const o of survivors) {
    if (t.unwrapId(o) !== 0) {
        failures++;
        printerr('FAIL survivor lost its wrap');
        break;
    }
}

// Second round after survivors drop: the compacted weak set must still work.
survivors.length = 0;
imports.system.gc();
while (ctx.iteration(false)) {
    /* drain */
}
check('survivors finalized after release', t.countFinalized(), N);

print(`weak-sweep: n=${N} dead=${dead} gc=${sweepMs.toFixed(0)}ms drain=${drainMs.toFixed(0)}ms`);
if (failures > 0) throw new Error(`${failures} check(s) failed`);
print('P0.5 WEAK SWEEP: PASS');
