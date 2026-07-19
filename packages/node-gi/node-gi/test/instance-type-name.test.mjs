// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the wrapper exposes an instance's concrete RUNTIME GType name.
//
// node-gi hands JS a GENERIC wrapper for a GObject handle it gets back (it does
// NOT downcast the wrapper to the instance's runtime GType), so the wrapper's
// `constructor` is the plain proxy target's — `constructor.$gtype.name` is the
// STATIC declared type, not the runtime one. GJS, by contrast, wraps a returned
// GObject in its concrete class, so `constructor.$gtype.name` there IS the runtime
// type. The L1 wrapper therefore surfaces the true runtime GType name on the
// instance getter `$typeName` (g_type_name(G_OBJECT_TYPE(obj)) via the native
// getTypeName), so a portable consumer (`@gjsify/devtools`' widget-tree DumpTree)
// can read the concrete type on BOTH runtimes.
//
// Headless: only GObject/Gio types are constructed (no display / no Gtk.init), so
// this runs in the fast `npm test` leg. The asserted values are byte-equal to what
// `gjs -m` reports via `instance.constructor.$gtype.name`.
//
// Reference: refs/gjs gi/object.cpp (GJS wraps a returned GObject in its concrete
// GType's class). GObject contributors, MIT/LGPLv2+.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

test('$typeName is the concrete runtime GType name of an introspected instance', () => {
  const action = new Gio.SimpleAction({ name: 'greet', enabled: true });
  // Byte-equal to gjs `action.constructor.$gtype.name`.
  assert.equal(action.$typeName, 'GSimpleAction');
});

test('$typeName reports the RUNTIME type even for a generically-wrapped handle', () => {
  // GObject.Object.new(gtype, props) constructs by GType and hands back a GENERIC
  // wrapper (no concrete-class prototype) — exactly the DumpTree scenario where a
  // widget arrives via get_first_child / get_item, un-downcast. The runtime type
  // must still be concrete, not the generic 'GObject'.
  const made = GObject.Object.new(Gio.SimpleAction.$gtype, { name: 'made' });
  assert.equal(made.$typeName, 'GSimpleAction');
  assert.notEqual(made.$typeName, 'GObject');
});

test('$typeName is the registered GTypeName of a registerClass subclass instance', () => {
  const Sub = GObject.registerClass(
    { GTypeName: 'NodeGiTypeNameSub' },
    class NodeGiTypeNameSub extends Gio.SimpleAction {},
  );
  const inst = new Sub({ name: 'x' });
  assert.equal(inst.$typeName, 'NodeGiTypeNameSub');

  // The bug this fixes: a GENERICALLY re-wrapped instance of the subclass (as if
  // returned from a list / signal) still reports the concrete registered type,
  // whereas `constructor.$gtype.name` on the generic wrapper cannot.
  const generic = GObject.Object.new(Sub.$gtype, { name: 'y' });
  assert.equal(generic.$typeName, 'NodeGiTypeNameSub');
});

test('the class-level $gtypeName stays the DECLARED namespaced string (unchanged)', () => {
  // Guards the distinction: instance `$typeName` = raw runtime name ('GSimpleAction'),
  // class `$gtypeName` = declared namespaced name ('Gio.SimpleAction'). They differ
  // by design; adding the instance getter must not perturb the class accessor.
  assert.equal(Gio.SimpleAction.$gtypeName, 'Gio.SimpleAction');
});
