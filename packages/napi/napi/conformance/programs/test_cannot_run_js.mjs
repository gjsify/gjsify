// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_cannot_run_js/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// createRef() registers a strong-referenced JS function whose finalizer, run at
// environment shutdown, calls napi_get_named_property(global, "setTimeout") and
// asserts it returns napi_cannot_run_js || napi_ok (NAPI_VERSION 10) or
// napi_pending_exception || napi_ok (NAPI_VERSION 9). Two targets built from one
// source pin the version-dependent status.
// LEDGERED: the shim runs env-teardown finalizers with JS still callable (the
// node-gi SIGSEGV-avoidance discipline — finalizers may create values), so it
// has no can_call_into_js gate returning napi_cannot_run_js /
// napi_pending_exception during teardown. Ported faithfully so the Node golden
// pins the intended behavior.
export const meta = { dir: 'test_cannot_run_js', targets: ['test_cannot_run_js', 'test_pending_exception'] };

export default async function run(h) {
    const addonNew = h.loadAddon('test_cannot_run_js'); // NAPI_VERSION 10
    const addonV8 = h.loadAddon('test_pending_exception'); // NAPI_VERSION 9

    // The ref finalizer is the whole test: no JS callback may run, so these
    // emit an extra line — and fail the diff — if one ever does.
    addonNew.createRef(() => h.emit('MUST-NOT-CALL new'));
    addonV8.createRef(() => h.emit('MUST-NOT-CALL v8'));

    h.emit('ok');
}
