// SPDX-License-Identifier: MIT
// @gjsify/node-gi — emitting a signal with the wrong number of arguments THROWS.
//
// EmitSignal (src/signals.cc) read the declared parameter count from
// g_signal_query and then filled any gap from `env.Undefined()`. So a signal
// declared `(string, int)` and emitted with one argument marshalled the missing
// one from `undefined` — which JsToGValue turns into "" / 0 — and every handler
// received a plausible-looking argument the caller never passed. The mistake
// surfaced as wrong data wherever the handler put it, arbitrarily far from the
// emit, instead of at the emit.
//
// gjs refuses both directions; messages measured verbatim on gjs 1.88.1:
//   o.emit('changed', 's')           → Signal 'changed' on ArSig requires 2 args got 1
//   o.emit('changed', 's', 3, 4)     → Signal 'changed' on ArSig requires 2 args got 3
// Too MANY matters as much as too few: extra arguments were silently dropped, so a
// handler signature that had drifted from the declaration never said so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');

const Emitter = GObject.registerClass(
    {
        GTypeName: 'NodeGiEmitArity',
        Signals: {
            changed: { param_types: [GObject.TYPE_STRING, GObject.TYPE_INT] },
            plain: { param_types: [] },
        },
    },
    class extends GObject.Object {},
);

test('the declared arity is accepted and reaches the handler intact', () => {
    const o = new Emitter();
    let got;
    o.connect('changed', (...args) => {
        got = args;
    });
    o.emit('changed', 's', 3);
    assert.equal(got.length, 3, 'the emitter plus both declared params');
    assert.equal(got[0], o, 'the emitter comes first, as on gjs');
    assert.deepEqual(got.slice(1), ['s', 3]);
});

test('too few arguments throw instead of marshalling undefined into the gap', () => {
    const o = new Emitter();
    let calls = 0;
    o.connect('changed', () => {
        calls++;
    });
    assert.throws(() => o.emit('changed', 's'), /Signal 'changed' on NodeGiEmitArity requires 2 args got 1/);
    assert.throws(() => o.emit('changed'), /requires 2 args got 0/);
    assert.equal(calls, 0, 'and no handler ran on the refused emission');
});

test('too many arguments throw as well', () => {
    const o = new Emitter();
    assert.throws(() => o.emit('changed', 's', 3, 4), /requires 2 args got 3/);
    assert.throws(() => o.emit('plain', 'x'), /requires 0 args got 1/);
});

test('a parameterless signal still emits with no arguments', () => {
    const o = new Emitter();
    let calls = 0;
    o.connect('plain', () => {
        calls++;
    });
    o.emit('plain');
    assert.equal(calls, 1);
});

test('an undeclared signal is still the error it was', () => {
    const o = new Emitter();
    assert.throws(() => o.emit('no-such-signal'), /no signal 'no-such-signal'/);
});
