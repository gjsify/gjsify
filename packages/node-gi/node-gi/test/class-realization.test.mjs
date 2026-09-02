// SPDX-License-Identifier: MIT
// Class realization + class-struct receiver semantics for @gjsify/node-gi (#1438).
//
// GObject installs a class's signals and properties in `class_init`, which GLib runs
// the first time something takes a `g_type_class_ref`. gjs keeps the invariant its own
// gi/function.cpp states — "the GType class is referenced at least once when the JS
// constructor is initialized" — so a lookup off `$gtype` answers with no instance ever
// built. node-gi took no such ref and, separately, bound a class-struct static to the
// type it was READ from rather than the one it was CALLED on. Both answered WRONG with
// nothing thrown, which a caller reads as "this class has no such signal/property":
//
//   GObject.signal_lookup('popped', Adw.NavigationView.$gtype)   gjs 84  node-gi 0
//   GObject.Object.list_properties.call(Gtk.ListItem)            gjs  9  node-gi array(0)
//   Gtk.ListItem.list_properties.call(Gtk.Widget)                gjs 36  node-gi 9
//
// Headless on purpose: the issue's vectors are Gtk/Adw widgets, but the seam is
// GObject's and Gio reproduces both exactly, so these run on a machine with no display.
//
// ORDER IS LOAD-BEARING for the realization cases: they must observe a class NOTHING in
// this process has referenced yet, so each uses a type no other case here touches, and
// they come first. `node --test` gives every file its own process, so nothing outside
// this file can realize them either.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { requireGi } from '../gi.js';

const GObject = requireGi('GObject', '2.0');
const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

// ---- Symptom 1: a class nothing realized reports none of its own signals ----

test('reading $gtype realizes a classed type, so its class_init signals are findable', () => {
    // Nothing has constructed a Gio.MountOperation, and that is the whole point: the
    // signal is registered in class_init, so before the fix this was 0 while gjs
    // answered a real signal id in the same situation.
    assert.notEqual(GObject.signal_lookup('ask-password', Gio.MountOperation.$gtype), 0);
    assert.notEqual(GObject.signal_lookup('aborted', Gio.MountOperation.$gtype), 0);
    // A name the class really does not have still answers 0 — the realization must not
    // turn the lookup into a rubber stamp.
    assert.equal(GObject.signal_lookup('no-such-signal', Gio.MountOperation.$gtype), 0);
});

test('the same holds for a second, untouched hierarchy (not a Gio.MountOperation quirk)', () => {
    assert.notEqual(GObject.signal_lookup('event', Gio.SocketClient.$gtype), 0);
    // Inherited signals resolve too: `notify` is GObject's own, installed on every
    // classed descendant.
    assert.notEqual(GObject.signal_lookup('notify', Gio.SocketClient.$gtype), 0);
});

test('a GType with no class still reads, and an enum carries one at all', () => {
    // BOXED and INTERFACE are the unclassed fundamentals — measured on glib 2.88.3,
    // `G_TYPE_IS_CLASSED` is 0 for GBytes and GFile and `g_type_class_ref` on either
    // answers nullptr after a CRITICAL. ENUM and FLAGS are NOT in that set: they are
    // classed (GEnumClass/GFlagsClass), so the guard lets them through and refs them,
    // which is what g_enum_get_value() needs anyway and what gjs does too.
    assert.equal(GObject.type_name(GLib.Bytes.$gtype), 'GBytes');
    assert.equal(GObject.type_name(Gio.File.$gtype), 'GFile'); // an interface
    // And an enum object carries its GType at all, which it did not: gjs answers
    // `GBusType` here where the bridge answered null.
    assert.equal(GObject.type_name(Gio.BusType.$gtype), 'GBusType');
    // Non-enumerable, so the member list is still just the members.
    assert.equal(Object.keys(Gio.BusType).includes('$gtype'), false);
});

test('reading an unclassed GType takes no class ref, so GLib stays quiet', () => {
    // THE GUARD'S ONLY WITNESS, and it has to be a CHILD PROCESS. `g_type_class_ref`
    // on a boxed or interface GType returns nullptr after a `GLib-GObject-CRITICAL`
    // rather than throwing, so every in-process assertion above is green with the
    // `G_TYPE_IS_CLASSED` guard deleted — measured: 9 of 9 pass, two CRITICALs on
    // stderr, and conformance compares stdout only (`scripts/conformance.mjs`). The
    // child is what puts that stderr under an assertion.
    const probe = [
        `const { requireGi } = await import(${JSON.stringify(fileURLToPath(new URL('../gi.js', import.meta.url)))});`,
        "const GObject = requireGi('GObject', '2.0');",
        "const GLib = requireGi('GLib', '2.0');",
        "const Gio = requireGi('Gio', '2.0');",
        'process.stdout.write([GLib.Bytes, Gio.File, Gio.BusType].map((t) => GObject.type_name(t.$gtype)).join(" "));',
    ].join('\n');
    // The parent's env carries the NODE_GI_NATIVE the test scripts pin, so the child
    // measures the SAME addon this file is measuring.
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' });
    assert.equal(res.stdout, 'GBytes GFile GBusType');
    // The LOG DOMAIN, not any diagnostic: an unguarded ref logs GLib-GObject-CRITICAL
    // ("cannot retrieve class for invalid (unclassed) type"), while a host with an odd
    // GIO module set can log GLib-GIO-WARNING for reasons that are not this test's.
    assert.equal(/GLib-GObject-CRITICAL/.test(res.stderr), false, `GObject complained:\n${res.stderr}`);
});

