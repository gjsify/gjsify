// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/2_function_arguments/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_get_cb_info arg extraction + napi_create_double/int (add).
export const meta = { dir: '2_function_arguments', targets: ['2_function_arguments'] };

export default async function run(h) {
    const addon = h.loadAddon('2_function_arguments');
    h.emit('add(3,5)', addon.add(3, 5));
}
