// SPDX-License-Identifier: MIT
// L1 wrapper tests for @gjsify/node-gi (milestone 1). Exercises the GJS-shaped
// surface produced by requireGi: namespace functions, GObject construction with
// `new Ns.Class({ props })`, instance method calls, property get/set, signals,
// and GObject-valued arguments/returns being wrapped/unwrapped transparently.
// Headless: GLib functions + Gio.SimpleAction / SimpleActionGroup / Cancellable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';

import { requireGi } from '../gi.js';

test('namespace functions: GLib.get_host_name matches os.hostname', () => {
  const GLib = requireGi('GLib', '2.0');
  assert.equal(typeof GLib.get_host_name, 'function');
  assert.equal(GLib.get_host_name(), hostname());
  assert.equal(GLib.path_get_basename('/usr/bin/gjs'), 'gjs');
});

test('construct a GObject the GJS way and read a property', () => {
  const Gio = requireGi('Gio', '2.0');
  const action = new Gio.SimpleAction({ name: 'greet', enabled: true });
  // property accessor (GJS `action.name`)
  assert.equal(action.name, 'greet');
  assert.equal(action.enabled, true);
  // method call (GJS `action.get_name()`)
  assert.equal(action.get_name(), 'greet');
});

test('property set routes through GObject set_property', () => {
  const Gio = requireGi('Gio', '2.0');
  const action = new Gio.SimpleAction({ name: 'toggle', enabled: true });
  action.enabled = false;
  assert.equal(action.enabled, false);
  assert.equal(action.get_enabled(), false);
});

test('signals via .connect()/.emit()/.disconnect()', () => {
  const Gio = requireGi('Gio', '2.0');
  const c = new Gio.Cancellable();
  let count = 0;
  const id = c.connect('cancelled', () => {
    count++;
  });
  c.emit('cancelled');
  assert.equal(count, 1);
  c.disconnect(id);
  c.emit('cancelled');
  assert.equal(count, 1);
});

test('a signal handler receives the emitter as its first arg (GJS parity)', () => {
  const Gio = requireGi('Gio', '2.0');
  const c = new Gio.Cancellable();
  let sawEmitter = null;
  let argCount = -1;
  c.connect('cancelled', (...args) => {
    argCount = args.length;
    sawEmitter = args[0];
  });
  c.emit('cancelled');
  // The 'cancelled' signal has no params, so the handler gets exactly one arg:
  // the emitter — and it is the SAME cached, toggle-ref-canonical proxy as `c`.
  assert.equal(argCount, 1, 'no-param signal still passes the emitter');
  assert.equal(sawEmitter, c, 'the emitter is the connected-to instance (identity)');
});

test('notify:: handler receives (object, pspec) — GJS parity', () => {
  const Gio = requireGi('Gio', '2.0');
  const action = new Gio.SimpleAction({ name: 'notify-arity', enabled: true });
  let sawObject = null;
  let sawPspecName = null;
  action.connect('notify::enabled', (object, pspec) => {
    sawObject = object;
    sawPspecName = pspec ? pspec.name : null;
  });
  action.enabled = false;
  assert.equal(sawObject, action, 'notify emitter is the changed object');
  assert.equal(sawPspecName, 'enabled', 'notify carries the changed property pspec');
});

test('a cancel() method drives the cancelled signal', () => {
  const Gio = requireGi('Gio', '2.0');
  const c = new Gio.Cancellable();
  let fired = false;
  c.connect('cancelled', () => {
    fired = true;
  });
  assert.equal(c.is_cancelled(), false);
  c.cancel();
  assert.equal(c.is_cancelled(), true);
  assert.equal(fired, true);
});

test('GObject args + returns are wrapped/unwrapped transparently', () => {
  const Gio = requireGi('Gio', '2.0');
  const group = new Gio.SimpleActionGroup();
  const action = new Gio.SimpleAction({ name: 'fire', enabled: true });
  // pass a wrapped instance as an argument (auto-unwrapped to its handle)
  group.add_action(action);
  // returns a wrapped instance (auto-wrapped for chaining)
  const found = group.lookup_action('fire');
  assert.equal(found.get_name(), 'fire');
});

test('the namespace object is cached per name+version', () => {
  const a = requireGi('Gio', '2.0');
  const b = requireGi('Gio', '2.0');
  assert.equal(a, b);
});

test('unknown namespace member is undefined', () => {
  const GLib = requireGi('GLib', '2.0');
  assert.equal(GLib.ThisDoesNotExist, undefined);
});
