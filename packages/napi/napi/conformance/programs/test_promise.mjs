// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_promise/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// common.mustCall/mustNotCall are replaced by explicit awaits + emitted
// settlement values (a settlement that never happens fails the diff).
export const meta = { dir: 'test_promise', targets: ['test_promise'] };

export default async function run(h) {
    const t = h.loadAddon('test_promise');

    // napi_create_promise + napi_resolve_deferred.
    const p1 = t.createPromise();
    t.concludeCurrentPromise(42, true);
    h.emit('resolve', await p1);

    // napi_reject_deferred.
    const p2 = t.createPromise();
    t.concludeCurrentPromise("It's not you, it's me.", false);
    h.emit(
        'reject',
        await p2.then(
            () => 'RESOLVED(bug)',
            (r) => r,
        ),
    );

    // Resolving with a thenable → adoption (chaining).
    const p3 = t.createPromise();
    t.concludeCurrentPromise(Promise.resolve('chained answer'), true);
    h.emit('chain', await p3);

    // napi_is_promise on a created deferred's promise.
    const p4 = t.createPromise();
    h.emit('isPromise(deferred)', t.isPromise(p4));
    t.concludeCurrentPromise(undefined, true);
    await p4;

    // napi_is_promise on a native rejected promise (+ reason round-trip).
    const rp = Promise.reject(-1);
    h.emit('isPromise(rejected)', t.isPromise(rp));
    h.emit('reject-reason', await rp.catch((r) => r));

    // Non-promises.
    for (const [lbl, v] of [
        ['2.4', 2.4],
        ["'str'", 'I promise!'],
        ['undefined', undefined],
        ['null', null],
        ['{}', {}],
    ])
        h.emit('isPromise', lbl, t.isPromise(v));
}
