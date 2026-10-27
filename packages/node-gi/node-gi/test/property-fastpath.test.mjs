// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the property-write fast paths in the engine.
//
// (1) A class that declares no JS accessor for a property is a pure store: after gi.js
//     answers `false` once, NodeGiSetProperty stops crossing into JS for that
//     (instance type, property). A class that DOES declare one keeps crossing on every
//     write, and a subclass that adds an accessor its parent lacks is a different key.
// (2) `setPropertyIfChanged` folds the equal-value guard into the store: one crossing,
//     same answers as `wrapReturn(getProperty) === value` followed by `setProperty`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as native from '../index.js';
import { requireGi, unwrap } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const { ParamSpec: P, ParamFlags: F } = GObject;

test('an accessor the class declares still runs on every write', () => {
    const log = [];
    const K = GObject.registerClass(
        { GTypeName: 'FastpathAccessor', Properties: { label: P.string('label', 'L', 'L', F.READWRITE, 'x') } },
        class FastpathAccessor extends GObject.Object {
            set label(v) {
                log.push(v);
            }
            get label() {
                return log.at(-1) ?? 'x';
            }
        },
    );
    const o = new K();
    o.set_property('label', 'a');
    o.set_property('label', 'b');
    o.set_property('label', 'c');
    assert.deepEqual(log, ['a', 'b', 'c']);
});

test('a subclass accessor is honoured although the parent was memoised as store-only', () => {
    const Base = GObject.registerClass(
        { GTypeName: 'FastpathBase', Properties: { n: P.int('n', 'N', 'N', F.READWRITE, 0, 100, 0) } },
        class FastpathBase extends GObject.Object {},
    );
    const b = new Base();
    b.set_property('n', 1);
    b.set_property('n', 2);
    const log = [];
    const Sub = GObject.registerClass(
        { GTypeName: 'FastpathSub' },
        class FastpathSub extends Base {
            set n(v) {
                log.push(v);
            }
            get n() {
                return log.at(-1) ?? 0;
            }
        },
    );
    const s = new Sub();
    s.set_property('n', 7);
    s.set_property('n', 8);
    assert.deepEqual(log, [7, 8]);
});

test('setPropertyIfChanged: 0 stored, 1 equal, 2 undecided', () => {
    const K = GObject.registerClass(
        {
            GTypeName: 'FastpathGuard',
            Properties: {
                label: P.string('label', 'L', 'L', F.READWRITE, 'x'),
                n: P.int('n', 'N', 'N', F.READWRITE, 0, 100, 0),
                flag: P.boolean('flag', 'F', 'F', F.READWRITE, false),
                obj: P.object('obj', 'O', 'O', F.READWRITE, GObject.Object),
            },
        },
        class FastpathGuard extends GObject.Object {},
    );
    const o = new K();
    const h = unwrap(o);
    assert.equal(native.setPropertyIfChanged(h, 'label', 'a'), 0);
    assert.equal(native.setPropertyIfChanged(h, 'label', 'a'), 1);
    assert.equal(native.setPropertyIfChanged(h, 'label', 'b'), 0);
    assert.equal(native.setPropertyIfChanged(h, 'n', 5), 0);
    assert.equal(native.setPropertyIfChanged(h, 'n', 5), 1);
    assert.equal(native.setPropertyIfChanged(h, 'flag', true), 0);
    assert.equal(native.setPropertyIfChanged(h, 'flag', true), 1);
    assert.equal(native.setPropertyIfChanged(h, 'obj', null), 2);
    assert.equal(o.label, 'b');
    assert.equal(o.n, 5);
});

test('the notify handler gets the same pspec wrapper data on every emission', () => {
    const K = GObject.registerClass(
        { GTypeName: 'FastpathPspec', Properties: { label: P.string('label', 'L', 'L', F.READWRITE, 'x') } },
        class FastpathPspec extends GObject.Object {},
    );
    const o = new K();
    const names = [];
    o.connect('notify::label', (_o, pspec) => names.push([pspec.name, pspec.owner_type === K.$gtype]));
    o.label = 'a';
    o.label = 'b';
    assert.deepEqual(
        names.map((n) => n[0]),
        ['label', 'label'],
    );
});

// LAST in the file: it replaces the setter callback gi.js registered. The callback stands in
// for gi.js, answering what it would answer for a class chain with / without an accessor.
test('the engine memoises only a definitive "no accessor" answer', () => {
    const K = GObject.registerClass(
        { GTypeName: 'FastpathMemo', Properties: { label: P.string('label', 'L', 'L', F.READWRITE, 'x') } },
        class FastpathMemo extends GObject.Object {},
    );
    let crossings = 0;
    let answer;
    native.setPropertySetCallback(() => {
        crossings++;
        return answer;
    });
    const o = new K();
    answer = undefined;
    for (let i = 0; i < 5; i++) o.set_property('label', `u${i}`);
    assert.equal(crossings, 5, 'no definitive answer: every write still crosses');
    answer = true;
    o.set_property('label', 'ran');
    assert.equal(crossings, 6, 'a setter ran: keeps crossing');
    answer = false;
    crossings = 0;
    for (let i = 0; i < 5; i++) o.set_property('label', `s${i}`);
    assert.equal(crossings, 1, 'no accessor: asked once, then a pure store');
    assert.equal(o.label, 's4');
});