// ---- Symptom 2: a class-struct static answers for the class it was CALLED on ----

// The pspec counts of two unrelated classes. They must DIFFER, or an assertion that
// the borrowed form "answers the same as the direct form" would hold for the wrong
// reason — a borrowed call that ignored its receiver would still match one of them.
const simpleActionPspecs = Gio.SimpleAction.list_properties().length;
const applicationPspecs = Gio.Application.list_properties().length;

test('the two classes this file discriminates with really do differ', () => {
    assert.notEqual(simpleActionPspecs, 0);
    assert.notEqual(applicationPspecs, 0);
    assert.notEqual(simpleActionPspecs, applicationPspecs);
});

test('a borrowed class-struct static reads the RECEIVER class, as in gjs', () => {
    // `GObject.Object.list_properties.call(K)` is one function on the base
    // constructor applied to K — gjs marshals `this` as the GTypeClass, so it answers
    // K's pspecs. node-gi answered GObject's zero for every K.
    assert.equal(GObject.Object.list_properties.call(Gio.SimpleAction).length, simpleActionPspecs);
    assert.equal(GObject.Object.list_properties.call(Gio.Application).length, applicationPspecs);
    // `.apply` is the same borrow with a different spelling.
    assert.equal(GObject.Object.list_properties.apply(Gio.Application).length, applicationPspecs);
});

test('find_property borrowed onto a class answers that class ParamSpec', () => {
    const spec = GObject.Object.find_property.call(Gio.SimpleAction, 'enabled');
    assert.notEqual(spec, null);
    assert.equal(spec.name, 'enabled');
    // And a property the receiver does not have is still null, so the retarget is a
    // real lookup rather than a shortcut.
    assert.equal(GObject.Object.find_property.call(Gio.SimpleAction, 'no-such-property'), null);
});

test('the receiver need only match the DECLARING class, not the one it was read from', () => {
    // `list_properties` is declared on GObjectClass, so gjs lets any GObject class
    // receive it whichever constructor it was taken off:
    // `Gtk.ListItem.list_properties.call(Gtk.Widget)` answers GtkWidget's 36 there.
    assert.equal(Gio.SimpleAction.list_properties.call(Gio.Application).length, applicationPspecs);
    assert.equal(Gio.Application.list_properties.call(Gio.SimpleAction).length, simpleActionPspecs);
});

test('an INSTANCE receiver names its runtime class, as in gjs', () => {
    // `$gtype` is a constructor-level member here, so an instance answers none and the
    // borrow used to fall back to GObject's zero — silently, the same shape as the
    // class case. gjs marshals the instance's own GTypeClass: measured, an instance of
    // a registerClass'd subclass reads the SUBCLASS's pspecs, one more than the base's.
    const Sub = GObject.registerClass(
        {
            GTypeName: 'NodeGiClassRealizationSub',
            Properties: {
                extra: GObject.ParamSpec.string('extra', 'Extra', 'E', GObject.ParamFlags.READWRITE, ''),
            },
        },
        class NodeGiClassRealizationSub extends Gio.SimpleAction {},
    );
    const base = new Gio.SimpleAction({ name: 'base' });
    const sub = new Sub({ name: 'sub' });
    assert.equal(GObject.Object.list_properties.call(base).length, simpleActionPspecs);
    assert.equal(GObject.Object.list_properties.call(sub).length, simpleActionPspecs + 1);
    assert.equal(GObject.Object.find_property.call(sub, 'extra').name, 'extra');
    // A plain object is not a receiver at all: it falls back rather than being trusted,
    // where gjs reaches the C function and answers 0 through a CRITICAL.
    assert.equal(GObject.Object.list_properties.call({}).length, 0);
});

test('a plain static ignores `this`, exactly as in gjs', () => {
    // Only class-struct methods take the receiver. Gio.File.new_for_path is an ordinary
    // constructor function; borrowing it onto a class must not retarget anything.
    const file = Gio.File.new_for_path.call(Gio.SimpleAction, '/tmp/node-gi-class-realization');
    assert.equal(file.get_path(), '/tmp/node-gi-class-realization');
});

test('a receiver that is not a GObject class is ignored, never trusted', () => {
    // GLib.Bytes is boxed: it has no GObjectClass, and handing g_object_class_list_properties
    // a non-GObjectClass pointer is undefined behaviour. The call falls back to the type the
    // name was read from — GObject.Object, whose own pspec list is empty. (gjs answers the
    // same 0 here, by way of a GLib-GObject-CRITICAL.)
    assert.equal(GObject.Object.list_properties.call(GLib.Bytes).length, 0);
});
