// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_async/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// The node_api.h async_work test: napi_create_async_work + napi_queue_async_work
// (Execute on a worker, Complete on the loop), plus napi_cancel_async_work.
//   • Test(input, resource, cb)  — Execute doubles input, Complete calls cb.
//   • DoRepeatedWork(cb)         — empty Execute, Complete reports its status.
//   • TestCancel(cb)             — saturates the libuv pool, queues one more
//                                  work, cancels it; the cancel Complete fires
//                                  with napi_cancelled → cb.
// The addon #includes <uv.h>; the harness preloads the host libuv for dlopen.
export const meta = { dir: 'test_async', targets: ['test_async'], suite: 'node-api', libuv: true };

export default async function run(h) {
    const t = h.loadAddon('test_async');

    // Successful async execution + completion callback (Execute doubles input).
    await new Promise((resolve) => {
        t.Test(5, {}, (err, val) => {
            h.emit('Test', err, val);
            resolve();
        });
    });

    // Repeated work: the completion callback reports its status code (0 = ok).
    await new Promise((resolve) => {
        t.DoRepeatedWork((status) => {
            h.emit('DoRepeatedWork', status);
            resolve();
        });
    });

    // Async work item cancellation: the cancel completion runs with
    // napi_cancelled, which drives the callback.
    await new Promise((resolve) => {
        t.TestCancel(() => {
            h.emit('TestCancel');
            resolve();
        });
    });

    h.emit('ok');
}
