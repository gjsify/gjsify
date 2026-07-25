// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_callback_scope/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_async_init + napi_open_callback_scope + napi_call_function +
// napi_close_callback_scope + napi_async_destroy through runInCallbackScope:
// a value returned from the scoped callback comes back, and an error thrown in
// the scoped callback propagates out (upstream catches it via
// process.once('uncaughtException'); the deterministic equivalent is that the
// call re-throws it — the binding runs GET_AND_THROW_LAST_ERROR).
// The addon also links uv_queue_work (testResolveAsync, not called here); the
// harness preloads the host libuv so the addon resolves at dlopen.
export const meta = { dir: 'test_callback_scope', targets: ['binding'], suite: 'node-api', libuv: true };

export default async function run(h) {
    const { runInCallbackScope } = h.loadAddon('binding');

    h.emit('returns', runInCallbackScope({}, 'test-resource', () => 42));

    h.emit('throws', h.caughtFull(() => {
        runInCallbackScope({}, 'test-resource', () => {
            throw new Error('foo');
        });
    }));
}
