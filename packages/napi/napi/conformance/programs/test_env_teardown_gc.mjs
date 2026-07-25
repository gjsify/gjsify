// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_env_teardown_gc/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// A napi_wrap finalizer (MyObject_fini) that calls BACK into JS — it looks up
// `cleanup` on the global object and invokes it, tolerating either napi_ok or
// napi_pending_exception (it may not be allowed to run JS during teardown).
// Upstream stores the instance on `global.it` and a `global.cleanup` that drops
// it + gc()s, then lets the environment tear down. The deterministic port drops
// the strong reference and GC-drives the finalizer, observing that it reached
// (and called) `cleanup`.
export const meta = { dir: 'test_env_teardown_gc', targets: ['binding'], suite: 'node-api' };

export default async function run(h) {
    const binding = h.loadAddon('binding');

    let cleanupCalled = false;
    // The finalizer resolves `cleanup` off the global object (napi_get_global).
    globalThis.cleanup = () => {
        cleanupCalled = true;
        globalThis.it = undefined;
    };
    globalThis.it = new binding.MyObject();
    globalThis.it = undefined; // drop the only strong reference

    await h.gcUntil(() => cleanupCalled, 'wrap finalizer calls into JS');
    h.emit('cleanup-called', cleanupCalled);

    delete globalThis.cleanup;
}
