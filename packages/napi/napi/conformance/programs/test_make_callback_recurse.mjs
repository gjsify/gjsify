// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_make_callback_recurse/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises that napi_make_callback lets a thrown error propagate out (the
// binding leaves the exception pending and returns napi_pending_exception).
// DROPPED (noted): the verifyExecutionOrder section — it asserts the ordering
// of node's process.nextTick queue vs the MicrotaskQueue across setImmediate /
// setTimeout turns, an event-loop feature with no GJS analog (GJS has no
// process.nextTick / setImmediate and a different loop). Only the deterministic
// error-propagation contract is ported.
export const meta = { dir: 'test_make_callback_recurse', targets: ['binding'], suite: 'node-api' };

export default async function run(h) {
    const binding = h.loadAddon('binding');
    const makeCallback = binding.makeCallback;

    // The error thrown by the callback must surface as the caught error.
    h.emit(
        'propagates',
        h.caughtFull(() => {
            makeCallback({}, function () {
                throw new Error('hi from domain error');
            });
        }),
    );

    // A callback that does not throw returns its receiver (binding returns recv).
    const recv = {};
    h.emit('returns-recv', makeCallback(recv, function () {}) === recv);
}
