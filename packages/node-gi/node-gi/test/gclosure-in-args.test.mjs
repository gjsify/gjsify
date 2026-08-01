// SPDX-License-Identifier: MIT
// @gjsify/node-gi — JS function → GClosure / GCallback IN-argument marshalling.
//
// Covers the L0 primitive (a JS function passed for a GObject.Closure IN-arg is
// marshalled as a real GClosure whose marshal calls the function) and its three L1
// consumers, all verified against gjs (`/usr/bin/gjs`) as the gold standard:
//   1. GLib.log_set_writer_func(fn)  — a plain GLogWriterFunc; fn receives a real log
//   2. GObject.Object.prototype.bind_property_full — a transform actually transforms
//   3. Gio.DBusExportedObject.wrapJSObject — an exported method round-trips (in dbus.test.mjs)
//   +  GObject.signal_connect_closure / GObject.source_set_closure — the raw primitive
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

// ---- 1. GLib.log_set_writer_func -------------------------------------------
//
// Installs the JS writer, emits a structured log, and asserts the writer received
// it. GLib allows only ONE g_log_set_writer_func per process (a second is a fatal
// g_error — same as gjs), so this is the single install for the whole test file;
// log_set_writer_default() below re-arms the default fallback but keeps the
// GLib-side wrapper in place.
test('GLib.log_set_writer_func: the JS writer receives a real structured log', () => {
    const seen = [];
    GLib.log_set_writer_func((level, fields) => {
        seen.push({ level, fields });
        return GLib.LogWriterOutput.HANDLED;
    });

    GLib.log_structured('node-gi-writer-test', GLib.LogLevelFlags.LEVEL_MESSAGE, {
        MESSAGE: 'hello writer',
        MY_FIELD: 'custom',
    });

    const rec = seen.find((r) => {
        const m = r.fields.MESSAGE;
        return m && Buffer.from(m).toString('utf8') === 'hello writer';
    });
    assert.ok(rec, 'the writer saw the emitted MESSAGE');
    assert.equal(rec.level, GLib.LogLevelFlags.LEVEL_MESSAGE);
    // Field values are Uint8Arrays of the field bytes (gjs recursiveUnpack shape).
    assert.ok(rec.fields.MESSAGE instanceof Uint8Array, 'field value is a Uint8Array');
    assert.equal(Buffer.from(rec.fields.MY_FIELD).toString('utf8'), 'custom');
    assert.equal(Buffer.from(rec.fields.GLIB_DOMAIN).toString('utf8'), 'node-gi-writer-test');

    // Re-arm the default writer (route further logs to g_log_writer_default).
    GLib.log_set_writer_default();
});

// ---- 2. GObject.Object.prototype.bind_property_full ------------------------

const PropObj = GObject.registerClass(
    {
        GTypeName: 'NodeGiBindFullTestObj',
        Properties: {
            string: GObject.ParamSpec.string('string', 'String', 'S', GObject.ParamFlags.READWRITE, ''),
            bool: GObject.ParamSpec.boolean('bool', 'Bool', 'B', GObject.ParamFlags.READWRITE, true),
            num: GObject.ParamSpec.int('num', 'Num', 'N', GObject.ParamFlags.READWRITE, -1000, 1000, 0),
        },
    },
    class NodeGiBindFullTestObj extends GObject.Object {},
);

test('bind_property_full: a transform-to actually transforms a bound value', () => {
    const a = new PropObj();
    const b = new PropObj();
    let sawSource;
    a.bind_property_full(
        'bool',
        b,
        'string',
        GObject.BindingFlags.NONE,
        (_binding, source) => {
            sawSource = source;
            return [true, `${source}`];
        },
        null,
    );
    a.bool = true;
    assert.equal(b.string, 'true', 'the transform wrote the converted value to the target');
    assert.equal(sawSource, true, 'the transform received the unpacked source value');
});

test('bind_property_full: [false, …] leaves the target unchanged', () => {
    const a = new PropObj();
    const b = new PropObj();
    b.string = 'unchanged';
    a.bind_property_full('num', b, 'string', GObject.BindingFlags.NONE, () => [false, 'nope'], null);
    a.num = 7;
    assert.equal(b.string, 'unchanged');
});

test('bind_property_full: bidirectional transform-from converts back', () => {
    const e = new PropObj();
    const f = new PropObj();
    e.bind_property_full(
        'num',
        f,
        'string',
        GObject.BindingFlags.BIDIRECTIONAL,
        (_binding, src) => [true, `n:${src}`],
        (_binding, src) => [true, parseInt(String(src).replace('n:', ''), 10) + 1],
    );
    e.num = 5;
    assert.equal(f.string, 'n:5', 'forward transform');
    f.string = 'n:41';
    assert.equal(e.num, 42, 'reverse transform');
});

