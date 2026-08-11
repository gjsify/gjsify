// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the instance getter `$typeName` reports the concrete RUNTIME GType name.
//
// node-gi hands back a GENERIC wrapper for a returned GObject (no downcast to its runtime
// GType), so `constructor.$gtype.name` is the STATIC declared type; GJS wraps a returned
// GObject in its concrete class, so there the same expression IS the runtime type.
// `$typeName` (g_type_name(G_OBJECT_TYPE(obj)) via the native getTypeName) closes that
// divergence for portable consumers such as `@gjsify/devtools`' widget-tree DumpTree; the
// asserted values are byte-equal to what `gjs -m` reports via `constructor.$gtype.name`.
// Headless (GObject/Gio only, no Gtk.init) — runs in the fast `npm test` leg.
//
// Reference: refs/gjs gi/object.cpp. GObject contributors, MIT/LGPLv2+.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

test('$typeName is the concrete runtime GType name of an introspected instance', () => {
    const action = new Gio.SimpleAction({ name: 'greet', enabled: true });
    assert.equal(action.$typeName, 'GSimpleAction');
});

test('$typeName reports the RUNTIME type even for a generically-wrapped handle', () => {
    // GObject.Object.new(gtype, props) constructs by GType and hands back a wrapper with no
    // concrete-class prototype — the DumpTree case, a widget arriving via get_first_child.
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

    // The bug: a generically re-wrapped subclass instance (as if returned from a list or
    // signal) must still report the registered type, which `constructor.$gtype.name` cannot.
    const generic = GObject.Object.new(Sub.$gtype, { name: 'y' });
    assert.equal(generic.$typeName, 'NodeGiTypeNameSub');
});

test('the class-level $gtypeName stays the DECLARED namespaced string (unchanged)', () => {
    // The two differ by design: instance `$typeName` = raw runtime name, class
    // `$gtypeName` = declared namespaced name. The instance getter must not perturb it.
    assert.equal(Gio.SimpleAction.$gtypeName, 'Gio.SimpleAction');
});
