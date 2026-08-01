// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_instance_data/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_set_instance_data / napi_get_instance_data: the addon keeps a
// per-instance counter (increment) and reaches the same instance data from a
// napi_add_finalizer callback that then calls a stored JS reference.
// DROPPED (noted): setPrintOnDelete + the "deleting addon data" line — that is
// printed by the environment-teardown finalizer whose timing is not
// deterministic in-transcript (it fires at process exit, after run() returns).
export const meta = { dir: 'test_instance_data', targets: ['test_instance_data'] };

export default async function run(h) {
    const addon = h.loadAddon('test_instance_data');

    // Instance data reachable from a binding.
    h.emit('increment', addon.increment());

    // Instance data reachable from a finalizer, which then calls the stored
    // JS reference. The object must become unreachable for the finalizer (and
    // thus the callback) to run.
    let called = false;
    (() => {
        const obj = addon.objectWithFinalizer(() => {
            called = true;
        });
        h.emit('typeof obj', typeof obj);
    })();
    await h.gcUntil(() => called, 'finalizer callback via instance data');
    h.emit('finalizer-callback-ran', called);
}
