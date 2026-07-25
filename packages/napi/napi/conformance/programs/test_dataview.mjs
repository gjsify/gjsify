// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_dataview/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// NOTE: binding.gyp opts into NAPI_EXPERIMENTAL and references
// node_api_is_sharedarraybuffer — outside the Phase-0 non-experimental ABI, so
// the shim cannot dlopen it. Ledgered; Node produces the reference transcript.
export const meta = { dir: 'test_dataview', targets: ['test_dataview'] };

export default async function run(h) {
    const t = h.loadAddon('test_dataview');

    // napi_create_dataview from a JS DataView template.
    const buffer = new ArrayBuffer(128);
    const template = new DataView(buffer);
    const dv = t.CreateDataViewFromJSDataView(template);
    h.emit('fromJSDataView', dv instanceof DataView);

    // Invalid range → RangeError.
    h.emit('oob-range!', h.caughtName(() => t.CreateDataView(buffer, 10, 200)));
}
