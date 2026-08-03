// SPDX-License-Identifier: MIT
// L1 GObject.registerClass decorator tests for @gjsify/node-gi.
//
// requireGi('GObject') exposes a GJS-shaped `GObject.registerClass(meta, class)`
// (plus ParamSpec / ParamFlags / SignalFlags). The decorator registers a GObject
// subtype via the native engine and returns a constructor whose instances are
// usable as GObjects (property get/set, connect/emit/disconnect) AND expose the
// user class's own prototype methods. GTypes are process-global + permanent, so
// every test registers a uniquely-named type.
//
// Reference: GJS's GObject override (refs/gjs/modules/core/overrides/GObject.js)
// for the registerClass(meta, class) shape. Node-gtk's free `registerClass` is
// deliberately NOT mirrored.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi, unwrap } from '../gi.js';
import native from '../index.js';

const GObject = requireGi('GObject', '2.0');

test('GObject statics are surfaced on the namespace', () => {
    assert.equal(typeof GObject.registerClass, 'function');
    assert.equal(typeof GObject.ParamSpec.string, 'function');
    assert.equal(typeof GObject.ParamSpec.int, 'function');
    assert.equal(GObject.ParamFlags.READWRITE, 3);
    assert.equal(GObject.ParamFlags.CONSTRUCT_ONLY, 8);
    // The introspected members still resolve through the underlying proxy.
    assert.equal(typeof GObject.Object, 'function');
    assert.equal(GObject.Object.$gtypeName, 'GObject.Object');
});

test('the full target scenario: meta + method + prop + signal + vfunc', () => {
    let constructedFired = false;
    let nameDuringConstructed = null;
    let greetDuringConstructed = null;

    const MyObj = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorFull',
            Properties: {
                // CONSTRUCT so the construct value is applied BEFORE vfunc_constructed
                // runs (GObject sets plain READWRITE props only AFTER constructed()).
                message: GObject.ParamSpec.string(
                    'message',
                    'Message',
                    'A custom string property',
                    GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
                    'default-msg',
                ),
                count: GObject.ParamSpec.int(
                    'count',
                    'Count',
                    'A custom int property',
                    GObject.ParamFlags.READWRITE,
                    0,
                    100,
                    1,
                ),
            },
            Signals: {
                pinged: { param_types: ['int'] },
            },
        },
        class MyObj extends GObject.Object {
            greet() {
                return 'hello ' + this.message;
            }
            doubled() {
                return this.count * 2;
            }
            vfunc_constructed() {
                constructedFired = true;
                // `this` inside the vfunc is a usable instance: read a property + call
                // the user's own method.
                nameDuringConstructed = this.message;
                greetDuringConstructed = this.greet();
            }
        },
    );

    assert.equal(constructedFired, false, 'vfunc must not fire before construction');
    const obj = new MyObj({ message: 'world', count: 5 });

    // vfunc_constructed fired during construction, with a usable `this`.
    assert.equal(constructedFired, true);
    assert.equal(nameDuringConstructed, 'world');
    assert.equal(greetDuringConstructed, 'hello world');

    // User prototype methods are callable on the GObject wrapper.
    assert.equal(obj.greet(), 'hello world');
    assert.equal(obj.doubled(), 10);

    // Custom property reads + writes route through GObject.
    assert.equal(obj.message, 'world');
    assert.equal(obj.count, 5);
    obj.message = 'changed';
    assert.equal(obj.message, 'changed');
    assert.equal(obj.greet(), 'hello changed');

    // The custom signal connects + emits. GJS parity: emitter first, then params.
    let received = null;
    const id = obj.connect('pinged', (emitter, n) => {
        assert.equal(emitter, obj, 'the emitter is the connected-to instance');
        received = n;
    });
    obj.emit('pinged', 42);
    assert.equal(received, 42);
    obj.disconnect(id);
    obj.emit('pinged', 99);
    assert.equal(received, 42, 'disconnected handler does not fire again');
});

test('a fresh instance sees the declared property defaults', () => {
    const Defaults = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorDefaults',
            Properties: {
                message: GObject.ParamSpec.string(
                    'message',
                    'Message',
                    'msg',
                    GObject.ParamFlags.READWRITE,
                    'the-default',
                ),
            },
        },
        class Defaults extends GObject.Object {},
    );
    const d = new Defaults();
    assert.equal(d.message, 'the-default');
});

test('single-argument form registerClass(class) uses the class name', () => {
    const Bare = GObject.registerClass(
        class NodeGiDecoratorBare extends GObject.Object {
            hi() {
                return 'hi';
            }
        },
    );
    assert.equal(Bare.$gtypeName, 'NodeGiDecoratorBare');
    const b = new Bare();
    assert.equal(b.hi(), 'hi');
});

