// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_general/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// NOTE: binding.gyp opts into NAPI_EXPERIMENTAL and references
// node_api_post_finalizer — outside the Phase-0 non-experimental ABI, so the
// shim cannot dlopen it. Ledgered; Node produces the reference transcript.
export const meta = { dir: 'test_general', targets: ['test_general'] };

export default async function run(h) {
    const t = h.loadAddon('test_general');

    // napi_strict_equals.
    const v1 = '1';
    const v2 = 1;
    const v3 = 1;
    h.emit('strictEquals(v1,v1)', t.testStrictEquals(v1, v1));
    h.emit('strictEquals(v1,v2)', t.testStrictEquals(v1, v2));
    h.emit('strictEquals(v2,v3)', t.testStrictEquals(v2, v3));

    // napi_get_prototype.
    const base = {};
    const extended = Object.create(base);
    h.emit('getPrototype(base)', t.testGetPrototype(base) === Object.getPrototypeOf(base));
    h.emit('getPrototype(extended)', t.testGetPrototype(extended) === Object.getPrototypeOf(extended));

    // napi_get_version.
    h.emit('getVersion', t.testGetVersion());

    // napi_typeof over the value kinds.
    for (const [lbl, v] of [
        ['undefined', undefined],
        ['null', null],
        ['true', true],
        ['1', 1],
        ["'s'", 's'],
        ['sym', Symbol('s')],
        ['{}', {}],
        ['fn', () => {}],
    ])
        h.emit('typeof', lbl, t.testNapiTypeof(v) === typeof v);

    // napi_get_undefined / napi_get_null.
    h.emit('getUndefined', t.getUndefined() === undefined);
    h.emit('getNull', t.getNull() === null);

    // napi_instanceof.
    h.emit('instanceof(Array)', t.doInstanceOf([], Array));
    h.emit('instanceof(Object)', t.doInstanceOf({}, Array));
}
