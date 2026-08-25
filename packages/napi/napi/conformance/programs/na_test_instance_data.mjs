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
    await new Promise((resolve) => {
        t.testBufferFinalizer(resolve);
        h.gc();
    });
    h.emit('finalizer');

    // Instance data from a threadsafe-function callback.
    await new Promise((resolve) => t.testThreadsafeFunction(() => {}, resolve));
    h.emit('tsfn');

    h.emit('ok');
}
