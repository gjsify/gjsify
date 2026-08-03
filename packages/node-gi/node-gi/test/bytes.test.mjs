// SPDX-License-Identifier: MIT
// GLib.Bytes fast-path (phase 2.7b) for @gjsify/node-gi — display-free, headless.
//
// `GLib.Bytes.new(array | string)` builds a GBytes; `.toArray()` reads the raw
// bytes back (a Node Buffer, a Uint8Array subclass), `.get_size()` / `.get_data()`
// round-trip, and a string is UTF-8 encoded. Reference: the gjs GLib.js
// `Bytes.prototype.toArray` override (refs/gjs). Part of the cross-runtime subset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');

// sha256 of the bytes 01 02 03 (gjs-verified — the same call under gjs -m).
const SHA256_010203 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const sha256 = (v) => GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, v);

test('GLib.Bytes.new(array) round-trips via toArray()', () => {
    const bytes = GLib.Bytes.new([0, 49, 255, 51]);
    assert.equal(bytes.get_size(), 4);
    assert.deepEqual([...bytes.toArray()], [0, 49, 255, 51]);
    assert.deepEqual([...bytes.get_data()], [0, 49, 255, 51]);
});

test('toArray() returns a Uint8Array-family typed array', () => {
    const arr = GLib.Bytes.new([1, 2, 3]).toArray();
    assert.ok(ArrayBuffer.isView(arr), 'toArray() is a typed array');
    assert.equal(Object.prototype.toString.call(arr), '[object Uint8Array]');
});

test('GLib.Bytes.new(string) is UTF-8 encoded', () => {
    const bytes = GLib.Bytes.new('const ♥ utf8');
    // 6 ASCII + 3 (♥, U+2665) + 5 ASCII = 14 bytes.
    assert.equal(bytes.get_size(), 14);
    assert.deepEqual([...bytes.toArray()], [99, 111, 110, 115, 116, 32, 226, 153, 165, 32, 117, 116, 102, 56]);
});

test('an empty GLib.Bytes has size 0 and an empty toArray()', () => {
    const empty = GLib.Bytes.new([]);
    assert.equal(empty.get_size(), 0);
    assert.deepEqual([...empty.toArray()], []);
});

// ---- JS bytes → GBytes IN-args (the gjs GBytesIn::in Uint8Array path) --------
//
// A JS typed array passed where a GI function expects a `GLib.Bytes` is COPIED
// into a fresh GBytes (g_bytes_new), released per transfer after the invoke —
// exactly what gjs does (refs/gjs/gi/arg-cache.cpp GBytesIn::in →
// gjs_byte_array_get_bytes). node-gi additionally accepts DataView/ArrayBuffer
// (a superset of gjs's Uint8Array-only check).

test('Uint8Array marshals as a GLib.Bytes IN arg (fresh GBytes copy)', () => {
    assert.equal(sha256(new Uint8Array([1, 2, 3])), SHA256_010203);
    // Identical to the explicit boxed-handle path, which keeps working.
    assert.equal(sha256(GLib.Bytes.new([1, 2, 3])), SHA256_010203);
});

test('a subarray view marshals only its byte slice (offset honoured)', () => {
    const backing = new Uint8Array([9, 9, 9, 1, 2, 3]);
    assert.equal(sha256(backing.subarray(3)), SHA256_010203);
    assert.equal(sha256(backing.subarray(3, 5)), sha256(new Uint8Array([1, 2])));
});

test('Buffer, DataView and ArrayBuffer are accepted where GBytes is expected', () => {
    assert.equal(sha256(Buffer.from([1, 2, 3])), SHA256_010203);
    const ab = new ArrayBuffer(3);
    new Uint8Array(ab).set([1, 2, 3]);
    assert.equal(sha256(ab), SHA256_010203);
    assert.equal(sha256(new DataView(ab)), SHA256_010203);
});

test('an empty typed array marshals as an empty GBytes', () => {
    assert.equal(sha256(new Uint8Array(0)), sha256(GLib.Bytes.new([])));
});

test('a callee that KEEPS the bytes stays valid after the engine drops its ref', () => {
    // g_bytes_new_from_bytes refs the parent GBytes and shares its memory — the
    // child must still read correctly after the invoke released our fresh copy.
    //
    // Its INTROSPECTION is GLib-version dependent, so the test follows the running
    // GLib instead of hardcoding one spelling: GLib >= 2.88 exposes it as a static
    // CONSTRUCTOR (arg 0 = the parent GBytes), earlier GLib as an INSTANCE METHOD on
    // the parent. Measured on aarch64 — gjs 1.88.1 / GLib 2.88.1 static-only,
    // gjs 1.86.0 / GLib 2.86.5 (org.gnome.Platform//49, the repo's declared gjs floor)
    // instance-only — and node-gi mirrors whichever the typelib says, which is the
    // fidelity that surfaced this. A `typeof` probe cannot tell them apart: the L1
    // exposes every static lazily, so the "is an instance method" refusal only lands at
    // CALL time. Either branch drops the parent handle immediately, so the gc() below
    // still exercises "the child survives the engine releasing the parent".
    const staticCtor = GLib.check_version(2, 88, 0) === null;
    const child = staticCtor
        ? GLib.Bytes.new_from_bytes(new Uint8Array([5, 6, 7, 8]), 1, 2)
        : GLib.Bytes.new(new Uint8Array([5, 6, 7, 8])).new_from_bytes(1, 2);
    if (globalThis.gc) globalThis.gc();
    assert.deepEqual([...child.toArray()], [6, 7]);
});
