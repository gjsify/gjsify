// SPDX-License-Identifier: MIT
// @gjsify/node-gi — cross-runtime checkpoint coverage for a BLOCKING GLib run.
//
// Regression for the Deno XHR/fetch hang (excalibur-jelly-jumper stuck on the
// loading screen at 0% forever): the per-runtime drain registered via
// setMicrotaskDrain must cover BOTH continuation queues, not just the V8
// microtask queue —
//
//   - microtasks (promise continuations, queueMicrotask)
//   - the node-compat process.nextTick queue
//
// node:stream delivers stream 'end' via process.nextTick (endReadableNT), so a
// Readable consumed inside a blocking GLib.MainLoop.run() gets its data chunks
// (microtask-delivered) but never the end unless the nextTick queue drains at
// the dispatch boundary. That is exactly how @gjsify/fetch's consumeBody — and
// with it every XMLHttpRequest arrayBuffer()/text() — hung at readyState 3 on
// Deno, while the SAME bundle settled on Bun (whose nextTick rides JSC's
// microtask queue) and Node (whose napi_make_callback checkpoint runs the tick
// queue natively). On Deno the queues are separate: core.runMicrotasks is only
// Isolate::PerformMicrotaskCheckpoint, and the nextTick queue
// (ext:deno_node/_next_tick.ts → core.queueNextTick) is drained by
// core.runNextTicks — index.js must register the latter.
//
// The blocking run is entered from a macrotask (setTimeout), mirroring
// Gio.Application.runAsync's deferral — entering it from the test callback's
// own async scope would hit the documented V8 nested-checkpoint caveat (see
// mainloop.test.mjs) and measure the wrong thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { requireGi } from '../gi.js';

test('microtasks, nextTick and stream end drain during a blocking MainLoop.run()', async () => {
    const GLib = requireGi('GLib', '2.0');

    const duringRun = await new Promise((resolve, reject) => {
        setTimeout(() => {
            try {
                const fired = [];
                const loop = GLib.MainLoop.new(null, false);
                let quitted = false;
                const quit = () => {
                    if (quitted) return;
                    quitted = true;
                    loop.quit();
                };

                // Schedule the continuations FROM a GLib dispatch inside the
                // run — the XHR shape: fetch settles from a GLib-driven
                // callback, then its promise chain + stream consumption must
                // advance while the loop still owns the thread.
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
                    queueMicrotask(() => fired.push('microtask'));
                    process.nextTick(() => fired.push('nextTick'));
                    (async () => {
                        for await (const chunk of Readable.from(Buffer.from('jelly'))) {
                            fired.push(`chunk:${chunk.length}`);
                        }
                        fired.push('end');
                        quit();
                    })();
                    return false;
                });

                // Failsafe deadline: without the tick drain the stream never
                // ends, so quit() above never runs — end the run here so the
                // assertions below can REPORT the starvation instead of the
                // whole test timing out.
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                    quit();
                    return false;
                });

                loop.run(); // blocks; continuations must drain in here
                resolve([...fired]); // snapshot at the moment run() returned
            } catch (err) {
                reject(err);
            }
        }, 10);
    });

    for (const expected of ['microtask', 'nextTick', 'chunk:5', 'end']) {
        assert.ok(
            duringRun.includes(expected),
            `'${expected}' must fire during the blocking run; fired: [${duringRun.join(', ')}]`,
        );
    }
});
