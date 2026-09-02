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
// `GObject.Object.newv`, `Gsk.LinearGradientNode.new`, `Gio.OutputStream.writev` and
// `Graphene.Box.init_from_points`.
//
// WHY IT IS NOT ONE CHANGE WITH THE POINTER CASE. A pointer element is one slot and
// travels in a GIArgument. A by-value element is its own width — 4 for an enum, 12 for
// a `Graphene.Point3D`, 24 for a `GValue`, 64 for a `Gio.ActionEntry` — and the array
// write loop copies `elemSize` bytes OUT OF a GIArgument union, which is eight. So
// "teach the size function the real size" alone would read past the union, off the
// stack, once per element, and still compile and still print plausible numbers. The
// records therefore never enter a GIArgument; each is written straight into its cell.
//
// WHAT EACH TEST IS FOR, since a stride bug does not announce itself: every case here
// reads its values BACK, with distinct per-element contents. An array laid out at the
// wrong stride yields the right element COUNT and the wrong element VALUES, so a test
// that only counted would pass through the exact defect this file exists to hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

test('an IN array of enum elements marshals at the enum’s own stride', () => {
    // Atk needs no display and `StateSet` is a pure in-memory bitset, which makes it
    // the cheapest readable subject for `AtkStateType[]` — a by-value enum element,
    // storage size 4 where a pointer is 8.
    const Atk = requireGi('Atk', '1.0');
    const set = new Atk.StateSet();

    set.add_states([Atk.StateType.VISIBLE, Atk.StateType.ENABLED]);

    // BOTH members, which is the assertion that sees a wrong stride: at 8 bytes per
    // cell the second enum lands in the padding of the first and `ENABLED` is never
    // added, while the count of elements passed stays two either way.
    assert.equal(set.contains_states([Atk.StateType.VISIBLE, Atk.StateType.ENABLED]), true);

    // A state that was NOT added must still be absent — otherwise "contains" could be
    // answering true for anything and the line above would prove nothing.
    assert.equal(set.contains_states([Atk.StateType.BUSY]), false);

    // The empty array is the boundary the refusal path also took, and it must not be
    // read as "no argument".
    assert.equal(set.contains_states([]), true);
});

test('an IN array of by-value records copies each record’s own bytes', () => {
    // `Graphene.Point3D` is 12 bytes — not 8, not 16 — so a pointer-sized stride cannot
    // accidentally produce the right answer, and `Box.init_from_points` reads both
    // elements and reports them back through `get_min`/`get_max`.
    const Graphene = requireGi('Graphene', '1.0');

    const near = new Graphene.Point3D();
    near.init(1, 2, 3);
    const far = new Graphene.Point3D();
    far.init(7, 8, 9);

    const box = new Graphene.Box();
    box.init_from_points([near, far]);

    const min = box.get_min();
    const max = box.get_max();
    assert.deepEqual(
        [min.x, min.y, min.z, max.x, max.y, max.z],
        [1, 2, 3, 7, 8, 9],
        'every component of both points must survive the copy',
    );
});

test('a by-value element must be a record of the element’s own type', () => {
    // NOT ergonomics — a safety property. The cell is `elemSize` wide and the copy
    // reads that many bytes out of the handle, so a handle of a SMALLER record type
    // would be read past its end. The check is by GType where the element has one and
    // by introspected size where it does not.
    const Graphene = requireGi('Graphene', '1.0');
    const GObject = requireGi('GObject', '2.0');
    const GLib = requireGi('GLib', '2.0');

    const box = new Graphene.Box();
    assert.throws(
        () => box.init_from_points([new GObject.Value()]),
        /must be a GraphenePoint3D, got GValue/,
        'the refusal names both the expected and the given type',
    );

    // `GLib.DebugKey` is UNREGISTERED (no GType), which is the other arm of the check:
    // there is nothing to compare but the introspected size, and a plain object has
    // neither. Refusing it is also what gjs does — measured on 1.88.1, which answers
    // "not a subclass of GObject_Struct" for the same input.
    assert.throws(
        () => GLib.parse_debug_string('all', [{ key: 'a', value: 1 }]),
        /expected a record handle as a by-value array element/,
    );
});

