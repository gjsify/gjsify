// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_instance_data/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// The node_api.h instance-data test: instance data reached from an async_work
// completion callback, from a node::Buffer (napi_create_external_buffer)
// finalizer, and from a threadsafe-function callback. It exercises capabilities
// deferred in Phase 0 (async_work is a loud stub; node::Buffer external buffers),
// so the GJS-under-shim leg is ledgered; ported faithfully so the Node golden
// pins the behavior. (Named na_* to avoid colliding with the js-native-api
// test_instance_data program.)
// The addon #includes <uv.h>; the harness preloads the host libuv for dlopen.
export const meta = { dir: 'test_instance_data', targets: ['test_instance_data'], suite: 'node-api', libuv: true };

export default async function run(h) {
    const t = h.loadAddon('test_instance_data');

    // Instance data from an async_work completion callback.
    await new Promise((resolve) => t.asyncWorkCallback(resolve));

    // Instance data from a node::Buffer (external buffer) finalizer.
    await new Promise((resolve) => {
        t.testBufferFinalizer(resolve);
        h.gc();
    });

    // Instance data from a threadsafe-function callback.
    await new Promise((resolve) => t.testThreadsafeFunction(() => {}, resolve));

    h.emit('ok');
}
