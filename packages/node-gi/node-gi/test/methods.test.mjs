// SPDX-License-Identifier: MIT
// Instance-method tests for @gjsify/node-gi (milestone 1). Headless GObjects:
// Gio.Cancellable (own methods is_cancelled/cancel/reset), Gio.SimpleAction
// (GAction-interface methods get_name/get_enabled + own set_enabled), and
// Gio.SimpleActionGroup (GActionMap-interface add_action/lookup_action) — the
// last exercising a GObject IN-arg, a GObject return, and a method call on the
// returned handle. No running main loop required.
import test from 'node:test';
import assert from 'node:assert/strict';

import { newObject, callMethod, requireNamespace } from '../index.js';

test('own methods: Cancellable is_cancelled/cancel/reset round-trip', () => {
  requireNamespace('Gio', '2.0');
  const c = newObject('Gio', 'Cancellable', {});
  assert.equal(callMethod(c, 'is_cancelled'), false);
  callMethod(c, 'cancel');
  assert.equal(callMethod(c, 'is_cancelled'), true);
  callMethod(c, 'reset');
  assert.equal(callMethod(c, 'is_cancelled'), false);
});

test('interface methods: SimpleAction get_name/get_enabled via GAction', () => {
  const action = newObject('Gio', 'SimpleAction', { name: 'greet', enabled: true });
  assert.equal(callMethod(action, 'get_name'), 'greet');
  assert.equal(callMethod(action, 'get_enabled'), true);
});

test('method with an IN argument: SimpleAction set_enabled', () => {
  const action = newObject('Gio', 'SimpleAction', { name: 'toggle', enabled: true });
  assert.equal(callMethod(action, 'get_enabled'), true);
  callMethod(action, 'set_enabled', [false]);
  assert.equal(callMethod(action, 'get_enabled'), false);
});

test('GObject in-arg + GObject return: SimpleActionGroup add/lookup', () => {
  const group = newObject('Gio', 'SimpleActionGroup', {});
  const action = newObject('Gio', 'SimpleAction', { name: 'fire', enabled: true });
  callMethod(group, 'add_action', [action]);
  const found = callMethod(group, 'lookup_action', ['fire']);
  // The returned handle is a live GObject — call a method back on it.
  assert.equal(callMethod(found, 'get_name'), 'fire');
});

test('lookup of a missing action returns null', () => {
  const group = newObject('Gio', 'SimpleActionGroup', {});
  assert.equal(callMethod(group, 'lookup_action', ['nope']), null);
});

test('error: no such method', () => {
  const c = newObject('Gio', 'Cancellable', {});
  assert.throws(() => callMethod(c, 'no_such_method'), /no method 'no_such_method'/);
});

test('error: non-handle argument', () => {
  assert.throws(() => callMethod({}, 'is_cancelled'), /expected a node-gi GObject handle/);
});
