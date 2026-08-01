// SPDX-License-Identifier: MIT
// 64-bit integer marshalling — the GJS-exact BigInt-in / Number-out contract,
// exercised against STOCK GLib/GObject APIs only (no GIMarshallingTests typelib),
// so `npm test` (which discovers test/) stays typelib-free and this file also runs
// on bun + deno. The exhaustive GIMarshallingTests specs live in
// gimarshalling/testGIMarshalling.port.mjs (the BigInt + Integer 64-bit sections).
//
// Regression it guards: passing a JS BigInt (or a Number too large for int64) as a
// 64-bit GI argument used to fatally ABORT the addon — the marshaller called
// ToNumber() on the BigInt, which sets a pending N-API error under
// NAPI_DISABLE_CPP_EXCEPTIONS, and the follow-up Napi::Error::New became a process
// abort (exit 134). The marshaller now branches on IsBigInt FIRST and reads it
// losslessly (JS::ToBigInt64 / ToBigUint64), exactly like GJS
// (refs/gjs/gi/js-value-inl.h:126-146). On OUT, a 64-bit value ALWAYS comes back as
// a JS Number (never a BigInt) and, when it exceeds ±2^53, emits GJS's
// "cannot be safely stored" g_warning (refs/gjs/gi/arg-inl.h:224).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { requireGi } from '../gi.js';
import { registerClass, constructType, getProperty, setProperty, requireNamespace } from '../index.js';

const GLib = requireGi('GLib', '2.0');

const MAX_INT64 = 9223372036854775807n; // G_MAXINT64
const MIN_INT64 = -9223372036854775808n; // G_MININT64
const MAX_UINT64 = 18446744073709551615n; // G_MAXUINT64
// G_MAXINT64 / G_MININT64 / G_MAXUINT64 rounded to the nearest IEEE-754 double —
// identical on SpiderMonkey (gjs) and V8 (node/bun/deno).
const MAX_INT64_AS_DOUBLE = 9223372036854776000;
const MIN_INT64_AS_DOUBLE = -9223372036854776000;
const MAX_UINT64_AS_DOUBLE = 18446744073709552000;

const isNode = typeof globalThis.Deno === 'undefined' && typeof globalThis.Bun === 'undefined';

test('GVariant int64 (x): a BigInt marshals in, a Number marshals out — no abort', () => {
    // Before the fix, constructing this variant from a BigInt aborted the process.
    const x = new GLib.Variant('x', MAX_INT64).deepUnpack();
    assert.equal(typeof x, 'number', 'a 64-bit value comes back as a Number, never a BigInt');
    assert.equal(x, MAX_INT64_AS_DOUBLE);

    const min = new GLib.Variant('x', MIN_INT64).deepUnpack();
    assert.equal(typeof min, 'number');
    assert.equal(min, MIN_INT64_AS_DOUBLE);
});

test('GVariant uint64 (t): a BigInt marshals in, a Number marshals out — no abort', () => {
    const t = new GLib.Variant('t', MAX_UINT64).deepUnpack();
    assert.equal(typeof t, 'number');
    assert.equal(t, MAX_UINT64_AS_DOUBLE);
});

test('GVariant 64-bit: a safe-range BigInt round-trips exactly', () => {
    const safe = 9007199254740991n; // Number.MAX_SAFE_INTEGER — representable exactly
    assert.equal(new GLib.Variant('x', safe).deepUnpack(), 9007199254740991);
    assert.equal(new GLib.Variant('t', safe).deepUnpack(), 9007199254740991);
});

test('scalar gint64 (DateTime): a BigInt and a Number marshal identically', () => {
    // GLib.DateTime.new_from_unix_utc takes a gint64 (marshal.cc scalar IN path);
    // .to_unix() returns a gint64 (scalar OUT path).
    const fromNumber = GLib.DateTime.new_from_unix_utc(1234567890).to_unix();
    const fromBigInt = GLib.DateTime.new_from_unix_utc(1234567890n).to_unix();
    assert.equal(fromNumber, 1234567890);
    assert.equal(fromBigInt, 1234567890);
    assert.equal(typeof fromBigInt, 'number', 'a gint64 OUT value is a Number');
});

test('a Number too large for int64 no longer crashes the process', () => {
    // A huge FINITE Number is truncated (not a BigInt), so it never touches the
    // ToNumber()-on-BigInt abort path — assert it marshals without an uncatchable
    // crash. (GLib.DateTime rejects the out-of-range instant → null; that is fine —
    // the point is that the addon survives.)
    assert.doesNotThrow(() => {
        const dt = GLib.DateTime.new_from_unix_utc(9e18);
        void dt;
    });
    assert.doesNotThrow(() => new GLib.Variant('x', 9e15).deepUnpack());
});

test('GObject int64/uint64 property: BigInt in → Number out (GValue path)', () => {
    requireNamespace('GObject', '2.0');
    const Int64Thing = registerClass('NodeGiInt64Prop', 'GObject', 'Object', {
        properties: [{ name: 'big', type: 'int64', default: 0 }],
    });
    const o = constructType(Int64Thing, {});
    setProperty(o, 'big', MAX_INT64); // BigInt → g_value_set_int64 (object.cc JsToGValue)
    const got = getProperty(o, 'big'); // g_value_get_int64 → Number (object.cc GValueToJs)
    assert.equal(typeof got, 'number', 'an int64 property reads back as a Number');
    assert.equal(got, MAX_INT64_AS_DOUBLE);
    setProperty(o, 'big', 123); // a plain Number still works
    assert.equal(getProperty(o, 'big'), 123);

    const Uint64Thing = registerClass('NodeGiUint64Prop', 'GObject', 'Object', {
        properties: [{ name: 'ubig', type: 'uint64', default: 0 }],
    });
    const u = constructType(Uint64Thing, {});
    setProperty(u, 'ubig', MAX_UINT64);
    const ugot = getProperty(u, 'ubig');
    assert.equal(typeof ugot, 'number');
    assert.equal(ugot, MAX_UINT64_AS_DOUBLE);
});

// The GJS-exact "cannot be safely stored" g_warning is written to fd 2 by the C
// library (bypassing the JS stderr stream), so capturing it needs a child process.
// This also re-proves the child EXITS 0 — i.e. the unsafe value warns instead of
// aborting. Node-only (spawn argv differs per runtime); the assertions above are
// what qualify this file for the bun/deno cross-runtime subset.
if (isNode) {
    test('a too-large 64-bit value logs the "cannot be safely stored" warning (not an abort)', () => {
        const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
        const code =
            "import { requireGi } from './gi.js';" +
            "const GLib = requireGi('GLib','2.0');" +
            "const v = new GLib.Variant('x', 9223372036854775807n).deepUnpack();" +
            "if (typeof v !== 'number') process.exit(3);";
        const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
            cwd: pkgRoot,
            env: { ...process.env, NODE_GI_NATIVE: 'build' },
            encoding: 'utf8',
        });
        assert.equal(res.status, 0, `child must exit 0 (warn, not abort); got ${res.status}\n${res.stderr}`);
        assert.match(
            res.stderr,
            /Value 9223372036854775807 cannot be safely stored in a JS Number and may be rounded/,
            'the OUT path emits the GJS-exact unsafe-integer warning',
        );
    });
}
