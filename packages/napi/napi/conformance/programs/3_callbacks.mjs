// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/3_callbacks/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_call_function: a global-recv call passing "hello world",
// and RunCallbackWithRecv binding `this` to each receiver value. ES-module
// (strict) callbacks so a primitive `this` is NOT boxed — matching the
// upstream strict-mode test where `this === recv`.
export const meta = { dir: '3_callbacks', targets: ['3_callbacks'] };

export default async function run(h) {
    const addon = h.loadAddon('3_callbacks');

    let msg;
    addon.RunCallback((m) => {
        msg = m;
    });
    h.emit('RunCallback.msg', msg);

    for (const recv of [undefined, null, 5, true, 'Hello', [], {}]) {
        let argCount = -1;
        let sameThis = null;
        addon.RunCallbackWithRecv(function () {
            argCount = arguments.length;
            sameThis = this === recv;
        }, recv);
        h.emit('recv', h.fmt(recv), 'args', argCount, 'this===recv', sameThis);
    }
}
