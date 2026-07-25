// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/5_function_factory/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// The module export is a factory function that returns another native
// function; calling the returned function yields "hello world".
export const meta = { dir: '5_function_factory', targets: ['5_function_factory'] };

export default async function run(h) {
    const addon = h.loadAddon('5_function_factory');
    const fn = addon();
    h.emit('typeof fn', typeof fn);
    h.emit('fn()', fn());
}