test('subclassing a real GI class keeps inherited methods + props', () => {
    const Gio = requireGi('Gio', '2.0');
    const MyAction = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorAction',
            Properties: {
                extra: GObject.ParamSpec.boolean(
                    'extra',
                    'Extra',
                    'a custom boolean',
                    GObject.ParamFlags.READWRITE,
                    false,
                ),
            },
        },
        class MyAction extends Gio.SimpleAction {
            describe() {
                return this.get_name() + ':' + this.extra;
            }
        },
    );

    const a = new MyAction({ name: 'fire', enabled: true, extra: true });
    // Inherited GAction-interface method (introspected-parent ancestor walk).
    assert.equal(a.get_name(), 'fire');
    // Inherited property.
    assert.equal(a.enabled, true);
    // Custom property.
    assert.equal(a.extra, true);
    a.extra = false;
    assert.equal(a.extra, false);
    // User method combining both.
    assert.equal(a.describe(), 'fire:false');
});

test('a value-returning custom signal returns the handler result', () => {
    const Summer = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorSummer',
            Signals: {
                sum: { param_types: ['int', 'int'], return_type: 'int' },
            },
        },
        class Summer extends GObject.Object {},
    );
    const s = new Summer();
    // GJS parity: the emitter is the first arg, so the two int params are (a, b).
    s.connect('sum', (_emitter, a, b) => a + b);
    assert.equal(s.emit('sum', 3, 4), 7);
});

// The GJS-canonical spelling of `Signals` is GTYPE-valued, not string-valued: GJS's
// own override hands `param_types` straight to g_signal_new (refs/gjs
// modules/core/overrides/GObject.js), so every ported GJS class writes
// `[GObject.TYPE_INT]`. That spelling silently registered a ZERO-param signal until
// the L1 learned to read a GType handle — the handler's payload arrived as
// `undefined` and neither layer complained. Oracle: gjs 1.88.1 reports n_params 1
// and delivers 42.
test('Signals param_types/return_type accept GTypes (GJS-canonical)', () => {
    const Counter = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorGTypeSignals',
            Signals: {
                changed: { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
                sum: { param_types: [GObject.TYPE_INT, GObject.TYPE_INT], return_type: GObject.TYPE_INT },
            },
        },
        class Counter extends GObject.Object {},
    );
    const c = new Counter();
    const query = GObject.signal_query(GObject.signal_lookup('changed', Counter.$gtype));
    assert.equal(query.n_params, 2, 'both declared params reached g_signal_newv');

    let seen = null;
    c.connect('changed', (_emitter, n, s) => {
        seen = [n, s];
    });
    c.emit('changed', 42, 'hi');
    assert.deepEqual(seen, [42, 'hi']);

    c.connect('sum', (_emitter, a, b) => a + b);
    assert.equal(c.emit('sum', 3, 4), 7);
});

test('registration is complete when registerClass returns', () => {
    const Eager = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorEagerClassInit',
            Signals: { pinged: { param_types: [GObject.TYPE_INT] } },
        },
        class Eager extends GObject.Object {},
    );
    // The engine installs custom signals in class_init, which GObject runs lazily on
    // the first g_type_class_ref — so this answered 0 until the first instance was
    // constructed, while gjs (which class_refs during registerClass) answers the real
    // signal id. NO instance is created here on purpose.
    const id = GObject.signal_lookup('pinged', Eager.$gtype);
    assert.notEqual(id, 0, 'the declared signal exists before the first instance');
    assert.equal(GObject.signal_query(id).n_params, 1);
});

test('Signals accept a class $gtype as a param type', () => {
    const Gio = requireGi('Gio', '2.0');
    const Holder = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorGTypeObjectSignal',
            Signals: { got: { param_types: [Gio.SimpleAction.$gtype] } },
        },
        class Holder extends GObject.Object {},
    );
    const h = new Holder();
    let seen = null;
    h.connect('got', (_emitter, a) => {
        seen = a;
    });
    h.emit('got', new Gio.SimpleAction({ name: 'x' }));
    assert.equal(seen.get_name(), 'x');
});

test('error: an unresolvable Signals type is loud, never dropped', () => {
    assert.throws(
        () =>
            GObject.registerClass(
                { GTypeName: 'NodeGiDecoratorBadSignalParam', Signals: { bad: { param_types: [42] } } },
                class BadParam extends GObject.Object {},
            ),
        /signal 'bad' param_types\[0\] is not a type/,
    );
    assert.throws(
        () =>
            GObject.registerClass(
                { GTypeName: 'NodeGiDecoratorBadSignalReturn', Signals: { bad: { return_type: {} } } },
                class BadReturn extends GObject.Object {},
            ),
        /signal 'bad' return_type is not a type/,
    );
});

