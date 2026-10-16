// SPDX-License-Identifier: MIT
// @gjsify/node-gi — `findProtoDescriptor` resolves a wrapper's members against the
// LIVE prototype chain, and must keep doing so now that it reads the prototype
// Proxies' targets directly (protoInternals, gi.js).
//
// Why this file exists: the walk is on the hottest path there is — one
// full-depth traversal per property GET, per SET and per `emit` — and the obvious
// fix is a (prototype, name) memo. It is the wrong fix, because it needs an
// invalidation story JS cannot supply: nothing notifies on `Cls.prototype.m = …`,
// `Object.defineProperty(proto, …)`, `delete proto.m` or `setPrototypeOf`. Measured
// on gjs 1.88.1, every one of those is observable on an ALREADY-wrapped instance —
// GJS pins nothing at registerClass time, a GObject prototype is an ordinary mutable
// JS object and its `resolve` hook only fills in what is not there yet. A memo would
// therefore answer from a shape the program has since changed, which is exactly the
// bug class the sibling file (resolution-caches.test.mjs) guards the other seven
// caches against — except here the wrong key is the TIME, not the type.
//
// So nothing is remembered between calls and the walk is only made CHEAPER: the
// descriptor read runs on the Proxy's own TARGET, which is where every mutation of
// the prototype lands (no handler traps `set`, `defineProperty`, `deleteProperty` or
// `setPrototypeOf`), after running the same materializer the descriptor trap runs.
// The tests below are the proof obligation of that claim — each mutates a chain an
// instance has already been observed through, warms it the way a memo would be
// warmed, and asks the instance to report the mutation.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

/** A registered subclass with a declared property and a signal — the bench's subject shape. */
function subjectClass(gtypeName) {
    return GObject.registerClass(
        {
            GTypeName: gtypeName,
            Properties: {
                label: GObject.ParamSpec.string('label', '', '', GObject.ParamFlags.READWRITE, ''),
            },
            Signals: { changed: { param_types: [GObject.TYPE_STRING] } },
        },
        class extends GObject.Object {},
    );
}

test('a method added to the prototype AFTER the instance was observed is reached', () => {
    const K = subjectClass('NodeGiProtoLateMethod');
    const o = new K();
    // Observe the instance hard first: whatever a cache would warm, warm it.
    for (let i = 0; i < 5; i++) {
        o.label = i % 2 === 0 ? 'a' : 'b';
        o.emit('changed', 'x');
    }
    assert.equal(o.later, undefined, 'absent before it is added');
    assert.equal('later' in o, false);

    K.prototype.later = function () {
        return `later:${this.label}`;
    };
    assert.equal(typeof o.later, 'function', 'the live chain carries it now');
    assert.equal(o.later(), 'later:a', 'and it runs with the wrapper as `this`');
    assert.equal('later' in o, true, 'the has trap walks the same live chain');
    assert.equal(o.later, K.prototype.later, 'the prototype function itself, unbound (#1175)');
});

test('a redefined accessor takes effect immediately, on read AND on write', () => {
    const K = subjectClass('NodeGiProtoRedefinedAccessor');
    const o = new K();
    o.label = 'one';
    assert.equal(o.label, 'one', 'the GObject property answers while no accessor shadows it');

    const writes = [];
    Object.defineProperty(K.prototype, 'label', {
        configurable: true,
        get() {
            return 'SHADOW';
        },
        set(value) {
            writes.push(value);
        },
    });
    assert.equal(o.label, 'SHADOW', 'the new getter wins on an instance wrapped before it existed');
    o.label = 'two';
    assert.deepEqual(writes, ['two'], 'and the new setter took the write');

    delete K.prototype.label;
    assert.equal(o.label, 'one', 'removing the accessor uncovers the GObject property again');
});

test('a deleted prototype member goes back to undefined', () => {
    const K = subjectClass('NodeGiProtoDeletedMember');
    const o = new K();
    K.prototype.gone = () => 'here';
    assert.equal(o.gone(), 'here');
    // Warm it the way a memo would be warmed.
    for (let i = 0; i < 5; i++) assert.equal(typeof o.gone, 'function');

    delete K.prototype.gone;
    assert.equal(o.gone, undefined, 'absence is re-resolved, not remembered from the hit');
    assert.equal('gone' in o, false);
});

