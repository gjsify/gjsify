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
    // `gcUntil`, not one `h.gc()` and hope. Measured 40 runs on each leg: the
    // finalizer has NOT run by the time a synchronous collection returns, and one
    // turn of the runtime's own loop after it is enough — never a second
    // collection. So there is no "this finalizer needs several collections"
    // defect underneath; what the old shape lacked was a retry for the run where
    // that one collection does not reclaim the buffer, which is a real outcome
    // (run 32952785170 / job 98127767705) even though it did not reproduce in 30
    // local runs.
    //
    // This is the idiom, not a workaround for us: nine of upstream's own N-API
    // finalizer tests drive `test/common/gc.js`'s `gcUntil`, and the twin
    // `test_instance_data.mjs` here does too. The one that does a bare
    // `global.gc()` is `node-api/test_instance_data/test.js` — the file this was
    // ported from, so the flake came with it.
    //
    // The awaiting shape is what made the failure unreadable, and that half is
    // fixed in the runner: a pending promise is not work, so Node's loop ran dry
    // and the process exited 0 with two thirds of the transcript missing, which
    // the golden reported as DRIFT and offered `--update-golden` for.
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
