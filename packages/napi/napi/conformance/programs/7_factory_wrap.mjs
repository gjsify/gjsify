// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/7_factory_wrap/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_define_class + napi_wrap through a factory (createObject),
// the wrapped native counter (plusOne), and the wrap finalizer running on GC
// (finalizeCount accessor). The finalizer-on-GC leg is what test_finalizer is
// ledgered for; kept faithful here so this program tracks that regime too.
export const meta = { dir: '7_factory_wrap', targets: ['7_factory_wrap'] };

export default async function run(h) {
    const test = h.loadAddon('7_factory_wrap');

    h.emit('finalizeCount.start', test.finalizeCount);

    (() => {
        const obj = test.createObject(10);
        h.emit('plusOne', obj.plusOne(), obj.plusOne(), obj.plusOne());
    })();
    await h.gcUntil(() => test.finalizeCount === 1, 'first finalizer');
    h.emit('finalizeCount.after1', test.finalizeCount);

    (() => {
        const obj2 = test.createObject(20);
        h.emit('plusOne2', obj2.plusOne(), obj2.plusOne(), obj2.plusOne());
    })();
    await h.gcUntil(() => test.finalizeCount === 2, 'second finalizer');
    h.emit('finalizeCount.after2', test.finalizeCount);
}
