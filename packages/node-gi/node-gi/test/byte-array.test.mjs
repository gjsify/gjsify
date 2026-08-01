// SPDX-License-Identifier: MIT
// The legacy `imports.byteArray` module seeded by @gjsify/node-gi/globals —
// gjs's modules/script/byteArray.js surface over the engine's boxed GBytes:
// fromString/toString (ZERO-TERMINATED + fatal, gjs/gjs/byteArray.cpp),
// fromGBytes/toGBytes (GLib.Bytes round-trip), fromArray + the ByteArray
// wrapper. This is the seam `@gjsify/utils`' cli()/gbytesToUint8Array — and
// through them `@gjsify/os` + `@gjsify/child_process` — read subprocess
// output with (consumer-survey P3). Cross-runtime parity is pinned by
// conformance/programs/byte-array.conf.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import '../globals.js'; // side effect: seeds globals incl. imports.byteArray
import { requireGi } from '../gi.js';

const ba = globalThis.imports.byteArray;

test('imports.byteArray exposes the gjs module surface', () => {
    assert.equal(typeof ba.fromString, 'function');
    assert.equal(typeof ba.toString, 'function');
    assert.equal(typeof ba.fromGBytes, 'function');
    assert.equal(typeof ba.toGBytes, 'function');
    assert.equal(typeof ba.fromArray, 'function');
    assert.equal(typeof ba.ByteArray, 'function');
});

test('fromString encodes UTF-8 to a plain Uint8Array', () => {
    const u8 = ba.fromString('héllo');
    assert.ok(u8 instanceof Uint8Array);
    assert.equal(u8.constructor.name, 'Uint8Array'); // NOT Buffer — gjs parity
    assert.equal(u8.length, 6); // é is 2 bytes
    assert.equal(ba.toString(u8), 'héllo');
});

test('fromString/toString honour a non-UTF-8 encoding label', () => {
    const latin = ba.fromString('äöü', 'LATIN1');
    assert.equal(latin.length, 3);
    assert.equal(ba.toString(latin, 'LATIN1'), 'äöü');
});

test('toString is ZERO-TERMINATED (stops at the first NUL byte)', () => {
    assert.equal(ba.toString(Uint8Array.from([104, 105, 0, 120])), 'hi');
    assert.equal(ba.toString(new Uint8Array(0)), '');
});

test('fromString is ZERO-TERMINATED on the encoded bytes', () => {
    const u8 = ba.fromString('hi\0dropped');
    assert.equal(u8.length, 2);
    assert.equal(ba.toString(u8), 'hi');
});

test('returned arrays carry the legacy own toString(encoding)', () => {
    const u8 = ba.fromString('héllo');
    assert.equal(u8.toString(), 'héllo'); // NOT the '104,105,…' Array join
    assert.equal(Object.getOwnPropertyDescriptor(u8, 'toString').enumerable, false);
});

test('toGBytes/fromGBytes round-trip through a real GLib.Bytes', () => {
    const bytes = ba.toGBytes(Uint8Array.from([1, 2, 3]));
    assert.equal(bytes.get_size(), 3);
    const back = ba.fromGBytes(bytes);
    assert.ok(back instanceof Uint8Array);
    assert.equal(back.constructor.name, 'Uint8Array');
    assert.deepEqual(Array.from(back), [1, 2, 3]);
});

test('fromGBytes copies — mutating the result does not alias the GBytes', () => {
    const bytes = ba.toGBytes(Uint8Array.from([9, 9]));
    const a = ba.fromGBytes(bytes);
    a[0] = 1;
    assert.deepEqual(Array.from(ba.fromGBytes(bytes)), [9, 9]);
});

test('fromArray wraps in the legacy ByteArray (indexing, growth, decode)', () => {
    const arr = ba.fromArray([104, 105]);
    assert.equal(arr.length, 2);
    assert.equal(arr[0], 104);
    assert.equal(arr.toString(), 'hi');
    arr[3] = 33; // legacy auto-growth
    assert.equal(arr.length, 4);
    assert.equal(arr.toString(), 'hi'); // NUL at [2] zero-terminates the decode
});

test('error classes match gjs (Error for arg parsing, TypeError for typechecks)', () => {
    assert.throws(() => ba.toGBytes('nope'), { constructor: Error, message: /must be a Uint8Array/ });
    assert.throws(() => ba.fromGBytes({}), TypeError);
    assert.throws(() => ba.toString(Uint8Array.from([0xff, 0xfe])), TypeError); // fatal decode
    assert.throws(() => ba.fromString(123), Error);
    assert.throws(() => ba.toString('nope'), { constructor: Error, message: /must be a Uint8Array/ });
});

test('the @gjsify/utils consumer seam: spawn stdout reads via toString', () => {
    const GLib = requireGi('GLib', '2.0');
    const [ok, out] = GLib.spawn_command_line_sync('echo seam');
    assert.equal(ok, true);
    assert.equal(ba.toString(out), 'seam\n');
});
