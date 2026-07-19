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

test('hasMethod: feature detection matches callMethod resolution', async () => {
  const { hasMethod } = await import('../index.js');
  const action = newObject('Gio', 'SimpleAction', { name: 'probe', enabled: true });
  assert.equal(hasMethod(action, 'get_name'), true); // interface method (GAction)
  assert.equal(hasMethod(action, 'set_enabled'), true); // own method
  assert.equal(hasMethod(action, 'getName'), true); // camelCase → snake alias
  assert.equal(hasMethod(action, 'ref'), true); // parent chain (GObject)
  assert.equal(hasMethod(action, 'no_such_method'), false);
  assert.equal(hasMethod(action, 'clearBufferfv'), false);
});

test('L1 wrapper: unknown member is undefined (GJS parity feature detection)', async () => {
  // Real consumers feature-detect optional native methods
  // (`typeof gl.clearBufferfv === 'function'` gates @gjsify/webgl's clearBuffer
  // emulation — Excalibur's RenderTarget.blitToScreen exposed this on node-gi).
  // A merely-unknown name must be `undefined` like under gjs, NOT a
  // throw-on-call thunk that makes the typeof check lie.
  const { requireGi } = await import('../gi.js');
  const Gio = requireGi('Gio', '2.0');
  const action = new Gio.SimpleAction({ name: 'probe', enabled: true });
  assert.equal(typeof action.get_name, 'function');
  assert.equal(typeof action.getName, 'function'); // camelCase alias still callable
  assert.equal(action.get_name(), 'probe');
  assert.equal(action.clearBufferfv, undefined);
  assert.equal(action.no_such_method, undefined);
  assert.equal(typeof action.no_such_method, 'undefined');
});
