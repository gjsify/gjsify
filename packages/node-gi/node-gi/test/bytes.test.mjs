// SPDX-License-Identifier: MIT
// GLib.Bytes fast-path (phase 2.7b) for @gjsify/node-gi — display-free, headless.
//
// `GLib.Bytes.new(array | string)` builds a GBytes; `.toArray()` reads the raw
// bytes back (a Node Buffer, a Uint8Array subclass), `.get_size()` / `.get_data()`
// round-trip, and a string is UTF-8 encoded. Reference: the gjs GLib.js
// `Bytes.prototype.toArray` override (refs/gjs). Part of the cross-runtime subset.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');

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
  assert.deepEqual(
    [...bytes.toArray()],
    [99, 111, 110, 115, 116, 32, 226, 153, 165, 32, 117, 116, 102, 56],
  );
});

test('an empty GLib.Bytes has size 0 and an empty toArray()', () => {
  const empty = GLib.Bytes.new([]);
  assert.equal(empty.get_size(), 0);
  assert.deepEqual([...empty.toArray()], []);
});
