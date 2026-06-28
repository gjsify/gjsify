// SPDX-License-Identifier: MIT
// L1 enum/flags/constant tests for @gjsify/node-gi (milestone 1). The wrapper
// surfaces namespace constants as values and enum/flags types as frozen objects
// keyed GJS-style (UPPER_CASE, '-' → '_'). Low-level getConstantValue /
// getEnumValues are exercised directly too. Headless: GLib priority/source
// constants, Gio.BusType (enum), Gio.ApplicationFlags (flags).
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';
import { getConstantValue, getEnumValues, requireNamespace } from '../index.js';

test('constants: GLib priority + source values', () => {
  const GLib = requireGi('GLib', '2.0');
  assert.equal(GLib.PRIORITY_DEFAULT, 0);
  assert.equal(GLib.PRIORITY_HIGH, -100);
  // boolean-typed constants marshal as booleans
  assert.equal(GLib.SOURCE_CONTINUE, true);
  assert.equal(GLib.SOURCE_REMOVE, false);
});

test('enum: Gio.BusType members are GJS-style upper-case', () => {
  const Gio = requireGi('Gio', '2.0');
  assert.equal(Gio.BusType.NONE, 0);
  assert.equal(Gio.BusType.SYSTEM, 1);
  assert.equal(Gio.BusType.SESSION, 2);
  assert.equal(Gio.BusType.STARTER, -1);
});

test('flags: Gio.ApplicationFlags members + dash→underscore', () => {
  const Gio = requireGi('Gio', '2.0');
  assert.equal(Gio.ApplicationFlags.IS_SERVICE, 1);
  assert.equal(Gio.ApplicationFlags.HANDLES_OPEN, 4);
  assert.equal(Gio.ApplicationFlags.HANDLES_COMMAND_LINE, 8);
});

test('enum objects are frozen', () => {
  const Gio = requireGi('Gio', '2.0');
  assert.throws(() => {
    Gio.BusType.SYSTEM = 99;
  }, TypeError);
});

test('low-level getConstantValue + getEnumValues (raw names)', () => {
  requireNamespace('GLib', '2.0');
  requireNamespace('Gio', '2.0');
  assert.equal(getConstantValue('GLib', 'PRIORITY_DEFAULT'), 0);
  const busType = getEnumValues('Gio', 'BusType');
  assert.equal(busType.system, 1); // raw GI name (lower-case) at the native layer
  assert.equal(busType.session, 2);
});

test('error: getConstantValue on a non-constant', () => {
  assert.throws(() => getConstantValue('Gio', 'SimpleAction'), /not a constant/);
});

test('error: getEnumValues on a non-enum', () => {
  assert.throws(() => getEnumValues('Gio', 'SimpleAction'), /not an enum or flags/);
});
