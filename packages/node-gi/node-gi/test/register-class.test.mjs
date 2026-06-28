// SPDX-License-Identifier: MIT
// Subclassing tests for @gjsify/node-gi (milestone 1). registerClass registers
// a new GObject subtype inheriting its parent's layout; constructType builds an
// instance. Headless: subclass GObject.Object (bare base) and Gio.SimpleAction
// (so inherited properties + GAction-interface methods resolve through the
// dynamic type's ancestor chain). GTypes are process-global and permanent, so
// every test registers a uniquely-named type. No custom properties/signals or
// vfunc overrides yet — those are later milestones.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerClass,
  constructType,
  getProperty,
  setProperty,
  getTypeName,
  callMethod,
  requireNamespace,
} from '../index.js';

test('register + construct a bare GObject.Object subclass', () => {
  requireNamespace('GObject', '2.0');
  const Type = registerClass('NodeGiBareSubclass', 'GObject', 'Object');
  const obj = constructType(Type);
  assert.equal(getTypeName(obj), 'NodeGiBareSubclass');
});

test('subclass inherits parent properties + interface methods', () => {
  requireNamespace('Gio', '2.0');
  const Type = registerClass('NodeGiActionSubclass', 'Gio', 'SimpleAction');
  const action = constructType(Type, { name: 'inherited', enabled: true });
  assert.equal(getTypeName(action), 'NodeGiActionSubclass');
  // Inherited GObject property (construct-only on the parent).
  assert.equal(getProperty(action, 'name'), 'inherited');
  // Inherited GAction-interface method resolved via the dynamic type's ancestor
  // walk (the dynamic GType itself has no introspection info).
  assert.equal(callMethod(action, 'get_name'), 'inherited');
  // Inherited writable property round-trip on the subclass instance.
  assert.equal(getProperty(action, 'enabled'), true);
  setProperty(action, 'enabled', false);
  assert.equal(getProperty(action, 'enabled'), false);
  assert.equal(callMethod(action, 'get_enabled'), false);
});

test('the registered type handle is reusable across instances', () => {
  const Type = registerClass('NodeGiReusableSubclass', 'Gio', 'SimpleAction');
  const a = constructType(Type, { name: 'a' });
  const b = constructType(Type, { name: 'b' });
  assert.equal(callMethod(a, 'get_name'), 'a');
  assert.equal(callMethod(b, 'get_name'), 'b');
  assert.equal(getTypeName(a), getTypeName(b));
});

test('error: duplicate type name', () => {
  registerClass('NodeGiDuplicateSubclass', 'GObject', 'Object');
  assert.throws(
    () => registerClass('NodeGiDuplicateSubclass', 'GObject', 'Object'),
    /already registered/,
  );
});

test('error: non-GObject parent', () => {
  assert.throws(() => registerClass('NodeGiBadParent', 'GLib', 'MainLoop'), /not a subclassable/);
});

test('error: constructType on a non-handle', () => {
  assert.throws(() => constructType({}), /expected a node-gi type handle/);
});

test('error: unknown property on a subclass', () => {
  const Type = registerClass('NodeGiUnknownProp', 'Gio', 'SimpleAction');
  assert.throws(() => constructType(Type, { nope: 1 }), /has no property 'nope'/);
});
