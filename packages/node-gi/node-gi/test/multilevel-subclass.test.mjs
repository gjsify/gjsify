// SPDX-License-Identifier: MIT
// G2 — multi-level registered subclassing (registered-subclass-of-registered).
//
// `GObject.registerClass` can register a subclass whose parent is ITSELF a
// registered (dynamic) type, at any depth. The registered parent has no
// introspection entry, so findParentGType resolves it to the parent's runtime
// GType handle (#667 / its `$gtype`) and registerClass subclasses from it via the
// native `registerClassFromGType` variant (a thin wrapper around the shared
// g_type_register_static core). Construction is already multi-level-correct: the
// makeClass `new.target` routing keys on the LEAF class, whose registered GType is
// the full multi-level type.
//
// The key property of G2 is that an ANCESTOR's custom properties, signals and
// vfunc overrides compose for free on a leaf instance through normal GObject
// inheritance — g_object_class_find_property / g_signal_lookup walk the ancestry,
// and NodeGiGet/SetProperty key on the pspec's owner-type class-data + a per-
// instance store, so an inherited custom prop reads/writes the right slot even
// when accessed on a deeper subclass instance.
//
// GTypes are process-global + permanent, so every test registers uniquely-named
// types. Reference: scratchpad/storybook-objectmodel-design.md §G2;
// refs/gjs/modules/core/overrides/GObject.js.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi, unwrap } from '../gi.js';
import native from '../index.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');
const RW = GObject.ParamFlags.READWRITE;

test('2-level registered chain: an ancestor and the leaf both compose props + signals', () => {
    class MlA extends GObject.Object {
        static {
            GObject.registerClass(
                {
                    GTypeName: 'NodeGiMlA',
                    Properties: {
                        'a-prop': GObject.ParamSpec.string('a-prop', 'A prop', 'declared on A', RW, 'a-default'),
                    },
                    Signals: { 'a-signal': { param_types: ['int'] } },
                },
                MlA,
            );
        }
        aMethod() {
            return `A:${this.a_prop}`;
        }
    }

    class MlB extends MlA {
        static {
            GObject.registerClass(
                {
                    GTypeName: 'NodeGiMlB',
                    Properties: {
                        'b-prop': GObject.ParamSpec.int('b-prop', 'B prop', 'declared on B', RW, 0, 100, 7),
                    },
                    Signals: { 'b-signal': {} },
                },
                MlB,
            );
        }
        bMethod() {
            return `B:${this.b_prop}`;
        }
    }

    // Both levels carry their own GType identity.
    assert.equal(GObject.type_name(MlA.$gtype), 'NodeGiMlA');
    assert.equal(GObject.type_name(MlB.$gtype), 'NodeGiMlB');

    const b = new MlB();
    // `new B()` is B's GType (the leaf), and B is-a the introspected root.
    assert.equal(native.getTypeName(unwrap(b)), 'NodeGiMlB');
    assert.equal(native.isInstanceOf(unwrap(b), 'GObject', 'Object'), true);

    // An INHERITED custom property (declared on A) reads its default + is writable on a
    // B instance — the owner-type-keyed per-instance store routes it correctly.
    assert.equal(b.a_prop, 'a-default');
    b.a_prop = 'set-on-b';
    assert.equal(b.a_prop, 'set-on-b');
    assert.equal(b.aMethod(), 'A:set-on-b');

    // B's OWN property works alongside the inherited one.
    assert.equal(b.b_prop, 7);
    b.b_prop = 42;
    assert.equal(b.b_prop, 42);
    assert.equal(b.bMethod(), 'B:42');

    // An A-signal connects + emits on a B instance (signals walk the ancestry).
    // GJS parity: the handler receives the emitter first, then the signal params.
    let aReceived = null;
    const aId = b.connect('a-signal', (emitter, n) => {
        assert.equal(emitter, b, 'the emitter is the B instance the signal fired on');
        aReceived = n;
    });
    b.emit('a-signal', 5);
    assert.equal(aReceived, 5);
    b.disconnect(aId);

    // A B-signal too.
    let bFired = 0;
    b.connect('b-signal', () => {
        bFired += 1;
    });
    b.emit('b-signal');
    assert.equal(bFired, 1);
});

