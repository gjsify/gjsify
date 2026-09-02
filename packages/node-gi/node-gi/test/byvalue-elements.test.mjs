// SPDX-License-Identifier: MIT
// BY-VALUE container elements for @gjsify/node-gi — enum/flags members and whole
// records laid out in a C array's own cells, on the IN path.
//
// WHAT WAS WRONG. `IsSupportedElementType` admitted an INTERFACE element only when it
// was an object, an interface, or a struct POINTER; everything else deferred with
// "struct/union/enum element parameters are not yet supported", thrown before the
// invoke. That is one refusal covering two very different shapes, and it cost the whole
// `Gtk.Accessible` update surface — `update_property(n, GtkAccessibleProperty[],
// GValue[])` hits it twice, so a node host could set no ARIA property, state or
// relation at all. Measured against the installed typelibs, the same refusal stood in
// front of 140 IN parameters, including `Gio.ActionMap.add_action_entries`,
// `GObject.Object.newv`, `Gsk.LinearGradientNode.new` and `Gio.OutputStream.writev`.
//
// WHY IT IS NOT ONE CHANGE WITH THE POINTER CASE. A pointer element is one slot and
// travels in a GIArgument. A by-value element is its own width — 4 for an enum, 12 for
// a `Graphene.Point3D`, 24 for a `GValue`, 64 for a `Gio.ActionEntry` — and the array
// write loop copies `elemSize` bytes OUT OF a GIArgument union, which is eight. So
// "teach the size function the real size" alone would read past the union, off the
// stack, once per element, and still compile and still print plausible numbers.
//
// WHAT EACH TEST IS FOR, since a stride bug does not announce itself: every case reads
// its values BACK, with distinct per-element contents. An array laid out at the wrong
// stride yields the right element COUNT and the wrong element VALUES, so a test that
// only counted would pass straight through the defect this file exists to hold.
//
// ## WHICH NAMESPACES, and why that is stated rather than assumed
//
// The first version of this file chose its subjects by what was installed on one
// workstation — Atk, Graphene, Gst, Gsf — and six of its tests failed on the aarch64
// CI leg with "Typelib file for namespace 'Atk' not found". The tests were right and
// the environment was not measured, which is the same mistake in a different costume.
//
// So the load-bearing cases below use GLib/GObject/Gio ONLY, which every leg has.
// Measured while rewriting them: no by-value ENUM array parameter exists anywhere in
// GLib, GObject or Gio, so the enum stride has no core subject and its test is gated on
// Atk with a named skip. That is a real coverage gap and it is named here rather than
// hidden behind a green run: on a leg without Atk, nothing here checks the enum path.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

const GLib = requireGi('GLib', '2.0');
const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');

/** A skip reason when an optional namespace is absent, or `false` when it is there. */
function needs(namespace, version) {
    try {
        requireGi(namespace, version);
        return false;
    } catch {
        return `no ${namespace}-${version} typelib on this leg`;
    }
}

test('a by-value GValue array lands at the record’s own stride', () => {
    // `GObject.signal_emitv(instance_and_params[], signal_id, detail)` is the core
    // subject for this: one C array of GValue BY VALUE, and the callee reads BOTH cells
    // — element 0 for the instance to emit on, element 1 for the signal's parameter.
    //
    // That is what makes it a stride assertion rather than a smoke test. At an
    // eight-byte stride element 1 would be read out of element 0's interior, so the
    // handler could not receive the string below; the emit would either find no
    // instance at all or hand the handler garbage.
    const action = new Gio.SimpleAction({ name: 'emitv-probe' });
    const received = [];
    action.connect('activate', (_self, parameter) => {
        received.push(parameter === null ? null : parameter.get_string()[0]);
    });

    const instance = new GObject.Value();
    instance.init(Gio.SimpleAction.$gtype);
    instance.set_object(action);

    const parameter = new GObject.Value();
    parameter.init(GObject.TYPE_VARIANT);
    parameter.set_variant(GLib.Variant.new_string('the second cell'));

    GObject.signal_emitv([instance, parameter], GObject.signal_lookup('activate', Gio.SimpleAction.$gtype), 0);

    assert.deepEqual(received, ['the second cell'], 'both cells must reach the callee intact');
});

