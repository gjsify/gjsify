// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/4_object_factory/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// The module export IS a function (napi_create_function returned as exports)
// that builds a fresh object with a `msg` property per call.
export const meta = { dir: '4_object_factory', targets: ['4_object_factory'] };

export default async function run(h) {
    const addon = h.loadAddon('4_object_factory');
    const obj1 = addon('hello');
    const obj2 = addon('world');
    h.emit('msgs', `${obj1.msg} ${obj2.msg}`);
    h.emit('distinct', obj1 !== obj2);
}