test('an object spliced into the chain with setPrototypeOf is walked', () => {
    const K = subjectClass('NodeGiProtoSplicedChain');
    const o = new K();
    assert.equal(o.spliced, undefined);

    const base = Object.getPrototypeOf(K.prototype);
    const extra = Object.create(base);
    extra.spliced = () => 'from-the-splice';
    Object.setPrototypeOf(K.prototype, extra);
    try {
        assert.equal(o.spliced(), 'from-the-splice', 'a chain that GREW is walked to its new end');
        assert.equal('spliced' in o, true);
        // The rest of the chain is still reachable past the spliced link.
        o.label = 'kept';
        assert.equal(o.label, 'kept');
    } finally {
        Object.setPrototypeOf(K.prototype, base);
    }
    assert.equal(o.spliced, undefined, 'and a chain that SHRANK stops reporting it');
});

test('a late member on an INTROSPECTED prototype reaches an existing instance', () => {
    // Not a registerClass subclass: the prototype here IS the makeClassPrototype Proxy,
    // i.e. the link the walk now reads past, so this is where reading the target instead
    // of the Proxy has to give the same answers — including for a name assigned to the
    // Proxy later, which lands on that same target.
    const c = new Gio.Cancellable();
    assert.equal(c.lateOnIntrospected, undefined);
    assert.equal(typeof c.is_cancelled, 'function', 'the introspected method materializes as before');

    Gio.Cancellable.prototype.lateOnIntrospected = function () {
        return this.is_cancelled();
    };
    try {
        assert.equal(c.lateOnIntrospected(), false);
        c.cancel();
        assert.equal(c.lateOnIntrospected(), true, 'and it reads the instance it was taken from');
    } finally {
        delete Gio.Cancellable.prototype.lateOnIntrospected;
    }
    assert.equal(c.lateOnIntrospected, undefined);
});

test('a late override of a signal shortcut still wins over the built-in one', () => {
    // `emit`/`connect`/`disconnect` are resolved through findProtoDescriptor BEFORE the
    // per-wrapper shortcut (SIGNAL_API_SHORTCUTS), and gjs 1.88.1 lets a prototype shadow
    // them at any time — measured. The bypass must not freeze the pre-override answer.
    const K = subjectClass('NodeGiProtoLateShortcut');
    const o = new K();
    let emitted = 0;
    o.connect('changed', () => {
        emitted++;
    });
    o.emit('changed', 'x');
    assert.equal(emitted, 1, 'the built-in shortcut emitted');

    const seen = [];
    K.prototype.emit = function (signal) {
        seen.push(signal);
        return undefined;
    };
    try {
        o.emit('changed', 'y');
        assert.deepEqual(seen, ['changed'], 'the late override took the call');
        assert.equal(emitted, 1, 'and the real emission did not happen');
    } finally {
        delete K.prototype.emit;
    }
    o.emit('changed', 'z');
    assert.equal(emitted, 2, 'removing the override restores the built-in shortcut');
});

test('a declared property with a class accessor still writes through on every set', () => {
    // The setter path memoizes the SETTER per (prototype, property) — findPropertySetter —
    // and resolves it through the same walk. A walk that answered "absent" for a name the
    // chain does carry would silently turn every such write into a plain store.
    const K = GObject.registerClass(
        {
            GTypeName: 'NodeGiProtoAccessorSetter',
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
    o.lineNumbers = true;
    assert.deepEqual(o.seen, [true, false, true], 'all three writes reached the camelCase setter');
});

test('a name that only Object.prototype carries is not mistaken for a class member', () => {
    // The walk stops AT Object.prototype — and the bypass follows the Proxy's TARGET's
    // prototype, so the stop condition has to still be reached. `hasOwnProperty` must
    // miss here and be answered by the wrapper's own inherited-member branch instead.
    const K = subjectClass('NodeGiProtoObjectProtoName');
    const o = new K();
    assert.equal(typeof o.hasOwnProperty, 'function');
    assert.equal(o.hasOwnProperty('nothing'), false);
    assert.equal(typeof o.isPrototypeOf, 'function');
    assert.equal(o.propertyIsEnumerable('label'), false);
});