test('bind_property_full: null transforms = a plain copy binding', () => {
    const g = new PropObj();
    const h = new PropObj();
    g.bind_property_full('string', h, 'string', GObject.BindingFlags.NONE, null, null);
    g.string = 'plain';
    assert.equal(h.string, 'plain');
});

// ---- 3. Raw primitive: signal_connect_closure / source_set_closure ---------

test('GObject.signal_connect_closure: a JS fn as a GClosure signal handler fires', () => {
    const action = new Gio.SimpleAction({ name: 'x', enabled: true });
    const seen = [];
    const id = GObject.signal_connect_closure(
        action,
        'notify::enabled',
        (obj, pspec) => {
            seen.push([obj === action, pspec.name]);
        },
        false,
    );
    assert.equal(typeof id, 'number');
    assert.ok(id > 0);
    action.set_enabled(false);
    assert.deepEqual(seen, [[true, 'enabled']]);
    // After disconnect the closure no longer fires (and its JS ref can be released).
    GObject.signal_handler_disconnect(action, id);
    action.set_enabled(true);
    assert.deepEqual(seen, [[true, 'enabled']], 'no dispatch after disconnect');
});

test('GObject.source_set_closure: a JS fn drives a timeout source', () => {
    const loop = GLib.MainLoop.new(null, false);
    let ticks = 0;
    const source = GLib.timeout_source_new(5);
    GObject.source_set_closure(source, () => {
        ticks++;
        if (ticks >= 2) {
            loop.quit();
            return false;
        }
        return true;
    });
    source.attach(null);
    loop.run();
    assert.equal(ticks, 2);
});

// ---- 4. GC/lifetime: the closure's strong napi_ref is the ONLY root ---------
//
// A JS fn handed to signal_connect_closure is rooted by nothing but the
// marshaled GClosure's JsClosureData napi_ref (ref+sunk by the connection):
// with every JS reference dropped it must survive a full GC while connected
// (an under-rooted weak ref would collect it → the emit would be a
// use-after-free), and disconnecting must release it (closure invalidate →
// JsClosureFinalize → napi_delete_reference) so the fn becomes collectable —
// not a process-lifetime leak. Node --expose-gc leg only (bun/deno run this
// file in the cross-runtime subset without an exposed deterministic gc).
const isNodeGc =
    typeof process !== 'undefined' &&
    Boolean(process.versions?.node) &&
    !process.versions?.bun &&
    typeof globalThis.Deno === 'undefined' &&
    typeof globalThis.gc === 'function';
test(
    'GC: a connected closure survives gc; disconnect releases the fn',
    { skip: !isNodeGc && 'needs node --test --expose-gc (npm run test:gc)' },
    async () => {
        // Bun's node:test shim ignores the `skip` option and runs the body anyway —
        // bail imperatively on any runtime without Node's exposed deterministic gc.
        if (!isNodeGc) return;
        const action = new Gio.SimpleAction({ name: 'gc-root', enabled: true });
        let collected = false;
        const registry = new FinalizationRegistry(() => {
            collected = true;
        });
        const state = { seen: 0 };
        // Connect inside a helper so no live frame slot can pin the handler; only
        // the handler id escapes.
        const connectHandler = () => {
            const fn = () => {
                state.seen++;
            };
            registry.register(fn, 'handler');
            return GObject.signal_connect_closure(action, 'notify::enabled', fn, false);
        };
        const id = connectHandler();

        globalThis.gc();
        globalThis.gc();
        await new Promise((resolve) => setImmediate(resolve));
        globalThis.gc();
        assert.equal(collected, false, 'the handler must NOT be collected while connected');
        action.set_enabled(false);
        assert.equal(state.seen, 1, 'the closure-rooted handler still fires after GC');

        GObject.signal_handler_disconnect(action, id);
        for (let i = 0; i < 100 && !collected; i++) {
            globalThis.gc();
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.equal(collected, true, 'the handler must be collectable after disconnect');
        action.set_enabled(true);
        assert.equal(state.seen, 1, 'no dispatch after disconnect');
    },
);

test('a throwing GClosure handler is surfaced, not propagated (loop-dispatched)', () => {
    const action = new Gio.SimpleAction({ name: 'y', enabled: true });
    GObject.signal_connect_closure(
        action,
        'notify::enabled',
        () => {
            throw new Error('boom-closure');
        },
        false,
    );
    // gjs logs an uncaught handler exception rather than propagating it to the
    // trigger site — set_enabled must return normally.
    assert.doesNotThrow(() => action.set_enabled(false));
});