test('a GValue cell the callee FILLS is carried back to the caller', () => {
    // The shape that would otherwise be a SILENT no-op, which is worse than the refusal
    // it replaced. `GObject.Object.getv` writes its results INTO the caller's GValue
    // array — and the typelib gives no way to know that: measured, its `values`
    // parameter reports direction=IN, caller-allocates=false, transfer=none, byte for
    // byte the same flags as `GLib.parse_debug_string`'s read-only `keys`.
    //
    // Without the write-back the call would appear to succeed and leave the caller's
    // value empty. gjs has exactly that gap — measured on 1.88.1, where this same code
    // reads back `null` — so this is a deliberate divergence, and the missing
    // annotation is an upstream candidate rather than something to imitate.
    const action = new Gio.SimpleAction({ name: 'written-back' });
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);

    action.getv(['name'], [value]);

    assert.equal(value.get_string(), 'written-back');
});

test('two arrays sharing one length argument must agree on it', () => {
    // `getv(n_properties, names[], values[])` fills ONE length argument from TWO arrays
    // — measured: both name length index 0. The autofill wrote it once per array, so
    // the last array silently decided the count the callee read both by, and the
    // shorter one was read past its end inside the callee.
    //
    // gjs does not check this — measured on 1.88.1, `Gtk.Accessible.update_property(
    // [LABEL, DESCRIPTION], ['one'])` is accepted and reads out of bounds — so this is
    // a deliberate divergence and the cheaper side of one.
    const action = new Gio.SimpleAction({ name: 'mismatch' });
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);

    assert.throws(
        () => action.getv(['name', 'enabled'], [value]),
        /two arrays share length argument 0 but have different lengths \(2 and 1\)/,
    );
});

test('a by-value element must be a record of the element’s own type', () => {
    // NOT ergonomics — a safety property. The cell is `elemSize` wide and the copy
    // reads that many bytes out of the handle, so a handle of a SMALLER record type
    // would be read past its end.
    //
    // `GLib.DebugKey` is UNREGISTERED (no GType), which exercises the arm of the check
    // that has nothing to compare but the introspected size — and a plain object has
    // neither. Refusing it is also what gjs does: measured on 1.88.1, which answers
    // "not a subclass of GObject_Struct" for the same input.
    assert.throws(
        () => GLib.parse_debug_string('all', [{ key: 'a', value: 1 }]),
        /expected a record handle as a by-value array element/,
    );

    // THE OTHER ARM — comparing GTypes — has no core subject, and finding that out is
    // what this paragraph is for. The only REGISTERED by-value record in GLib/GObject/
    // Gio is `GObject.Value`, and a GValue element accepts any JS value by contract:
    // a `GLib.Variant` handed to one becomes a G_TYPE_VARIANT GValue rather than a
    // refusal, which is `JsToFreshGValue`'s documented behaviour and gjs's own. So the
    // GType comparison is asserted in the Graphene case below (`must be a
    // GraphenePoint3D, got GValue`), and on a leg without Graphene it goes unchecked.
    // Written down because the first version of this test asserted a throw here and
    // got a pass — the code was right and the expectation was not.
});

test('an IN array of enum elements marshals at the enum’s own stride', {
    skip: needs('Atk', '1.0'),
}, () => {
    // The one path with no core subject — measured while writing this file: GLib,
    // GObject and Gio have no by-value enum array parameter at all. `Atk.StateSet` is
    // the cheapest one that exists, needing no display and holding a pure in-memory
    // bitset. An enum's storage is 4 where a pointer is 8, so at the wrong stride the
    // SECOND member lands in the first one's padding and is never added — while the
    // element count stays two either way.
    const Atk = requireGi('Atk', '1.0');
    const set = new Atk.StateSet();

    set.add_states([Atk.StateType.VISIBLE, Atk.StateType.ENABLED]);

    assert.equal(set.contains_states([Atk.StateType.VISIBLE, Atk.StateType.ENABLED]), true);
    // A state that was NOT added must still be absent, or "contains" could be answering
    // true for anything and the line above would prove nothing.
    assert.equal(set.contains_states([Atk.StateType.BUSY]), false);
    // The empty array is the boundary the refusal path also took, and it must not be
    // read as "no argument".
    assert.equal(set.contains_states([]), true);
});

test('a by-value record that is NOT a GValue is copied from its handle', {
    skip: needs('Graphene', '1.0'),
}, () => {
    // The other half of the element rule: a GValue cell is initialised in place, every
    // other record is a bitwise copy out of a boxed handle. `Graphene.Point3D` is 12
    // bytes — not 8, not 16 — so a pointer-sized stride cannot accidentally produce the
    // right answer, and `Box.init_from_points` reports both elements back.
    //
    // Gated because Graphene is not on every leg; the GValue cases above are the ones
    // that always run.
    const Graphene = requireGi('Graphene', '1.0');

    const near = new Graphene.Point3D();
    near.init(1, 2, 3);
    const far = new Graphene.Point3D();
    far.init(7, 8, 9);

    const box = new Graphene.Box();
    box.init_from_points([near, far]);

    const min = box.get_min();
    const max = box.get_max();
    assert.deepEqual([min.x, min.y, min.z, max.x, max.y, max.z], [1, 2, 3, 7, 8, 9]);
});

