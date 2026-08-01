// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_finalizer/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// NOTE: exercises the in-GC finalizer regime (pure finalizer in the current
// tick + a JS finalizer in the next tick) — deferred in Phase 0, so ledgered.
export const meta = { dir: 'test_finalizer', targets: ['test_finalizer'] };

export default async function run(h) {
    const t = h.loadAddon('test_finalizer');

    // A "pure" (no-JS) finalizer must run during GC.
    (() => {
        const obj = {};
        t.addFinalizer(obj);
    })();
    for (let i = 0; i < 10; i++) {
        h.gc();
        if (t.getFinalizerCallCount() === 1) break;
    }
    h.emit('pure-finalizer.count', t.getFinalizerCallCount());

    // A JS-accessing finalizer runs in the next tick (via gcUntil).
    let jsCalled = false;
    (() => {
        const obj = {};
        t.addFinalizerWithJS(obj, () => {
            jsCalled = true;
        });
    })();
    await h.gcUntil(() => t.getFinalizerCallCount() === 2, 'JS finalizer');
    h.emit('js-finalizer.count', t.getFinalizerCallCount());
    h.emit('js-finalizer.called', jsCalled);
}
