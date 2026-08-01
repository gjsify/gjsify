// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_sharedarraybuffer/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises node_api_is_sharedarraybuffer / node_api_create_sharedarraybuffer +
// napi_get_arraybuffer_info over a SharedArrayBuffer. Ledgered: (1) the addon
// opts into NAPI_EXPERIMENTAL and references the experimental node_api SAB
// symbols, outside the Phase-0 non-experimental ABI, so it will not dlopen
// under the shim; and (2) GJS disables shared memory at the realm level, so
// `SharedArrayBuffer` is not even defined in the JS global — the test cannot run
// on GJS regardless. Ported faithfully so the Node golden pins the semantics.
export const meta = { dir: 'test_sharedarraybuffer', targets: ['test_sharedarraybuffer'] };

export default async function run(h) {
    const t = h.loadAddon('test_sharedarraybuffer');

    const sab = new SharedArrayBuffer(16);
    const ab = new ArrayBuffer(16);
    h.emit(
        'is-sab',
        t.TestIsSharedArrayBuffer(sab),
        t.TestIsSharedArrayBuffer(ab),
        t.TestIsSharedArrayBuffer({}),
        t.TestIsSharedArrayBuffer([]),
        t.TestIsSharedArrayBuffer(null),
        t.TestIsSharedArrayBuffer(undefined),
    );

    const created = t.TestCreateSharedArrayBuffer(16);
    h.emit('create', created instanceof SharedArrayBuffer, created.byteLength);

    h.emit('info', t.TestGetSharedArrayBufferInfo(new SharedArrayBuffer(32)));

    const data8 = new SharedArrayBuffer(8);
    const ok = t.TestSharedArrayBufferData(data8);
    const view = new Uint8Array(data8);
    let filled = true;
    for (let i = 0; i < 8; i++) if (view[i] !== i % 256) filled = false;
    h.emit('data', ok, filled);

    const zero = t.TestCreateSharedArrayBuffer(0);
    h.emit('zero', zero instanceof SharedArrayBuffer, zero.byteLength);

    h.emit(
        'invalid',
        h.caughtFull(() => t.TestGetSharedArrayBufferInfo({})),
    );
}
