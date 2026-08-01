// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_number/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Rewritten as a runtime-agnostic conformance program: prints a deterministic
// transcript of every create/extract round-trip + the documented truncation
// semantics. Golden = Node; GJS-under-shim must match byte-for-byte.
export const meta = { dir: 'test_number', targets: ['test_number'] };

export default async function run(h) {
    const t = h.loadAddon('test_number');

    // napi_create_double round-trips (exact, incl. -0/NaN/Infinity/precision loss).
    const nums = [
        0,
        -0,
        1,
        -1,
        100,
        2121,
        -1233,
        986583,
        -976675,
        // The next two are the ported fixture's out-of-double-range integers (see the
        // file header). Their rounding IS the thing under test: the transcript records
        // how napi_create_double/napi_get_value_double degrade them, and GJS-under-shim
        // must match Node byte-for-byte. Rewriting them to representable values, or to
        // BigInt literals (a different napi entry point), would delete the assertion.
        // oxlint-disable-next-line eslint/no-loss-of-precision -- the lossy literal is the fixture
        98765432213456789876546896323445679887645323232436587988766545658,
        // oxlint-disable-next-line eslint/no-loss-of-precision -- the lossy literal is the fixture
        -4350987086545760976737453646576078997096876957864353245245769809,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER + 10,
        Number.MIN_VALUE,
        Number.MAX_VALUE,
        Number.MAX_VALUE + 10,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN,
    ];
    for (const n of nums) h.emit('Test', h.fmt(n), '=>', t.Test(n));

    // napi_get_value_uint32 truncation.
    for (const n of [0.0, -0.0, 4294967295, 4294967296, 4294967297, 17 * 4294967296 + 1, -1])
        h.emit('Uint32', h.fmt(n), '=>', t.TestUint32Truncation(n));

    // napi_get_value_int32 truncation.
    for (const n of [
        0.0,
        -0.0,
        -Math.pow(2, 31),
        Math.pow(2, 31) - 1,
        4294967297,
        4294967296,
        4294967295,
        4294967296 * 5 + 3,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        -Math.pow(2, 63) + (Math.pow(2, 9) + 1),
        Math.pow(2, 63) - (Math.pow(2, 9) + 1),
        -Number.MIN_VALUE,
        Number.MIN_VALUE,
        -Number.MAX_VALUE,
        Number.MAX_VALUE,
        -Math.pow(2, 63) + Math.pow(2, 9),
        Math.pow(2, 63) - Math.pow(2, 9),
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN,
    ])
        h.emit('Int32', h.fmt(n), '=>', t.TestInt32Truncation(n));

    // napi_get_value_int64 truncation (incl. the out-of-range sentinel semantics).
    for (const n of [
        0.0,
        -0.0,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        -Math.pow(2, 63) + (Math.pow(2, 9) + 1),
        Math.pow(2, 63) - (Math.pow(2, 9) + 1),
        -Number.MIN_VALUE,
        Number.MIN_VALUE,
        -Number.MAX_VALUE,
        Number.MAX_VALUE,
        -Math.pow(2, 63) + Math.pow(2, 9),
        Math.pow(2, 63) - Math.pow(2, 9),
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NaN,
    ])
        h.emit('Int64', h.fmt(n), '=>', t.TestInt64Truncation(n));
}
