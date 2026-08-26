// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_instance_data/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Instance data reached from an async_work completion callback, from a
// node::Buffer (napi_create_external_buffer) finalizer, and from a
// threadsafe-function callback. Named na_* to avoid colliding with the
// js-native-api test_instance_data program. The addon #includes <uv.h>; the
// harness preloads the host libuv for dlopen.
export const meta = { dir: 'test_instance_data', targets: ['test_instance_data'], suite: 'node-api', libuv: true };

export default async function run(h) {
    const t = h.loadAddon('test_instance_data');

    // One marker per stage: a hang here reports which of the three awaits
    // never returned, instead of a single 'ok' making all three
    // indistinguishable in a stalled run (status/open-todos.md).

    // Instance data from an async_work completion callback.
    await new Promise((resolve) => t.asyncWorkCallback(resolve));
    h.emit('async-work');

    // Instance data from a node::Buffer (external buffer) finalizer.
    //
    // `gcUntil`, not one `h.gc()` plus hope: a single collection does not
    // reliably reclaim an external buffer, and Node schedules the JS finalizer on
    // the immediate tick rather than the microtask queue. When it did not run, the
    // await never returned and the program died after line 1 — the golden then
    // "drifted" with `got: ""` against `want: "\"finalizer\""`, which reads like a
    // wrong answer rather than a missing one (measured: run 32952785170, job
    // 98127767705; earlier occurrences reported the same shape at other lines).
    // The green sibling `test_instance_data.mjs` already does it this way, and
    // gcUntil's budget turns a hang into a throw that names the stage.
    let finalized = false;
    t.testBufferFinalizer(() => {
        finalized = true;
    });
    await h.gcUntil(() => finalized, 'external buffer finalizer via instance data');
    h.emit('finalizer');

    // Instance data from a threadsafe-function callback.
    await new Promise((resolve) => t.testThreadsafeFunction(() => {}, resolve));
    h.emit('tsfn');

    h.emit('ok');
}
