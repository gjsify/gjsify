// SPDX-License-Identifier: MIT
// @gjsify/napi — P1 TSFN GATE (threadsafe functions from real foreign threads).
//
// Runs as a legacy GJS script:
//
//   cd packages/napi/napi
//   GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build timeout 60 gjs test/p1-tsfn-gate.js
//
// Adversarial coverage of the cross-thread crux:
//  - same-thread coalescing: max_queue_size=1 → second nonblocking call
//    returns napi_queue_full (node-gi WakeDrain's exact expectation);
//  - nonblocking flood from 8 pthreads (unbounded queue) with forced FULL
//    GCs interleaved on the JS thread while the producers hammer — a foreign
//    thread scheduling a dispatch mid-GC must be safe (GSource attach runs no
//    JSAPI); exact-delivery accounting (delivered == threads * calls, JS
//    callback hits == delivered);
//  - blocking pushes against a queue capped at 2 (cond-wait + drain);
//  - release(abort) racing producers that are actively pushing: the closing
//    push consumes each worker's claim (Node semantics), leftover queue
//    items get the env==NULL free-data-only drain, the finalizer runs.

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
const GLib = imports.gi.GLib;
const System = imports.system;
if (!GjsifyNapi.init()) throw new Error('GjsifyNapi.init() failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

const addon = loadAddon('test/tsfn-addon/build/Release/tsfn.node');
const ctx = GLib.MainContext.default();

// The valgrind leg divides the workload (memcheck is ~30x slower; the gate
// asserts EXACT counts either way, so a scaled run proves the same thing).
const SCALE = Math.max(1, Number(GLib.getenv('TSFN_GATE_SCALE') ?? '1') || 1);
const TIMEOUT_MS = SCALE > 1 ? 240000 : 30000;

let failures = 0;
function check(name, cond) {
    if (!cond) {
        failures++;
        printerr(`FAIL ${name}`);
    } else {
        print(`ok ${name}`);
    }
}

// Iterate the main context until `done()` or the wall timeout. `gcEvery`
// forces a full GC every N iterations — the mid-GC foreign-thread window.
function drainUntil(done, { timeoutMs = TIMEOUT_MS, gcEvery = 0 } = {}) {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    let i = 0;
    while (!done()) {
        if (GLib.get_monotonic_time() > deadline) return false;
        ctx.iteration(false);
        if (gcEvery > 0 && ++i % gcEvery === 0) System.gc();
    }
    return true;
}

// ---- leg 1: same-thread coalescing (max_queue_size = 1) ----
let pairHits = 0;
const [firstOk, secondFull] = addon.callPair(() => pairHits++);
check('coalescing: first nonblocking call is napi_ok', firstOk);
check('coalescing: second nonblocking call is napi_queue_full', secondFull);
// The queued item is still delivered before the natural-close finalize.
check(
    'coalescing: queued item delivered on the loop turn',
    drainUntil(() => pairHits === 1),
);
check('coalescing: delivered exactly once', pairHits === 1);

// ---- leg 2: nonblocking flood from 8 threads + GC churn ----
const THREADS = 8;
const CALLS = Math.max(50, Math.floor(5000 / SCALE));
addon.resetStats();
let floodHits = 0;
addon.start(() => floodHits++, THREADS, CALLS);
check(
    'flood: all items delivered under GC churn',
    drainUntil(
        () => {
            const [delivered, , finalized] = addon.stats();
            return delivered === THREADS * CALLS && finalized === 1;
        },
        { gcEvery: 7 },
    ),
);
{
    const [delivered, dropped] = addon.stats();
    check('flood: exact delivery (no loss, no dupes)', delivered === THREADS * CALLS);
    check('flood: JS callback hit for every item', floodHits === delivered);
    check('flood: nothing dropped', dropped === 0);
}

// ---- leg 3: blocking pushes against a queue capped at 2 ----
addon.resetStats();
let blockHits = 0;
const BCALLS = Math.max(20, Math.floor(500 / SCALE));
addon.startBlocking(() => blockHits++, 4, BCALLS);
check(
    'blocking: all items delivered through the bounded queue',
    drainUntil(
        () => {
            const [delivered, , finalized] = addon.stats();
            return delivered === 4 * BCALLS && finalized === 1;
        },
        { gcEvery: 13 },
    ),
);
check('blocking: JS callback hit for every item', blockHits === 4 * BCALLS);

// ---- leg 4: release(abort) racing active producers ----
addon.resetStats();
let spinHits = 0;
addon.startSpin(() => spinHits++, 8);
// Let the race actually run: producers hammering, dispatches + GCs landing.
const spinUntil = GLib.get_monotonic_time() + 200 * 1000;
let spins = 0;
while (GLib.get_monotonic_time() < spinUntil) {
    ctx.iteration(false);
    if (++spins % 17 === 0) System.gc();
}
addon.abortSpin();
check(
    'abort: finalizer runs after aborting under load',
    drainUntil(() => addon.stats()[3] === 1, { gcEvery: 11 }),
);
print(`abort: delivered=${addon.stats()[0]} dropped=${addon.stats()[1]} jsHits=${spinHits}`);

// Post-abort settle: any straggler sources must be inert.
for (let i = 0; i < 50; i++) ctx.iteration(false);
System.gc();
for (let i = 0; i < 50; i++) ctx.iteration(false);

if (failures > 0) {
    printerr(`P1 TSFN GATE: FAIL (${failures})`);
    System.exit(1);
}
print('P1 TSFN GATE: PASS');