test('unwrap() returns the native handle of a decorated instance', () => {
    const Thing = GObject.registerClass(class NodeGiDecoratorUnwrap extends GObject.Object {});
    const t = new Thing();
    assert.equal(typeof unwrap(t), 'object');
    assert.notEqual(unwrap(t), t);
});

test('error: registerClass without a class', () => {
    assert.throws(() => GObject.registerClass({ GTypeName: 'X' }), /expected a class/);
});

test('error: extending a non-GObject class', () => {
    assert.throws(
        () =>
            GObject.registerClass(
                class NotAGObject {
                    foo() {}
                },
            ),
        /must extend a node-gi GObject class/,
    );
});

test('error: an unsupported property type surfaces from the engine', () => {
    assert.throws(
        () =>
            GObject.registerClass(
                {
                    GTypeName: 'NodeGiDecoratorBadType',
                    Properties: { weird: { name: 'weird', type: 'nonsense' } },
                },
                class extends GObject.Object {},
            ),
        /unsupported property type/,
    );
});

// --- regression: the GObject statics overlay must be ADDITIVE ---

test('ParamFlags/SignalFlags keep the FULL introspected bitfields', () => {
    // The convenience names still work...
    assert.equal(GObject.ParamFlags.READWRITE, 3);
    assert.equal(GObject.ParamFlags.CONSTRUCT_ONLY, 8);
    assert.equal(GObject.SignalFlags.RUN_LAST, 2);
    // ...AND every other introspected member still resolves to its real value
    // (a hardcoded 5-member overlay would make these `undefined` → coerce to 0 →
    // silently drop the bit in `FLAGS | GObject.ParamFlags.X`).
    assert.equal(GObject.ParamFlags.LAX_VALIDATION, 16);
    assert.equal(GObject.ParamFlags.EXPLICIT_NOTIFY, 1073741824);
    assert.equal(GObject.SignalFlags.DETAILED, 16);
    assert.equal(GObject.SignalFlags.NO_RECURSE, 8);
    for (const v of [
        GObject.ParamFlags.LAX_VALIDATION,
        GObject.ParamFlags.EXPLICIT_NOTIFY,
        GObject.SignalFlags.DETAILED,
        GObject.SignalFlags.NO_RECURSE,
    ]) {
        assert.equal(typeof v, 'number');
        assert.notEqual(v, undefined);
    }
    // Identity is stable across accesses.
    assert.equal(GObject.ParamFlags, GObject.ParamFlags);
    assert.equal(GObject.SignalFlags, GObject.SignalFlags);
});

test('the `in` operator reflects user methods + GObject properties', () => {
    const Probe = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorHas',
            Properties: {
                label: GObject.ParamSpec.string('label', 'Label', 'a label', GObject.ParamFlags.READWRITE, 'x'),
            },
        },
        class Probe extends GObject.Object {
            greet() {
                return 'hi';
            }
        },
    );
    const p = new Probe();
    assert.equal('greet' in p, true, 'a user prototype method is `in` the wrapper');
    assert.equal('label' in p, true, 'a declared GObject property is `in` the wrapper');
    assert.equal('not_a_member' in p, false, 'an unknown name is not `in` the wrapper');
});

test('a GObject property set inside a vfunc is visible on the instance', () => {
    // The recommended state pattern: use a GObject PROPERTY (lives in C) so it
    // crosses the vfunc<->instance boundary, unlike a plain JS field.
    const Stateful = GObject.registerClass(
        {
            GTypeName: 'NodeGiDecoratorVfuncState',
            Properties: {
                state: GObject.ParamSpec.string(
                    'state',
                    'State',
                    'set during construction',
                    GObject.ParamFlags.READWRITE,
                    'unset',
                ),
            },
        },
        class Stateful extends GObject.Object {
            vfunc_constructed() {
                this.state = 'ready';
            }
        },
    );
    const s = new Stateful();
    assert.equal(s.state, 'ready');
});

test('multi-level registered subclassing is supported (G2)', () => {
    const Base = GObject.registerClass(class NodeGiDecoratorMultiBase extends GObject.Object {});
    // Registering a subclass of a REGISTERED class now succeeds (decorator form): it
    // subclasses from the base's runtime GType handle.
    const Child = GObject.registerClass(class NodeGiDecoratorMultiChild extends Base {});
    assert.notEqual(Child.$gtype, undefined);
    assert.equal(GObject.type_name(Child.$gtype), 'NodeGiDecoratorMultiChild');
    // `new Child()` constructs the leaf GType.
    const obj = new Child();
    assert.equal(native.getTypeName(unwrap(obj)), 'NodeGiDecoratorMultiChild');
});
