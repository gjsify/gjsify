// SPDX-License-Identifier: MIT
// GObject.js override-parity tests for @gjsify/node-gi (Phase 3.2).
//
// Covers the convenience surface gjs adds over introspected GObject
// (refs/gjs/modules/core/overrides/GObject.js): the by-function signal-handler ops
// (signal_handlers_{block,unblock,disconnect}_by_func) + their prototype-method
// twins (block_signal_handler / unblock_signal_handler / stop_emission_by_name),
// GObject.Value construction + set_*/get_*/copy/unset + the 2-arg convenience,
// GObject.Object.new(gtype, props), and the AccumulatorType fake enum. Every
// numeric behaviour is asserted against a base-typelib GObject (Gio.SimpleAction,
// a headless GObject with a boolean `enabled` property whose set fires notify::)
// and — for the load-bearing signal counts + GValue round-trips — checked
// byte-for-byte against the GOLD STANDARD (the SAME probe body run under `gjs -m`).
//
// Reference: refs/gjs/modules/core/overrides/GObject.js; verified vs gjs 1.88.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as native from '../index.js';
import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

const hasGjs = spawnSync('gjs', ['--version'], { stdio: 'ignore' }).status === 0;

// Run a stringifiable probe body under `gjs -m` (native gi://) with the given
// import + call prelude, returning its stdout lines. The exactness oracle: the
// SAME `fn` body runs on node-gi and on gjs; both print the formatted lines.
function gjsProbeLines(fn, prelude) {
    const dir = mkdtempSync(join(tmpdir(), 'nodegi-gobj-gjs-'));
    try {
        const script = join(dir, 'probe.js');
        writeFileSync(
            script,
            `${prelude}\nconst __probe = ${fn.toString()};\nfor (const l of __probe(...__args)) print(l);\n`,
        );
        const res = spawnSync('gjs', ['-m', script], { encoding: 'utf8' });
        assert.equal(res.status, 0, `gjs probe failed: ${res.stderr}`);
        return res.stdout.trimEnd().split('\n');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ---- signal_handlers_{block,unblock,disconnect}_by_func -------------------

// The shared body: connect the SAME handler twice + a third throwaway, then
// block/unblock/disconnect BY FUNC around notify::enabled emissions, reporting the
// hit-count and the running callback count at each step.
function signalsByFuncProbe(GObjectNs, GioNs) {
    const out = [];
    const a = new GioNs.SimpleAction({ name: 'x', enabled: true });
    let count = 0;
    const handler = () => {
        count++;
    };
    a.connect('notify::enabled', handler);
    a.connect('notify::enabled', handler);
    a.connect('notify::enabled', () => {});
    a.set_enabled(false);
    out.push(`after1 ${count}`);
    out.push(`blocked ${GObjectNs.signal_handlers_block_by_func(a, handler)}`);
    a.set_enabled(true);
    out.push(`after2 ${count}`);
    out.push(`unblocked ${GObjectNs.signal_handlers_unblock_by_func(a, handler)}`);
    a.set_enabled(false);
    out.push(`after3 ${count}`);
    out.push(`disconnected ${GObjectNs.signal_handlers_disconnect_by_func(a, handler)}`);
    a.set_enabled(true);
    out.push(`after4 ${count}`);
    out.push(`disc-unknown ${GObjectNs.signal_handlers_disconnect_by_func(a, () => {})}`);
    return out;
}

test('signal_handlers_{block,unblock,disconnect}_by_func track private closures', () => {
    const lines = signalsByFuncProbe(GObject, Gio);
    assert.deepEqual(lines, [
        'after1 2', // both handler connections fire (throwaway too, but count is handler-only)
        'blocked 2', // two ids matched the function
        'after2 2', // blocked → no increment
        'unblocked 2', // two ids matched
        'after3 4', // unblocked → +2
        'disconnected 2', // two ids matched + removed
        'after4 4', // disconnected → no increment
        'disc-unknown 0', // an unconnected function matches nothing
    ]);
});

test(
    'signal by-func ops are byte-identical to gjs (gold standard)',
    { skip: hasGjs ? false : 'gjs not on PATH' },
    () => {
        const ours = signalsByFuncProbe(GObject, Gio).join('\n');
        const theirs = gjsProbeLines(
            signalsByFuncProbe,
            `import GObject from 'gi://GObject?version=2.0';\nimport Gio from 'gi://Gio?version=2.0';\nconst __args = [GObject, Gio];`,
        ).join('\n');
        assert.equal(ours, theirs, 'node-gi and gjs by-func signal ops agree line-for-line');
    },
);

// ---- prototype-method signal conveniences ---------------------------------

test('block_signal_handler / unblock_signal_handler gate a single handler by id', () => {
    const a = new Gio.SimpleAction({ name: 'y', enabled: true });
    let c = 0;
    const id = a.connect('notify::enabled', () => {
        c++;
    });
    a.block_signal_handler(id);
    a.set_enabled(false);
    assert.equal(c, 0, 'blocked handler does not fire');
    a.unblock_signal_handler(id);
    a.set_enabled(true);
    assert.equal(c, 1, 'unblocked handler fires again');
});

test('stop_emission_by_name halts a signal from a handler', () => {
    const a = new Gio.SimpleAction({ name: 'z', enabled: true });
    let first = 0;
    let second = 0;
    a.connect('notify::enabled', () => {
        first++;
        a.stop_emission_by_name('notify::enabled');
    });
    a.connect('notify::enabled', () => {
        second++;
    });
    a.set_enabled(false);
    assert.equal(first, 1, 'the first handler ran');
    assert.equal(second, 0, 'stop_emission_by_name prevented the second handler');
});

test('GObject.signal_connect / signal_emit_by_name route through the instance', () => {
    const a = new Gio.SimpleAction({ name: 'c', enabled: true });
    let n = 0;
    const handler = () => {
        n++;
    };
    GObject.signal_connect(a, 'notify::enabled', handler);
    a.set_enabled(false);
    assert.equal(n, 1);
    // A signal_connect-registered handler is in the by-func registry too.
    assert.equal(GObject.signal_handlers_block_by_func(a, handler), 1);
    a.set_enabled(true);
    assert.equal(n, 1, 'still blocked');
});

test('signal_handlers_disconnect_by_data throws the gjs not-introspectable error', () => {
    assert.throws(() => GObject.signal_handlers_disconnect_by_data(), /not introspectable/);
});

// ---- GObject.Value --------------------------------------------------------

// The shared body: build empty + typed GValues, round-trip set_*/get_*, copy, and
// the 2-arg convenience across the fundamental types base typelibs expose.
function valueProbe(GObjectNs) {
    const out = [];
    const v = new GObjectNs.Value();
    v.init(GObjectNs.TYPE_INT);
    v.set_int(42);
    out.push(`int ${v.get_int()}`);
    out.push(`string ${new GObjectNs.Value(GObjectNs.TYPE_STRING, 'hi').get_string()}`);
    out.push(`bool ${new GObjectNs.Value(GObjectNs.TYPE_BOOLEAN, true).get_boolean()}`);
    out.push(`double ${new GObjectNs.Value(GObjectNs.TYPE_DOUBLE, 3.5).get_double()}`);
    out.push(`uint ${new GObjectNs.Value(GObjectNs.TYPE_UINT, 7).get_uint()}`);
    const other = new GObjectNs.Value();
    other.init(GObjectNs.TYPE_INT);
    v.copy(other);
    out.push(`copy ${other.get_int()}`);
    out.push(`compatible ${GObjectNs.Value.type_compatible(GObjectNs.TYPE_INT, GObjectNs.TYPE_INT)}`);
    return out;
}

test('GObject.Value: new/init/set_*/get_*/copy + the 2-arg convenience', () => {
    const lines = valueProbe(GObject);
    assert.deepEqual(lines, ['int 42', 'string hi', 'bool true', 'double 3.5', 'uint 7', 'copy 42', 'compatible true']);
    // get_int returns a JS number, not a boxed handle.
    const v = new GObject.Value();
    v.init(GObject.TYPE_INT);
    v.set_int(5);
    assert.equal(typeof v.get_int(), 'number');
    // instanceof recognises a wrapped GValue (boxed GType GValue).
    assert.ok(v instanceof GObject.Value);
    assert.ok(!(new Gio.SimpleAction({ name: 'q' }) instanceof GObject.Value));
});

test('GObject.Value is byte-identical to gjs (gold standard)', { skip: hasGjs ? false : 'gjs not on PATH' }, () => {
    const ours = valueProbe(GObject).join('\n');
    const theirs = gjsProbeLines(
        valueProbe,
        `import GObject from 'gi://GObject?version=2.0';\nconst __args = [GObject];`,
    ).join('\n');
    assert.equal(ours, theirs, 'node-gi and gjs GObject.Value agree line-for-line');
});

test('GObject.Value 2-arg convenience rejects an unsupported type', () => {
    // TYPE_NONE (void) has no setter — gjs throws a TypeError from the constructor.
    assert.throws(() => new GObject.Value(GObject.TYPE_NONE, 1), /Invalid type argument/);
});

// ---- GObject.Object.new ---------------------------------------------------

test('GObject.Object.new(gtype, props) constructs the right runtime type', () => {
    const o = GObject.Object.new(Gio.SimpleAction.$gtype, { name: 'made', enabled: false });
    assert.equal(o.name, 'made');
    assert.equal(o.enabled, false);
    assert.equal(o.get_name(), 'made'); // a real GSimpleAction instance method works
    // A class ctor (carrying $gtype) is accepted for the gtype arg too.
    const o2 = GObject.Object.new(Gio.SimpleAction, { name: 'ctor' });
    assert.equal(o2.name, 'ctor');
});

test('GObject.Object.new_with_properties zips names + values', () => {
    const o = GObject.Object.new_with_properties(Gio.SimpleAction.$gtype, ['name', 'enabled'], ['zip', false]);
    assert.equal(o.name, 'zip');
    assert.equal(o.enabled, false);
    assert.throws(
        () => GObject.Object.new_with_properties(Gio.SimpleAction.$gtype, ['name'], ['a', 'b']),
        /equal-length arrays/,
    );
});

// ---- bind_property + bind_property_full (both work) ------------------------

test('bind_property (no transform) is introspected and syncs', () => {
    const src = new Gio.SimpleAction({ name: 's', enabled: true });
    const dst = new Gio.SimpleAction({ name: 'd', enabled: false });
    src.bind_property('enabled', dst, 'enabled', GObject.BindingFlags.SYNC_CREATE);
    assert.equal(dst.enabled, true, 'SYNC_CREATE copied the source value');
    src.enabled = false;
    assert.equal(dst.enabled, false, 'a later source change propagates');
});

test('bind_property_full runs the JS transform (GClosure IN-arg)', () => {
    // The transform closures are driven natively (GjsPrivate-mirror); the JS
    // transform-to must actually convert the source value into the target. Full
    // coverage lives in test/gclosure-in-args.test.mjs — this is the override-layer
    // smoke test that the prototype method is wired to the native path (no throw).
    const src = new Gio.SimpleAction({ name: 's2', enabled: true });
    const dst = new Gio.SimpleAction({ name: 'd2', enabled: false });
    let sawSource;
    src.bind_property_full(
        'enabled',
        dst,
        'enabled',
        GObject.BindingFlags.DEFAULT,
        (_binding, source) => {
            sawSource = source;
            return [true, !source];
        },
        null,
    );
    src.enabled = false;
    assert.equal(sawSource, false, 'the transform received the source value');
    assert.equal(dst.enabled, true, 'the inverted transform result reached the target');
});

// ---- ParamFlags / SignalFlags / AccumulatorType / TYPE_* ------------------

test('ParamFlags keeps every introspected bit (not just the convenience 5)', () => {
    // READWRITE is the convenience combo; CONSTRUCT_ONLY a real bit that a hardcoded
    // 5-member table might have dropped to undefined (→ 0). Both must be real numbers.
    assert.equal(GObject.ParamFlags.READWRITE, 3);
    assert.equal(typeof GObject.ParamFlags.CONSTRUCT_ONLY, 'number');
    assert.equal(typeof GObject.ParamFlags.EXPLICIT_NOTIFY, 'number');
});

test('AccumulatorType is the gjs fake enum', () => {
    assert.deepEqual({ ...GObject.AccumulatorType }, { NONE: 0, FIRST_WINS: 1, TRUE_HANDLED: 2 });
});

test('the fundamental GObject.TYPE_* are real process GTypes', () => {
    // Opaque GType handles (like gjs's GType objects), resolvable by type_name.
    assert.equal(native.getTypeName ? GObject.type_name(GObject.TYPE_INT) : 'gint', 'gint');
    assert.equal(GObject.type_name(GObject.TYPE_STRING), 'gchararray');
    assert.equal(GObject.type_name(GObject.TYPE_BOOLEAN), 'gboolean');
    assert.ok(GObject.type_is_a(GObject.TYPE_INT, GObject.TYPE_INT));
});
