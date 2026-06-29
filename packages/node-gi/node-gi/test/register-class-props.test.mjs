// SPDX-License-Identifier: MIT
// registerClass custom properties + signals (milestone) for @gjsify/node-gi.
// A registered subtype can declare its own GObject properties (installed +
// backed by a per-instance value store in class_init) and signals (g_signal_newv
// in class_init). Custom properties route through node-gi's get/set_property
// override; inherited (introspected-parent) properties still flow through the
// parent's vfuncs. GTypes are process-global, so each test uses a unique name.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerClass,
  constructType,
  getProperty,
  setProperty,
  callMethod,
  connectSignal,
  emitSignal,
  isGObjectHandle,
  requireNamespace,
} from '../index.js';

test('custom properties: construct, get, set, default', () => {
  requireNamespace('GObject', '2.0');
  const Type = registerClass('NodeGiPropThing', 'GObject', 'Object', {
    properties: [
      { name: 'message', type: 'string', default: 'hi' },
      { name: 'count', type: 'int', default: 0, minimum: 0, maximum: 100 },
      { name: 'enabled', type: 'boolean', default: true },
    ],
  });

  const o = constructType(Type, { message: 'hello', count: 7 });
  assert.equal(getProperty(o, 'message'), 'hello');
  assert.equal(getProperty(o, 'count'), 7);
  // Unset property returns the declared default.
  assert.equal(getProperty(o, 'enabled'), true);

  setProperty(o, 'message', 'world');
  assert.equal(getProperty(o, 'message'), 'world');

  // A fresh instance with no construct args sees the defaults.
  const fresh = constructType(Type, {});
  assert.equal(getProperty(fresh, 'message'), 'hi');
  assert.equal(getProperty(fresh, 'count'), 0);
});

test('custom signals: void-with-arg and a value-returning signal', () => {
  const Type = registerClass('NodeGiSignalThing', 'GObject', 'Object', {
    signals: [
      { name: 'pinged', paramTypes: ['string'] },
      { name: 'sum', paramTypes: ['int', 'int'], returnType: 'int' },
    ],
  });
  const o = constructType(Type, {});

  // GJS parity: the raw closure marshal prepends the emitter (the GObject the
  // signal fired on) as the first arg, then the signal's own params.
  let received = null;
  connectSignal(o, 'pinged', (emitter, s) => {
    assert.equal(isGObjectHandle(emitter), true, 'the emitter is a GObject handle');
    received = s;
  });
  emitSignal(o, 'pinged', ['ping-arg']);
  assert.equal(received, 'ping-arg');

  connectSignal(o, 'sum', (_emitter, a, b) => a + b);
  assert.equal(emitSignal(o, 'sum', [3, 4]), 7);
});

test('custom + inherited properties coexist on a subclass', () => {
  requireNamespace('Gio', '2.0');
  const Type = registerClass('NodeGiMixedAction', 'Gio', 'SimpleAction', {
    properties: [{ name: 'extra', type: 'boolean', default: true }],
    signals: [{ name: 'tapped', paramTypes: [] }],
  });
  const a = constructType(Type, { name: 'act', enabled: false, extra: false });

  // Inherited (introspected-parent) property + method still flow through the
  // parent vfuncs / ancestor walk.
  assert.equal(callMethod(a, 'get_name'), 'act');
  assert.equal(getProperty(a, 'enabled'), false);
  // Custom property routed through node-gi's store.
  assert.equal(getProperty(a, 'extra'), false);
  setProperty(a, 'extra', true);
  assert.equal(getProperty(a, 'extra'), true);

  // Custom signal on the subclass fires.
  let tapped = false;
  connectSignal(a, 'tapped', () => {
    tapped = true;
  });
  emitSignal(a, 'tapped');
  assert.equal(tapped, true);
});

test('property change emits notify', () => {
  const Type = registerClass('NodeGiNotifyThing', 'GObject', 'Object', {
    properties: [{ name: 'value', type: 'int', default: 0 }],
  });
  const o = constructType(Type, {});
  let notified = false;
  // GJS parity: a notify:: handler is `(object, pspec) => …` — the emitter first,
  // then the GParamSpec of the changed property.
  connectSignal(o, 'notify::value', (emitter, pspec) => {
    notified = true;
    assert.equal(isGObjectHandle(emitter), true, 'notify emitter is the GObject');
    assert.equal(pspec.name, 'value', 'notify carries the changed property pspec');
  });
  setProperty(o, 'value', 42);
  assert.equal(getProperty(o, 'value'), 42);
  assert.equal(notified, true);
});

test('error: unsupported property type', () => {
  assert.throws(
    () =>
      registerClass('NodeGiBadPropType', 'GObject', 'Object', {
        properties: [{ name: 'weird', type: 'nonsense' }],
      }),
    /unsupported property type/,
  );
});
