// SPDX-License-Identifier: MIT
// @gjsify/napi — one env-teardown claim-owner shape per run (fixture for
// test/tsfn-teardown-gate.mjs, which is the thing that asserts).
//
//   GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build gjs test/tsfn-teardown-case.js <shape>
//
// Every shape leaves the process with a KNOWN claim-owner situation and then
// returns, so what follows is env teardown (napi_env__::teardown → step 1b
// finalize_env_tsfns) and nothing else. The last line printed is
//
//   READY <shape> <CLOCK_MONOTONIC microseconds>
//
// which the driver subtracts from its own CLOCK_MONOTONIC reading at child exit
// to get the teardown cost alone — gjs startup and addon load are excluded, so
// the numbers are the teardown, not the process.
//
// Shapes:
//   clean      — a tsfn created, used and fully released before teardown; the
//                env has no tsfn left to close. Baseline.
//   self       — ONE initial claim kept by the JS thread and never released,
//                never used: nothing ever attributes it (unattributed_claims).
//   self-used  — same, but the JS thread pushes once first, which PROVES it
//                owns the claim (js_claims).
//   foreign    — ONE initial claim handed to a worker that pushes once (so it
//                is attributed foreign) and then parks forever without
//                releasing: the only shape that must still burn the deadline.
//   draining   — N initial claims, one per worker, each pushing in a loop; the
//                canonical Node shutdown shape (refs/node/test/node-api/
//                test_threadsafe_function_shutdown), which drains on the
//                napi_closing pushes the teardown close provokes.

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
const GLib = imports.gi.GLib;
const System = imports.system;
if (!GjsifyNapi.init()) throw new Error('GjsifyNapi.init() failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

const addon = loadAddon('test/tsfn-addon/build/Release/tsfn.node');
const ctx = GLib.MainContext.default();
const shape = ARGV[0] ?? 'clean';
const DRAIN_THREADS = 8;

// Iterate the default main context until `done()` or the wall timeout.
function drainUntil(done, timeoutMs = 10000) {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    while (!done()) {
        if (GLib.get_monotonic_time() > deadline) return false;
        ctx.iteration(false);
    }
    return true;
}

let hits = 0;
const cb = () => hits++;

switch (shape) {
    case 'clean':
        // 2 workers × 20 pushes, each releasing when done — thread_count hits 0
        // and the dispatch finalizes the tsfn well before teardown.
        addon.resetStats();
        addon.start(cb, 2, 20);
        if (!drainUntil(() => addon.stats()[0] === 40 && addon.stats()[2] === 1))
            throw new Error('clean: flood never completed');
        for (let i = 0; i < 20; i++) ctx.iteration(false);
        break;

    case 'self':
        addon.holdSelf(cb, false);
        break;

    case 'self-used':
        addon.resetStats();
        addon.holdSelf(cb, true);
        if (!drainUntil(() => addon.stats()[0] >= 1))
            throw new Error('self-used: the JS-thread push never landed');
        break;

    case 'foreign':
        addon.resetStats();
        addon.holdForeign(cb);
        // The worker must have pushed once before teardown, or its claim would
        // still be unattributed and the shape would not be what it says.
        if (!drainUntil(() => addon.stats()[0] >= 1))
            throw new Error('foreign: the worker push never landed');
        break;

    case 'draining':
        addon.resetStats();
        addon.holdDraining(cb, DRAIN_THREADS);
        // Wait until every worker has pushed at least once, so all N claims are
        // attributed foreign when teardown starts.
        if (!drainUntil(() => addon.stats()[0] >= DRAIN_THREADS))
            throw new Error('draining: workers never got going');
        break;

    default:
        printerr(`unknown shape '${shape}'`);
        System.exit(2);
}

print(`READY ${shape} ${GLib.get_monotonic_time()}`);
