// SPDX-License-Identifier: MIT
// Signal tests for @gjsify/node-gi (milestone 1). Headless: Gio.Cancellable
// has a no-parameter 'cancelled' signal we can emit directly, exercising the
// GClosure -> JS-callback marshal + connect/emit/disconnect lifecycle without a
// running main loop.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newObject,
  connectSignal,
  emitSignal,
  disconnectSignal,
  requireNamespace,
} from '../index.js';

test('connect + emit invokes the JS callback', () => {
  requireNamespace('Gio', '2.0');
  const c = newObject('Gio', 'Cancellable', {});
  let count = 0;
  connectSignal(c, 'cancelled', () => {
    count++;
  });
  emitSignal(c, 'cancelled');
  emitSignal(c, 'cancelled');
  assert.equal(count, 2);
});

test('disconnect stops further callbacks', () => {
  const c = newObject('Gio', 'Cancellable', {});
  let count = 0;
  const id = connectSignal(c, 'cancelled', () => {
    count++;
  });
  emitSignal(c, 'cancelled');
  assert.equal(count, 1);
  disconnectSignal(c, id);
  emitSignal(c, 'cancelled');
  assert.equal(count, 1);
});

test('multiple handlers all fire', () => {
  const c = newObject('Gio', 'Cancellable', {});
  let a = 0;
  let b = 0;
  connectSignal(c, 'cancelled', () => {
    a++;
  });
  connectSignal(c, 'cancelled', () => {
    b++;
  });
  emitSignal(c, 'cancelled');
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('error: connecting to a missing signal', () => {
  const c = newObject('Gio', 'Cancellable', {});
  assert.throws(() => connectSignal(c, 'no-such-signal', () => {}), /no signal 'no-such-signal'/);
});

test('error: emitting a missing signal', () => {
  const c = newObject('Gio', 'Cancellable', {});
  assert.throws(() => emitSignal(c, 'no-such-signal'), /no signal 'no-such-signal'/);
});

test('a handler exception propagates out of emit', () => {
  const c = newObject('Gio', 'Cancellable', {});
  connectSignal(c, 'cancelled', () => {
    throw new Error('boom');
  });
  assert.throws(() => emitSignal(c, 'cancelled'), /boom/);
});
