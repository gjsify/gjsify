// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_instance_data/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_set_instance_data / napi_get_instance_data: a per-instance
// counter, and the same instance data reached from a napi_add_finalizer callback
// that then calls a stored JS reference.
// DROPPED from the upstream port: setPrintOnDelete + the "deleting addon data"
// line — printed by the env-teardown finalizer at process exit, after run()
// returns, so it cannot land deterministically in the transcript.
export const meta = { dir: 'test_instance_data', targets: ['test_instance_data'] };

export default async function run(h) {
    const addon = h.loadAddon('test_instance_data');

    h.emit('increment', addon.increment());

    // Scoped in an IIFE: the object must become unreachable for the finalizer —
    // and thus the stored JS reference it calls — to run.
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
