// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the four resolution caches on the property/method/signal hot
// paths, each tested for the thing a cache can get WRONG rather than for the speed
// it was added for.
//
// Why they exist: the real-GObject engine of `@gjsify/adwaita-gobject-native` paid
// 21.2 µs per `set`+`notify` against the pure-JS engine's 0.46 µs, and a profile put
// the bulk in work that is a pure function of (GType, name) being redone on every
// single call — gi_repository_find_by_gtype + the method walk in C++, three
// prototype-chain walks for a JS accessor that is not there, a fresh closure per
// `obj.method` read, and eleven fresh closures per ParamSpec handed to a notify
// handler. Caching each one took the write to 6.5 µs.
//
// The failure mode of all four is the same shape: answering for the WRONG key.
// A (GType, name) cache that keys on the name alone makes `Gio.Cancellable`'s
// `cancel` appear on `Gio.SimpleAction`; a per-wrapper thunk cache that keys on the
// name alone binds one object's method to another object's handle; a setter cache
// that stores the setter's RESULT instead of the setter runs a JS accessor once and
// never again. Each test below drives two keys through one cache and asks the
// second to answer for itself.
import test from 'node:test';
import assert from 'node:assert/strict';

import { callMethod, hasMethod, newObject } from '../index.js';
import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

test('the native method cache keys on GType, not on the name alone', () => {
    // Warm `cancel` for GCancellable, then ask a type that has no such method.
    const cancellable = newObject('Gio', 'Cancellable', {});
    callMethod(cancellable, 'cancel');
    assert.equal(callMethod(cancellable, 'is_cancelled'), true);

    const action = newObject('Gio', 'SimpleAction', { name: 'a', enabled: true });
    assert.equal(hasMethod(action, 'cancel'), false);
    assert.throws(() => callMethod(action, 'cancel'), /no method 'cancel'/);

    // And the warmed entry still answers for the type it belongs to.
    const second = newObject('Gio', 'Cancellable', {});
    assert.equal(callMethod(second, 'is_cancelled'), false);
    callMethod(second, 'cancel');
    assert.equal(callMethod(second, 'is_cancelled'), true);
});

test('a MISS stays a miss, and does not poison the next hit on the same type', () => {
    // Only hits are cached (a miss may be a typelib that is not loaded yet), so the
    // order miss-then-hit is the one that has to keep working.
    const action = newObject('Gio', 'SimpleAction', { name: 'b', enabled: true });
    assert.equal(hasMethod(action, 'no_such_method'), false);
    assert.equal(hasMethod(action, 'get_name'), true);
    assert.equal(callMethod(action, 'get_name'), 'b');
    assert.equal(hasMethod(action, 'no_such_method'), false);
});

test('an INTERFACE method survives the cache (GAction on GSimpleAction)', () => {
    // get_name/get_enabled come from the GAction interface, not GSimpleAction's own
    // info — the cached pointer must be the one the interface walk found.
    const action = newObject('Gio', 'SimpleAction', { name: 'c', enabled: true });
    for (let i = 0; i < 3; i++) {
        assert.equal(callMethod(action, 'get_name'), 'c');
        assert.equal(callMethod(action, 'get_enabled'), true);
    }
    callMethod(action, 'set_enabled', [false]);
    assert.equal(callMethod(action, 'get_enabled'), false);
});

test('a wrapper hands back the SAME method twice, reading its own object', () => {
    // Stable identity is the GJS shape — there the method lives on the prototype, so
    // `obj.m === obj.m` holds — and a freshly built thunk per GET broke it. Whichever
    // of the two paths serves the name (a materialised prototype method, or the
    // per-wrapper thunk for a generically wrapped instance), the answer must be stable
    // AND must read the object it was taken from: a thunk cached under the name alone
    // would hand the second action the first one's handle.
    const first = new Gio.SimpleAction({ name: 'first', enabled: true });
    const second = new Gio.SimpleAction({ name: 'second', enabled: true });

    assert.equal(first.get_name, first.get_name, 'one wrapper, one stable member');
    assert.equal(first.get_name(), 'first');
    assert.equal(second.get_name(), 'second');
    assert.equal(first.get_name(), 'first', 'the cached member still reads its own object');

    // A generically wrapped instance — no leaf prototype — is the path the per-wrapper
    // thunk cache actually serves.
    const group = new Gio.SimpleActionGroup();
    group.add_action(first);
    const looked = group.lookup_action('first');
    assert.equal(looked.get_name, looked.get_name, 'stable on a generic wrapper too');
    assert.equal(looked.get_name(), 'first');
});

