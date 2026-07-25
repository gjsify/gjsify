// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_make_callback/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_make_callback (via napi_async_init / napi_async_destroy):
// binding.makeCallback(resource, recv, func, ...args) invokes func with `this`
// bound to recv and the trailing args, returning its result.
// DROPPED (noted): the vm.runInNewContext cross-realm cases (target/forward/
// endpoint) — GJS's `gjs -m` has no `vm` module and no second realm to check
// receiver-context Object identity across; the single-realm receiver + arg +
// return-value semantics are exercised in full.
export const meta = { dir: 'test_make_callback', targets: ['binding'], suite: 'node-api' };

export default async function run(h) {
    const binding = h.loadAddon('binding');
    const makeCallback = binding.makeCallback;

    // Arbitrary resource + receiver objects (upstream uses {} and `process`;
    // GJS has no `process`, and the addon only needs *an* object receiver).
    const resource = {};
    const recv = {};

    // Zero-arg call: `this === recv`, no arguments, returns 42.
    let a = { args: -1, thisOk: null };
    const r0 = makeCallback(resource, recv, function () {
        a = { args: arguments.length, thisOk: this === recv };
        return 42;
    });
    h.emit('no-arg', r0, 'args', a.args, 'this===recv', a.thisOk);

    // One-arg call.
    let b = { args: -1, thisOk: null, x: null };
    const r1 = makeCallback(resource, recv, function (x) {
        b = { args: arguments.length, thisOk: this === recv, x };
        return 42;
    }, 1337);
    h.emit('one-arg', r1, 'args', b.args, 'this===recv', b.thisOk, 'x', b.x);

    // Multi-arg call.
    let c = { args: -1, thisOk: null, vals: null };
    const r3 = makeCallback(resource, recv, function (arg1, arg2, arg3) {
        c = { args: arguments.length, thisOk: this === recv, vals: [arg1, arg2, arg3] };
        return 42;
    }, 1, 2, 3);
    h.emit('multi-arg', r3, 'args', c.args, 'this===recv', c.thisOk, 'vals', c.vals);
}