test('2-level chain: an ancestor vfunc override fires when the leaf is constructed', () => {
    let constructedCount = 0;
    class MlVA extends GObject.Object {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlVA' }, MlVA);
        }
        vfunc_constructed() {
            constructedCount += 1;
        }
    }
    class MlVB extends MlVA {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlVB' }, MlVB);
        }
    }

    const b = new MlVB();
    assert.equal(native.getTypeName(unwrap(b)), 'NodeGiMlVB');
    // The ancestor's vfunc_constructed fired exactly once during the leaf's
    // construction (the vfunc slot composes through GObject inheritance).
    assert.equal(constructedCount, 1);
});

test('2-level chain: each level overrides vfunc_constructed + super, runs once in order', () => {
    // The canonical multi-level idiom (the storybook's StoryWidget shape): BOTH levels
    // override the same vfunc and chain up with super.vfunc_*(). Each level's override
    // must run EXACTLY ONCE, leaf-first, nesting through the ancestor to the C default
    // — NO infinite loop (the regression this guards) and NO double-run.
    const order = [];
    class MlSuperA extends GObject.Object {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlSuperA' }, MlSuperA);
        }
        vfunc_constructed() {
            order.push('A-before');
            super.vfunc_constructed(); // chains to the C base (GObject's constructed)
            order.push('A-after');
        }
    }
    class MlSuperB extends MlSuperA {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlSuperB' }, MlSuperB);
        }
        vfunc_constructed() {
            order.push('B-before');
            super.vfunc_constructed(); // chains to A's vfunc_constructed
            order.push('B-after');
        }
    }

    const b = new MlSuperB();
    assert.equal(native.getTypeName(unwrap(b)), 'NodeGiMlSuperB');
    // Leaf runs first, supers into the ancestor, the ancestor supers into the C base,
    // then each unwinds — each override body executed exactly once.
    assert.deepEqual(order, ['B-before', 'A-before', 'A-after', 'B-after']);
});

test('3-level chain: vfunc_constructed chains up through every level once, in order', () => {
    const order = [];
    class MlSc3Base extends GObject.Object {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlSc3Base' }, MlSc3Base);
        }
        vfunc_constructed() {
            order.push('Base<');
            super.vfunc_constructed();
            order.push('Base>');
        }
    }
    class MlSc3Mid extends MlSc3Base {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlSc3Mid' }, MlSc3Mid);
        }
        vfunc_constructed() {
            order.push('Mid<');
            super.vfunc_constructed();
            order.push('Mid>');
        }
    }
    class MlSc3Leaf extends MlSc3Mid {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlSc3Leaf' }, MlSc3Leaf);
        }
        vfunc_constructed() {
            order.push('Leaf<');
            super.vfunc_constructed();
            order.push('Leaf>');
        }
    }

    const leaf = new MlSc3Leaf();
    assert.equal(native.getTypeName(unwrap(leaf)), 'NodeGiMlSc3Leaf');
    assert.deepEqual(order, ['Leaf<', 'Mid<', 'Base<', 'Base>', 'Mid>', 'Leaf>']);
});

test('2-level chain: vfunc_dispose chains up in order (run_dispose), no loop', () => {
    const order = [];
    class MlDispA extends GObject.Object {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlDispA' }, MlDispA);
        }
        vfunc_dispose() {
            order.push('A-dispose');
            super.vfunc_dispose(); // chains to the C base dispose
        }
    }
    class MlDispB extends MlDispA {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlDispB' }, MlDispB);
        }
        vfunc_dispose() {
            order.push('B-dispose');
            super.vfunc_dispose(); // chains to A's dispose
        }
    }

    const b = new MlDispB();
    b.run_dispose(); // synchronously fires the dispose vtable chain
    // Leaf dispose first, then the ancestor's, then the C base — each once, no loop.
    assert.deepEqual(order, ['B-dispose', 'A-dispose']);
});

test('a leaf that does NOT override a vfunc still resolves its OWN methods', () => {
    // When only an ANCESTOR overrides a vfunc, the leaf has no record of its own and
    // inherits the ancestor's trampoline, which fires during constructType BEFORE the
    // leaf ctor attaches the leaf prototype. The wrapper's user prototype must still be
    // UPGRADED to the leaf's, so the leaf's own methods resolve (a regression the
    // multi-level vfunc work could otherwise introduce).
    class MlProtoBase extends GObject.Object {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlProtoBase' }, MlProtoBase);
        }
        vfunc_constructed() {
            super.vfunc_constructed();
            this._builtByBase = true;
        }
        baseOnly() {
            return 'base';
        }
    }
    class MlProtoLeaf extends MlProtoBase {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlProtoLeaf' }, MlProtoLeaf);
        }
        leafOnly() {
            return `leaf+${this.baseOnly()}`;
        }
    }

    const leaf = new MlProtoLeaf();
    assert.equal(native.getTypeName(unwrap(leaf)), 'NodeGiMlProtoLeaf');
    assert.equal(leaf._builtByBase, true, 'the ancestor vfunc_constructed ran');
    assert.equal(leaf.baseOnly(), 'base', "the ancestor's own method resolves");
    assert.equal(leaf.leafOnly(), 'leaf+base', "the LEAF's own method resolves (proto upgraded)");
});