test('an unknown member stays undefined once a known one has been cached', () => {
    // The thunk cache stores `null` for "no such method" so a miss is not re-walked;
    // `undefined` is what the GET must still produce (feature detection, #1175).
    const action = new Gio.SimpleAction({ name: 'probe', enabled: true });
    assert.equal(typeof action.get_name, 'function');
    assert.equal(action.clearBufferfv, undefined);
    assert.equal(action.clearBufferfv, undefined);
    assert.equal(typeof action.no_such_method, 'undefined');
    assert.equal(action.get_name(), 'probe');
});

test('a class method still wins over the introspected one of the same name', () => {
    // The thunk cache is consulted only after the user prototype, so an override is
    // not shadowed by a thunk cached for an earlier call.
    const K = GObject.registerClass(
        { GTypeName: 'NodeGiThunkOverride' },
        class extends Gio.SimpleAction {
            get_name() {
                return 'overridden';
            }
        },
    );
    const o = new K({ name: 'underlying', enabled: true });
    assert.equal(o.get_name(), 'overridden');
    assert.equal(o.get_name(), 'overridden');
    assert.equal(
        Gio.SimpleAction.prototype.get_name.call(o),
        'underlying',
        'the introspected method itself is untouched',
    );
});

test('two ParamSpecs sharing one prototype answer for themselves', () => {
    // The accessors moved from the instance to a shared prototype and read the handle
    // off `this`; a prototype that closed over one handle would make every pspec look
    // like the first one wrapped.
    const action = new Gio.SimpleAction({ name: 'pspec', enabled: true });
    const seen = [];
    action.connect('notify', (_obj, pspec) => {
        seen.push(pspec);
    });
    action.set_enabled(false);
    assert.ok(seen.length >= 1, 'the enabled notify fired');

    const sibling = new Gio.SimpleAction({ name: 'two', enabled: true });
    const other = [];
    sibling.connect('notify::enabled', (_obj, pspec) => {
        other.push(pspec);
    });
    sibling.set_enabled(false);

    const a = seen[0];
    const b = other[0];
    assert.equal(a.name, 'enabled');
    assert.equal(b.name, 'enabled');
    assert.notEqual(a, b, 'a wrapper per pspec handle, not one shared object');
    assert.equal(a instanceof GObject.ParamSpec, true);
    assert.equal(b instanceof GObject.ParamSpec, true);
    assert.equal(GObject.type_name(a.owner_type), 'GSimpleAction');
    assert.equal(a.get_name(), a.name, 'the method and the getter agree');
});

test('a memoized property setter runs on EVERY write, and absence stays absence', () => {
    // findPropertySetter caches the SETTER (and the null answer), never its result.
    const WithAccessor = GObject.registerClass(
        {
            GTypeName: 'NodeGiSetterMemoWith',
            Properties: {
                code: GObject.ParamSpec.string('code', '', '', GObject.ParamFlags.READWRITE, ''),
            },
        },
        class extends GObject.Object {
            constructor(params) {
                super(params);
                this.writes = [];
            }
            set code(value) {
                this.writes.push(value);
            }
            get code() {
                return this.writes[this.writes.length - 1] ?? '';
            }
        },
    );
    const w = new WithAccessor();
    w.code = 'a';
    w.code = 'b';
    w.code = 'c';
    assert.deepEqual(w.writes, ['a', 'b', 'c'], 'the setter ran three times, not once');

    const NoAccessor = GObject.registerClass(
        {
            GTypeName: 'NodeGiSetterMemoWithout',
            Properties: {
                code: GObject.ParamSpec.string('code', '', '', GObject.ParamFlags.READWRITE, ''),
            },
        },
        class extends GObject.Object {},
    );
    const n = new NoAccessor();
    n.code = 'x';
    assert.equal(n.code, 'x');
    n.code = 'y';
    assert.equal(n.code, 'y', 'the cached "no accessor" answer still writes the store');
});

test('a dashed property reaches its camelCase setter through the memo', () => {
    // The three spellings are resolved once per (prototype, property) and the memo is
    // keyed on the GObject property name, so the alias walk must happen before it is
    // stored, not be skipped by it.
    const K = GObject.registerClass(
        {
            GTypeName: 'NodeGiSetterMemoDashed',
            Properties: {
                'line-numbers': GObject.ParamSpec.boolean('line-numbers', '', '', GObject.ParamFlags.READWRITE, false),
            },
        },
        class extends GObject.Object {
            constructor(params) {
                super(params);
                this.seen = [];
            }
            set lineNumbers(value) {
                this.seen.push(value);
            }
            get lineNumbers() {
                return this.seen[this.seen.length - 1] ?? false;
            }
        },
    );
    const o = new K();
    o.set_property('line-numbers', true);
    o.set_property('line-numbers', false);
    assert.deepEqual(o.seen, [true, false], 'the camelCase setter ran for both writes');
});
