// SPDX-License-Identifier: MIT
// GObject lifecycle + property tests for @gjsify/node-gi (milestone 1).
// Headless: Gio.SimpleAction is a plain GObject (no display) with a string
// construct property ('name') and a boolean property ('enabled'); GObject.Object
// is the bare base type. Exercises construct, GValue get/set, and the GType name.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newObject, getProperty, setProperty, getTypeName, requireNamespace } from '../index.js';

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
