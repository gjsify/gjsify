// SPDX-License-Identifier: MIT
// @gjsify/node-gi — registerClass accepts the meta declared as static SYMBOL FIELDS
// on the class, not only as the meta object argument.
//
// GJS offers both forms and the symbols are the real source: `registerClass(meta,
// klass)` only COPIES meta onto `klass[Symbol(GType name)]` and friends and then
// reads them back (refs/gjs/modules/core/_common.js). The field form is what a class
// that cannot wrap its own declaration uses — a decorator, a code generator, or a
// subclass that wants to amend its parent's meta.
//
// node-gi read only the string keys `meta.GTypeName` / `Properties` / `Signals`, and
// the symbols did not exist on the GObject namespace AT ALL. `GObject.GTypeName` was
// therefore `undefined`, so `Object.assign(K, {[GObject.GTypeName]: 'X'})` wrote a
// property literally keyed "undefined" and the declaration vanished without a word:
// the GType fell back to the class name and the signals were never registered, so
// the first `emit` failed with "no signal 'ping'" pointing at the emit rather than at
// the registration that silently dropped it.
//
// GObject.interfaces / GObject.interface requires are deliberately NOT exposed:
// registerClass implements no interfaces in EITHER form yet, and a symbol that is
// accepted and then ignored would promise more than the object form delivers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const { ParamSpec: P, ParamFlags: F } = GObject;

test('the meta symbols exist and are distinct', () => {
    for (const name of ['GTypeName', 'properties', 'signals']) {
        assert.equal(typeof GObject[name], 'symbol', `GObject.${name} must be a symbol`);
    }
    const all = new Set([GObject.GTypeName, GObject.properties, GObject.signals]);
    assert.equal(all.size, 3, 'three different symbols');
    // The descriptions match gjs's, so a stringified symbol reads the same in both.
    assert.equal(String(GObject.GTypeName), 'Symbol(GType name)');
    assert.equal(String(GObject.properties), 'Symbol(GObject properties)');
    assert.equal(String(GObject.signals), 'Symbol(GObject signals)');
});

test('a class declared entirely through the symbol fields registers', () => {
    class Field extends GObject.Object {}
    Object.assign(Field, {
        [GObject.GTypeName]: 'NodeGiFieldForm',
        [GObject.properties]: { code: P.string('code', '', '', F.READWRITE, '') },
        [GObject.signals]: { ping: { param_types: [] } },
    });
    const K = GObject.registerClass(Field);

    assert.equal(K, Field, 'registerClass registers in place');
    assert.equal(K.$gtypeName, 'NodeGiFieldForm', 'the GTypeName came from the field');
    assert.equal(GObject.type_name(K.$gtype), 'NodeGiFieldForm');

    const o = new K();
    let notifies = 0;
    let pings = 0;
    o.connect('notify::code', () => {
        notifies++;
    });
    o.connect('ping', () => {
        pings++;
    });
    o.code = 'x';
    o.emit('ping');
    assert.equal(notifies, 1, 'the property from the field is a real GObject property');
    assert.equal(pings, 1, 'the signal from the field is a real signal');
    assert.equal(o.code, 'x');
});

test('the meta object wins over a symbol field, as it does on gjs', () => {
    class Both extends GObject.Object {}
    Both[GObject.GTypeName] = 'NodeGiFieldLoses';
    const K = GObject.registerClass({ GTypeName: 'NodeGiObjectWins' }, Both);
    assert.equal(K.$gtypeName, 'NodeGiObjectWins');
});

test('a class with no meta at all still registers under its class name', () => {
    const K = GObject.registerClass(class NodeGiNoMeta extends GObject.Object {});
    assert.equal(K.$gtypeName, 'NodeGiNoMeta');
});
