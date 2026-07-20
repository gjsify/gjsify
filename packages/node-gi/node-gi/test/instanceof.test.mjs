// SPDX-License-Identifier: MIT
// @gjsify/node-gi — `instanceof` across the GObject hierarchy (GJS parity).
//
// An introspected instance is a Proxy over a bare handle with NO live JS prototype
// chain linking a leaf class to its bases/interfaces, so the default instanceof (a
// prototype-chain walk) reported `false` for every base class + interface. node-gi
// now resolves membership through the GObject type system (g_type_is_a), exactly as
// GJS does — recognising base classes, implemented interfaces, and registerClass
// subclasses, while a non-GObject value / boxed handle / sibling type stays `false`.
//
// Headless: Gio/GObject only (no display / test typelib), so it runs in the fast
// `npm test` leg. The cross-runtime golden-diff of the same behaviour lives in
// conformance/programs/instanceof-hierarchy.conf.mjs (gjs/node/bun/deno byte-identical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');
const GLib = requireGi('GLib', '2.0');

test('introspected instance is-a its exact class, base classes + interfaces', () => {
  const action = new Gio.SimpleAction({ name: 'x', enabled: true });
  assert.ok(action instanceof Gio.SimpleAction, 'exact class');
  assert.ok(action instanceof GObject.Object, 'cross-namespace base GObject.Object');
  assert.ok(action instanceof Gio.Action, 'implemented interface Gio.Action');

  const group = new Gio.SimpleActionGroup();
  assert.ok(group instanceof Gio.SimpleActionGroup, 'exact class');
  assert.ok(group instanceof GObject.Object, 'base');
  assert.ok(group instanceof Gio.ActionGroup, 'interface Gio.ActionGroup');
  assert.ok(group instanceof Gio.ActionMap, 'interface Gio.ActionMap');
});

test('unrelated classes, interfaces + non-GObject values are NOT instanceof', () => {
  const action = new Gio.SimpleAction({ name: 'x' });
  const cancellable = new Gio.Cancellable();
  assert.ok(!(action instanceof Gio.Cancellable), 'unrelated class');
  assert.ok(!(action instanceof Gio.SimpleActionGroup), 'unrelated class');
  assert.ok(!(cancellable instanceof Gio.Action), 'un-implemented interface');
  assert.ok(!({} instanceof Gio.SimpleAction), 'plain object');
  assert.ok(!(null instanceof Gio.SimpleAction), 'null');
  assert.ok(!(new GLib.Variant('s', 'x') instanceof Gio.SimpleAction), 'boxed Variant handle');
  assert.ok(!(new GObject.Value() instanceof Gio.SimpleAction), 'boxed GValue handle');
});

test('registerClass subclass: leaf, base, interface true; sibling + bare-base false', () => {
  const MyAction = GObject.registerClass(
    { GTypeName: 'NodeGiInstanceofTestAction' },
    class MyAction extends Gio.SimpleAction {},
  );
  const OtherAction = GObject.registerClass(
    { GTypeName: 'NodeGiInstanceofTestOther' },
    class OtherAction extends Gio.SimpleAction {},
  );
  const sub = new MyAction({ name: 'sub', enabled: true });

  assert.ok(sub instanceof MyAction, 'leaf registered class');
  assert.ok(sub instanceof Gio.SimpleAction, 'introspected base');
  assert.ok(sub instanceof GObject.Object, 'root base');
  assert.ok(sub instanceof Gio.Action, 'inherited interface');
  assert.ok(!(sub instanceof OtherAction), 'sibling registered class');

  // A plain introspected instance is NOT an instance of a registered subclass.
  const plain = new Gio.SimpleAction({ name: 'plain' });
  assert.ok(!(plain instanceof MyAction), 'bare base is not the subclass');
});