test('a by-value record array whose callee adopts the elements is refused', {
    skip: needs('Gsf', '1'),
}, () => {
    // The ownership hole the POINTER half of this work shipped once and had to fix,
    // wearing a different shape. A by-value cell is a bitwise copy of a handle's
    // storage, so it shares whatever that record points at — safe exactly while we free
    // the buffer ourselves. On `transfer full` the callee frees the elements too, and
    // it would be freeing strings and boxeds the caller's handles still own. An
    // arbitrary record has no copy function to deep-copy with, so there is no general
    // remedy and the refusal is the answer.
    //
    // The cost is measured rather than assumed: across every installed typelib, of the
    // 140 IN parameters with a by-value element, 139 are `transfer=none` and exactly
    // ONE is not — this call, which exists to free what it is given. It is also the
    // only subject for this assertion, which is why the test is gated instead of
    // rewritten.
    const Gsf = requireGi('Gsf', '1');
    assert.throws(
        () => Gsf.property_settings_free([]),
        /transfer other than none is not yet supported/,
    );
});

const skipDisplay = haveDisplay ? false : 'no display (DISPLAY / WAYLAND_DISPLAY unset)';

test('the Gtk.Accessible update surface answers on node', { skip: skipDisplay }, () => {
    // The call this whole change was for. `update_property` takes an enum array AND a
    // by-value GValue array sharing one length argument, so it exercises every piece at
    // once; `update_state` and `update_relation` carry the identical shape. It is also
    // the only leg on which the PLAIN-VALUE path runs — gjs 1.88.1 accepts a bare
    // string here, so a node host that demanded a constructed GObject.Value would be a
    // dialect.
    const Gtk = requireGi('Gtk', '4.0');
    Gtk.init();
    const button = new Gtk.Button();

    button.update_property([Gtk.AccessibleProperty.LABEL], ['a label']);

    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);
    value.set_string('a described label');
    button.update_property(
        [Gtk.AccessibleProperty.LABEL, Gtk.AccessibleProperty.DESCRIPTION],
        ['a label', value],
    );

    button.update_state([Gtk.AccessibleState.BUSY], [true]);

    assert.throws(
        () =>
            button.update_property(
                [Gtk.AccessibleProperty.LABEL, Gtk.AccessibleProperty.DESCRIPTION],
                ['only one'],
            ),
        /two arrays share length argument 0/,
    );
});

test('a GValue array element is released after the invoke', { skip: skipDisplay }, () => {
    // OWNERSHIP, MEASURED — not asserted by construction. Each cell holds a GValue this
    // marshaller initialised, so `transfer=none` means each one needs `g_value_unset`
    // before the buffer is freed; without it every string in every call is stranded.
    //
    // `update_property` is the subject because it allocates nothing else per call, which
    // is what makes RSS readable here: the same loop through a GStreamer element factory
    // moves 98 MiB whether the cells are unset or not, because 4000 elements dominate it.
    //
    // A/B on one workstation, 4000 calls x 20 KiB, node 24: unset ON -> 0.1 MiB, unset
    // compiled out -> 78.4 MiB. The threshold below is a fraction of that gap, so the
    // test does not depend on the allocator returning pages.
    const Gtk = requireGi('Gtk', '4.0');
    Gtk.init();
    const button = new Gtk.Button();
    const big = 'x'.repeat(20 * 1024);
    const ROUNDS = 2000;

    for (let i = 0; i < 200; i++) {
        button.update_property([Gtk.AccessibleProperty.LABEL], [`warm ${i}`]);
    }
    const before = process.memoryUsage().rss;
    for (let i = 0; i < ROUNDS; i++) {
        button.update_property([Gtk.AccessibleProperty.LABEL], [`${i}${big}`]);
    }
    const grown = (process.memoryUsage().rss - before) / 1024 / 1024;

    assert.ok(
        grown < 10,
        `RSS grew ${grown.toFixed(1)} MiB over ${ROUNDS} calls carrying 20 KiB each; ` +
            'stranding every string would be about 40 MiB',
    );
});
