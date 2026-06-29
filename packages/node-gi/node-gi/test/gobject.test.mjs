// SPDX-License-Identifier: MIT
// GObject lifecycle + property tests for @gjsify/node-gi (milestone 1).
// Headless: Gio.SimpleAction is a plain GObject (no display) with a string
// construct property ('name') and a boolean property ('enabled'); GObject.Object
// is the bare base type. Exercises construct, GValue get/set, and the GType name.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newObject,
  getProperty,
  setProperty,
  getTypeName,
  requireNamespace,
  variantNew,
} from '../index.js';

test('construct a bare GObject.Object', () => {
  requireNamespace('GObject', '2.0');
  const obj = newObject('GObject', 'Object', {});
  assert.equal(getTypeName(obj), 'GObject');
});

test('construct Gio.SimpleAction with string + boolean props', () => {
  requireNamespace('Gio', '2.0');
  const action = newObject('Gio', 'SimpleAction', { name: 'test-action', enabled: false });
  assert.equal(getTypeName(action), 'GSimpleAction');
  assert.equal(getProperty(action, 'name'), 'test-action');
  assert.equal(getProperty(action, 'enabled'), false);
});

test('set + get a boolean property round-trips', () => {
  const action = newObject('Gio', 'SimpleAction', { name: 'toggle', enabled: false });
  assert.equal(getProperty(action, 'enabled'), false);
  setProperty(action, 'enabled', true);
  assert.equal(getProperty(action, 'enabled'), true);
});

test('error: not a GObject type', () => {
  assert.throws(() => newObject('GLib', 'MainLoop'), /not a constructible GObject type/);
});

test('error: unknown construct property', () => {
  assert.throws(() => newObject('Gio', 'SimpleAction', { nope: 1 }), /has no property 'nope'/);
});

test('error: unknown property on get', () => {
  const action = newObject('Gio', 'SimpleAction', { name: 'x' });
  assert.throws(() => getProperty(action, 'does-not-exist'), /no such property/);
});

test('error: non-handle argument', () => {
  assert.throws(() => getProperty({}, 'name'), /expected a node-gi GObject handle/);
});

// ---- #659: GValue type-safety — a wrong object/boxed type throws a clean JS
// TypeError instead of relying on a GLib warning/critical (which would ABORT under
// G_DEBUG=fatal-criticals/fatal-warnings, and is undefined behaviour for boxed).

test('type-safety: wrong object type for an object property throws (not a GLib abort)', () => {
  requireNamespace('Gio', '2.0');
  // Gio.BufferedInputStream:base-stream wants a GInputStream; a GSimpleAction isn't
  // one. g_value_set_object would g_warning + NULL it (a fatal abort under
  // fatal-warnings); the engine now g_type_is_a-checks + throws a catchable error.
  const notAStream = newObject('Gio', 'SimpleAction', { name: 'x', enabled: true });
  assert.throws(
    () => newObject('Gio', 'BufferedInputStream', { 'base-stream': notAStream }),
    /expected a GInputStream, got GSimpleAction/,
  );
});

test('type-safety: a correct object type for an object property still works', () => {
  const stream = newObject('Gio', 'MemoryInputStream', {});
  const buffered = newObject('Gio', 'BufferedInputStream', { 'base-stream': stream });
  assert.equal(getTypeName(buffered), 'GBufferedInputStream');
});

test('type-safety: wrong boxed type for a boxed property throws (no UB)', () => {
  requireNamespace('GLib', '2.0');
  // Gio.SimpleAction:parameter-type wants a GVariantType (boxed); a GVariant handle
  // is a different boxed/fundamental type. g_value_set_boxed has NO type guard at
  // all (blind copy → UB); the engine checks the boxed handle's GType first.
  const variant = variantNew('i', 5);
  assert.throws(
    () => newObject('Gio', 'SimpleAction', { name: 'p', 'parameter-type': variant }),
    /expected a GVariantType boxed handle, got GVariant/,
  );
});

test('type-safety: a non-boxed value for a boxed property throws', () => {
  const notBoxed = newObject('Gio', 'SimpleAction', { name: 'x', enabled: true });
  assert.throws(
    () => newObject('Gio', 'SimpleAction', { name: 'q', 'parameter-type': notBoxed }),
    /expected a boxed handle for a GVariantType property/,
  );
});
