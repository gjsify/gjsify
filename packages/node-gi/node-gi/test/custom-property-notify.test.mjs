// SPDX-License-Identifier: MIT
// @gjsify/node-gi — assigning a custom GObject property its CURRENT value notifies
// nobody, exactly as GJS's generated accessor decides it.
//
// GJS generates an accessor pair per declared property and the setter is guarded:
// `if (value !== this[privateName]) { this[privateName] = value; this.notify(name) }`
// (refs/gjs/modules/core/_common.js _generateAccessors). node-gi installs NO such
// accessors on purpose — the engine's per-instance store is the single backing store
// (see findPropertySetter in gi.js) — and its set_property vfunc called
// g_object_notify_by_pspec unconditionally. So a redundant assignment notified on
// node-gi and not on gjs: `o.p = 'x'; o.p = 'x'; o.p = 'y'` counted [1,2,3] against
// gjs's [1,1,2], and the three spellings of a dashed name notified once EACH.
// A ::notify handler that re-renders therefore ran twice as often under `--app node`.
//
// WHAT THE GUARD COMPARES AGAINST is the whole subtlety, and it is not the ParamSpec
// default: it is whether the private field has a value YET. All three cases below are
// measured on gjs 1.88.1 and the guard has to reproduce each one.
//   - fresh object, assign the default   → notifies (the field holds `undefined`)
//   - READ it, then assign the default   → silent (the getter installed the default
//                                          into the field: `if (!(privateName in this))`)
//   - `new K({p: default})`, then assign → silent (the construct value went through
//                                          the setter)
// A guard comparing against the stored/default VALUE instead gets the first case
// wrong, which is how it first broke bind_property_full's transform test: that
// binding's source property defaults to `true` and the test assigns `true` to a
// fresh object, so swallowing the notify silently unbound the transform.
//
// And it is scoped to what gjs generates an accessor FOR: a property the class
// declares itself and gave no accessor of its own. An INTROSPECTED property is left
// alone — its C setter decides whether an equal value notifies, and GtkLabel::label
// answers [1,1,2] by itself. `set_property` bypasses the accessor on both runtimes
// and keeps notifying unconditionally (gjs: [1,2,3]).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const { ParamSpec: P, ParamFlags: F } = GObject;

const counting = (object, signal) => {
    const seen = { n: 0 };
    object.connect(signal, () => {
        seen.n++;
    });
    return seen;
};

test('an equal value does not notify, a changed one does', () => {
    const K = GObject.registerClass(
        { GTypeName: 'NodeGiNotifyPlain', Properties: { code: P.string('code', '', '', F.READWRITE, '') } },
        class extends GObject.Object {},
    );
    const o = new K();
    const notified = counting(o, 'notify::code');
    const seen = [];
    o.code = 'x';
    seen.push(notified.n);
    o.code = 'x';
    seen.push(notified.n);
    o.code = 'y';
    seen.push(notified.n);
    assert.deepEqual(seen, [1, 1, 2], 'gjs 1.88.1 counts [1,1,2] here');
    assert.equal(o.code, 'y', 'the last change did reach the store');
});

test('an unset property is not yet its default: the first assignment notifies', () => {
    const K = GObject.registerClass(
        { GTypeName: 'NodeGiNotifyDefault', Properties: { flag: P.boolean('flag', '', '', F.READWRITE, true) } },
        class extends GObject.Object {},
    );
    const fresh = new K();
    const freshNotified = counting(fresh, 'notify::flag');
    fresh.flag = true;
    assert.equal(freshNotified.n, 1, 'the private field held `undefined`, so `true` IS a change');

    const read = new K();
    const readNotified = counting(read, 'notify::flag');
    assert.equal(read.flag, true, 'reading hands back the ParamSpec default');
    read.flag = true;
    assert.equal(readNotified.n, 0, 'the read materialised the default, so assigning it is no change');

    const built = new K({ flag: true });
    const builtNotified = counting(built, 'notify::flag');
    built.flag = true;
    assert.equal(builtNotified.n, 0, 'the construct value materialised it too');
});

test('the three spellings of a dashed name share one value and one notify', () => {
    const K = GObject.registerClass(
        {
            GTypeName: 'NodeGiNotifyDashed',
            Properties: { 'dash-name': P.string('dash-name', '', '', F.READWRITE, 'd') },
        },
        class extends GObject.Object {},
    );
    const o = new K();
    const notified = counting(o, 'notify::dash-name');
    o.dashName = 'q';
    o.dash_name = 'q';
    o['dash-name'] = 'q';
    assert.equal(notified.n, 1, 'one change, however it is spelled');
    assert.equal(o['dash-name'], 'q');
});

test("a class's own accessor keeps deciding when to notify", () => {
    let setterCalls = 0;
    const K = GObject.registerClass(
        { GTypeName: 'NodeGiNotifyOwnAccessor', Properties: { label: P.string('label', '', '', F.READWRITE, '') } },
        class extends GObject.Object {
            stored = 'initial';
            get label() {
                return this.stored;
            }
            set label(value) {
                setterCalls++;
                this.stored = value;
                this.notify('label');
            }
        },
    );
    const o = new K();
    const notified = counting(o, 'notify::label');
    o.label = 'a';
    o.label = 'a';
    assert.equal(setterCalls, 2, 'the guard must not swallow a call to an accessor the class wrote');
    assert.equal(notified.n, 2, 'and that accessor notified both times');
});

test('set_property bypasses the guard, as it bypasses the accessor on gjs', () => {
    const K = GObject.registerClass(
        { GTypeName: 'NodeGiNotifySetProperty', Properties: { code: P.string('code', '', '', F.READWRITE, '') } },
        class extends GObject.Object {},
    );
    const o = new K();
    const notified = counting(o, 'notify::code');
    const seen = [];
    o.set_property('code', 'x');
    seen.push(notified.n);
    o.set_property('code', 'x');
    seen.push(notified.n);
    o.set_property('code', 'y');
    seen.push(notified.n);
    assert.deepEqual(seen, [1, 2, 3], 'gjs 1.88.1 counts [1,2,3] here — the accessor is not in the path');
});

test('an inherited custom property is guarded too', () => {
    const Base = GObject.registerClass(
        { GTypeName: 'NodeGiNotifyBase', Properties: { code: P.string('code', '', '', F.READWRITE, '') } },
        class extends GObject.Object {},
    );
    const Sub = GObject.registerClass({ GTypeName: 'NodeGiNotifySub' }, class extends Base {});
    const o = new Sub();
    const notified = counting(o, 'notify::code');
    o.code = 'x';
    o.code = 'x';
    assert.equal(notified.n, 1, 'the guard follows a declaration down the registered chain');
});
