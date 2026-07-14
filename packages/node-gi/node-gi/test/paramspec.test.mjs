// SPDX-License-Identifier: MIT
// GParamSpec wrapping (phase 2.7a) for @gjsify/node-gi — display-free, headless.
//
// A `notify` handler's second argument is a real GObject.ParamSpec (not the old
// `{name, valueType}` plain object): it exposes .name/.get_name()/.nick/.blurb/
// .flags/.value_type/.owner_type + .get_default_value(), and `instanceof
// GObject.ParamSpec` recognises it. Reference: gjs gi/param.cpp + the GObject.js
// ParamSpec.prototype (refs/gjs). Part of the cross-runtime conformance subset.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

// Fire `notify::enabled` synchronously and capture the pspec it hands the handler.
function notifyPspec() {
  const action = new Gio.SimpleAction({ name: 'demo', enabled: true });
  let captured = null;
  action.connect('notify::enabled', (obj, pspec) => {
    captured = pspec;
  });
  action.set_enabled(false);
  return captured;
}

test('a notify handler receives a real GObject.ParamSpec', () => {
  const pspec = notifyPspec();
  assert.notEqual(pspec, null, 'the notify handler must fire with a pspec');
  assert.equal(pspec.name, 'enabled');
  assert.equal(pspec.get_name(), 'enabled');
  assert.equal(pspec.nick, 'enabled');
});

test('the pspec value_type / owner_type are GType handles', () => {
  const pspec = notifyPspec();
  assert.equal(GObject.type_name(pspec.value_type), 'gboolean');
  assert.equal(GObject.type_name(pspec.owner_type), 'GSimpleAction');
});

test('the pspec flags carry the readable + writable bits', () => {
  const pspec = notifyPspec();
  assert.ok(pspec.flags & GObject.ParamFlags.READABLE, 'readable bit set');
  assert.ok(pspec.flags & GObject.ParamFlags.WRITABLE, 'writable bit set');
});

test('a wrapped pspec is instanceof GObject.ParamSpec', () => {
  const pspec = notifyPspec();
  assert.equal(pspec instanceof GObject.ParamSpec, true);
});

test('the pspec get_name() and .name agree with get_default_value()', () => {
  const pspec = notifyPspec();
  // The `enabled` property defaults to false; get_default_value() reads the pspec's
  // default GValue (marshalled to a JS boolean).
  assert.equal(typeof pspec.get_default_value(), 'boolean');
});
