// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_reference_double_free/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// The upstream test makes NO assertions: it constructs two wrapped objects
// (one whose constructor calls napi_remove_wrap + napi_delete_reference in
// sequence — the double-free path being guarded) and passes iff the process
// does not crash. We construct both, force GC to run any finalizers, then
// emit a single stable marker: identical "ok" on both runtimes ⇒ no crash.
export const meta = { dir: 'test_reference_double_free', targets: ['test_reference_double_free'] };

export default async function run(h) {
    const addon = h.loadAddon('test_reference_double_free');

    {
        new addon.MyObject(true);
    }
    {
        new addon.MyObject(false);
    }

    // Give any finalizer / deferred free a chance to run — a double free would
    // abort here rather than reach the marker.
    for (let i = 0; i < 10; i++) h.gc();

    h.emit('ok');
}