test('a by-value GValue array takes plain JS values, as gjs does', () => {
    // The one element kind written by INITIALISING in place rather than copying a
    // caller's bytes, and the reason the accessibility surface works from JS at all:
    // gjs 1.88.1 accepts `update_property([LABEL], ['text'])` with a bare string, so a
    // node host that demanded a constructed `GObject.Value` would be a dialect.
    //
    // `Gst.ElementFactory.make_with_properties` is the same `(names[], GValue[])` shape
    // as `update_property` and needs no display, which is why the plain-value contract
    // is pinned here rather than behind the display gate below.
    const Gst = requireGi('Gst', '1.0');
    const GObject = requireGi('GObject', '2.0');
    Gst.init(null);

    const fromPlain = Gst.ElementFactory.make_with_properties('fakesink', ['name'], ['plain-name']);
    assert.notEqual(fromPlain, null, 'the element must actually be created');
    assert.equal(fromPlain.get_name(), 'plain-name');

    // A constructed GObject.Value must work too, and it goes through g_value_copy
    // rather than a bitwise copy — otherwise unsetting our cell afterwards would free
    // the string the caller's own handle still points at.
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);
    value.set_string('boxed-name');
    const fromValue = Gst.ElementFactory.make_with_properties('fakesink', ['name'], [value]);
    assert.equal(fromValue.get_name(), 'boxed-name');
    // The caller's GValue is untouched by the call — the copy was independent.
    assert.equal(value.get_string(), 'boxed-name');
});

test('two arrays sharing one length argument must agree on it', () => {
    // `make_with_properties(factory, n, names[], values[])` fills ONE length argument
    // from TWO arrays, so without this check the last array silently decides the count
    // the callee reads both by, and the shorter one is read past its end inside the
    // callee. gjs does not check it — measured on 1.88.1, where
    // `update_property([LABEL, DESCRIPTION], ['one'])` is accepted and reads out of
    // bounds — so this is a deliberate divergence and the cheaper side of one.
    const Gst = requireGi('Gst', '1.0');
    Gst.init(null);

    assert.throws(
        () => Gst.ElementFactory.make_with_properties('fakesink', ['name', 'sync'], ['x']),
        /two arrays share length argument 1 but have different lengths \(2 and 1\)/,
    );
});

test('a by-value record array whose callee adopts the elements is refused', () => {
    // The ownership hole that the POINTER half of this work shipped once and had to
    // fix, wearing a different shape. A by-value record cell is a BITWISE copy of a
    // handle's storage, so it shares whatever that record points at — safe exactly
    // while we free the buffer ourselves. On `transfer full` the callee frees the
    // elements too, and it would be freeing strings and boxeds the caller's handles
    // still own. An arbitrary record has no copy function to deep-copy with, so there
    // is no general remedy and the refusal is the answer.
    //
    // The cost is measured rather than assumed: across every installed typelib, of the
    // 140 IN parameters with a by-value element, 139 are `transfer=none` and exactly
    // ONE is not — this call, which exists to free what it is given.
    const Gsf = requireGi('Gsf', '1');
    assert.throws(
        () => Gsf.property_settings_free([]),
        /transfer other than none is not yet supported/,
    );
});

const skip = haveDisplay ? false : 'no display (DISPLAY / WAYLAND_DISPLAY unset)';

test('the Gtk.Accessible update surface answers on node', { skip }, () => {
    // The call this whole change was for. `update_property` takes an enum array AND a
    // by-value GValue array sharing one length argument, so it exercises every piece
    // at once; `update_state` and `update_relation` carry the identical shape.
    const Gtk = requireGi('Gtk', '4.0');
    const GObject = requireGi('GObject', '2.0');
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

    // The refusal reaches this call too, and on the shape a caller actually mistypes.
    assert.throws(
        () =>
            button.update_property(
                [Gtk.AccessibleProperty.LABEL, Gtk.AccessibleProperty.DESCRIPTION],
                ['only one'],
            ),
        /two arrays share length argument 0/,
    );
});

test('a GValue array element is released after the invoke', { skip }, () => {
    // OWNERSHIP, MEASURED — not asserted by construction. Each cell holds a GValue this
    // marshaller initialised, so `transfer=none` means each one needs `g_value_unset`
    // before the buffer is freed; without it every string in every call is stranded.
    //
    // `update_property` is the subject because it allocates nothing else per call, which
    // is what makes RSS readable here: the same loop through
    // `Gst.ElementFactory.make_with_properties` moves 98 MiB whether the cells are unset
    // or not, because 4000 GStreamer elements dominate it.
    //
    // A/B on this workstation, 4000 calls x 20 KiB, node 24: unset ON -> 0.1 MiB, unset
    // compiled out -> 78.4 MiB. The threshold below is a fraction of that gap, so the
    // test does not depend on the allocator returning pages.
    const Gtk = requireGi('Gtk', '4.0');
    Gtk.init();
    const button = new Gtk.Button();
    const big = 'x'.repeat(20 * 1024);
    const ROUNDS = 2000;

    // Warm up first: the baseline has to be taken after GTK's own one-off allocations,
    // or their cost is charged to the loop.
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