test('3-level registered chain (storybook shape) constructs + composes every ancestor', () => {
    // Base extends an INTROSPECTED GObject (the storybook uses Adw.Bin; GObject.Object
    // keeps this on the headless gate). Mid extends the registered Base, Leaf extends
    // the registered Mid — three registered levels over one introspected root.
    class MlBase extends GObject.Object {
        static {
            GObject.registerClass(
                {
                    GTypeName: 'NodeGiMl3Base',
                    Properties: { 'base-prop': GObject.ParamSpec.string('base-prop', '', '', RW, 'base') },
                    Signals: { 'base-signal': {} },
                },
                MlBase,
            );
        }
        baseTag() {
            return `base:${this.base_prop}`;
        }
    }
    class MlMid extends MlBase {
        static {
            GObject.registerClass(
                {
                    GTypeName: 'NodeGiMl3Mid',
                    Properties: { 'mid-prop': GObject.ParamSpec.string('mid-prop', '', '', RW, 'mid') },
                },
                MlMid,
            );
        }
        midTag() {
            return `mid:${this.mid_prop}`;
        }
    }
    class MlLeaf extends MlMid {
        static {
            GObject.registerClass(
                {
                    GTypeName: 'NodeGiMl3Leaf',
                    Properties: { 'leaf-prop': GObject.ParamSpec.int('leaf-prop', '', '', RW, 0, 9, 3) },
                },
                MlLeaf,
            );
        }
        leafTag() {
            return `leaf:${this.leaf_prop}`;
        }
    }

    // Construct props span every level; the leaf builds the deepest GType.
    const leaf = new MlLeaf({ 'base-prop': 'B', 'mid-prop': 'M', 'leaf-prop': 5 });
    assert.equal(native.getTypeName(unwrap(leaf)), 'NodeGiMl3Leaf');
    assert.equal(leaf.base_prop, 'B');
    assert.equal(leaf.mid_prop, 'M');
    assert.equal(leaf.leaf_prop, 5);

    // Each ancestor's prototype method resolves on the leaf instance.
    assert.equal(leaf.baseTag(), 'base:B');
    assert.equal(leaf.midTag(), 'mid:M');
    assert.equal(leaf.leafTag(), 'leaf:5');

    // A signal declared two levels up (Base) fires on a Leaf instance.
    let fired = 0;
    leaf.connect('base-signal', () => {
        fired += 1;
    });
    leaf.emit('base-signal');
    assert.equal(fired, 1);

    // A default ancestor prop is readable without being passed at construction.
    const leaf2 = new MlLeaf();
    assert.equal(leaf2.base_prop, 'base');
    assert.equal(leaf2.mid_prop, 'mid');
    assert.equal(leaf2.leaf_prop, 3);
});

test('an unregistered leaf subclass throws the clear "not registered" error', () => {
    // A subclass of an INTROSPECTED GObject class that was NEVER passed to
    // registerClass must not silently build the introspected base type.
    class UnregLeaf extends Gio.SimpleAction {}
    assert.throws(() => new UnregLeaf(), /Object UnregLeaf is not registered with GObject\.registerClass\(\)/);

    // Same for an unregistered subclass of a REGISTERED class.
    class MlRegBase extends GObject.Object {
        static {
            GObject.registerClass({ GTypeName: 'NodeGiMlRegBase' }, MlRegBase);
        }
    }
    class UnregOfRegistered extends MlRegBase {}
    assert.throws(
        () => new UnregOfRegistered(),
        /Object UnregOfRegistered is not registered with GObject\.registerClass\(\)/,
    );

    // The registered base itself still constructs fine (sanity).
    assert.equal(native.getTypeName(unwrap(new MlRegBase())), 'NodeGiMlRegBase');
});
