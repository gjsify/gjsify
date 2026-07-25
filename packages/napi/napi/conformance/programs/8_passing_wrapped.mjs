// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/8_passing_wrapped/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises passing native-wrapped objects back into the addon: add(obj1,obj2)
// unwraps both and sums their native values; the wrap finalizer bumps
// finalizeCount() once each becomes unreachable (GC-driven — the regime
// test_finalizer is ledgered for).
export const meta = { dir: '8_passing_wrapped', targets: ['8_passing_wrapped'] };

export default async function run(h) {
    const addon = h.loadAddon('8_passing_wrapped');

    let obj1 = addon.createObject(10);
    let obj2 = addon.createObject(20);
    h.emit('add', addon.add(obj1, obj2));

    obj1 = null;
    obj2 = null;
    await h.gcUntil(() => addon.finalizeCount() === 2, 'both finalizers');
    h.emit('finalizeCount', addon.finalizeCount());
}
