// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_function/test.js
// Original: Copyright (c) Node.js contributors. MIT.
export const meta = { dir: 'test_function', targets: ['test_function'] };

export default async function run(h) {
    const t = h.loadAddon('test_function');

    // napi_call_function forwards args + return value.
    h.emit('TestCall(()=>1)', t.TestCall(() => 1));
    // upstream func2 also console.log's — that side effect is not asserted, so
    // it is dropped to keep the transcript deterministic (return value IS asserted).
    h.emit('TestCall(()=>null)', t.TestCall(() => null));
    h.emit('TestCall(x=>x+1,1)', t.TestCall((x) => x + 1, 1));
    h.emit('TestCall(nested,1)', t.TestCall((x) => ((y) => y + 1)(x), 1));

    // napi_create_function names.
    h.emit('TestName.name', t.TestName.name);
    h.emit('TestNameShort.name', t.TestNameShort.name);

    // Finalizer-tracked function: creatable + collectable (no crash).
    let tracked = t.MakeTrackedFunction(() => {});
    h.emit('MakeTrackedFunction.truthy', !!tracked);
    tracked = null;
    h.gc();
    h.emit('post-gc', 'ok');

    // The NULL-argument matrix for napi_create_function.
    const o = t.TestCreateFunctionParameters();
    h.emit('CreateFunctionParameters', Object.keys(o).sort().map((k) => `${k}=${o[k]}`).join('|'));

    // A callback returning while an exception is pending → propagated Error+code.
    const bad = (() => { try { t.TestBadReturnExceptionPending(); return 'no-throw'; } catch (e) { return `${e.name}|${e.code}`; } })();
    h.emit('TestBadReturnExceptionPending', bad);
}
