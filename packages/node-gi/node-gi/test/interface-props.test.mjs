// SPDX-License-Identifier: MIT
// @gjsify/node-gi — interface-typed (G_TYPE_INTERFACE) construct/writable
// property marshalling.
//
// JsToGValue / GValueToJs dispatch on G_TYPE_FUNDAMENTAL(value_type). A GObject
// INTERFACE (e.g. GListModel) has fundamental G_TYPE_INTERFACE, which matched no
// case → both directions fell into the "Unsupported property GType <name>" reject.
// That wall surfaced building the Adwaita storybook on Node: Adw.ComboRow:model is
// a GListModel-typed construct property, so `new Adw.ComboRow({ model })` threw
// `TypeError: Unsupported property GType GListModel`.
//
// FIX — an explicit G_TYPE_IS_INTERFACE branch (BEFORE the fundamental switch) in
// both marshallers. The JS value is a wrapped GObject that IMPLEMENTS the
// interface (e.g. a Gtk.StringList / Gio.ListStore implementing GListModel).
// g_value_set_object / g_value_get_object g_return_if_fail on G_VALUE_HOLDS_OBJECT,
// which is FALSE for an interface-typed GValue (g_type_is_a(GListModel,
// G_TYPE_OBJECT) == false), so — mirroring GJS (refs/gjs/gi/value.cpp:684/1071 +
// gi/value.h:110/165) — the object slot is read/written directly via g_set_object:
// the interface inherits GObject's GTypeValueTable through its GObject prerequisite,
// so the slot IS an owned-object ref. Same ownership as the G_TYPE_OBJECT case
// (#659): set refs (our wrapper keeps its own ref), null/undefined clears, a
// non-implementing / non-GObject value throws a clean TypeError.
//
// These cases use a GListModel-typed property on a real GI class, so they need the
// Gtk-4.0 typelib (only the dedicated gtk-smoke CI job installs it) and self-skip
// on the fast headless leg. Gtk.SingleSelection:model is a non-widget GObject
// (typelib only, no display); the Adw.ComboRow repro additionally needs a display.
//
// Reference: refs/gjs/gi/value.cpp:684-702 (the
// g_type_is_a(gtype, G_TYPE_INTERFACE) branch shared with G_TYPE_OBJECT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

const Gio = requireGi('Gio', '2.0');

// Gtk only if its typelib is present (gtk-smoke job); else the GListModel-typed
// cases self-skip rather than throw on the headless leg.
let Gtk = null;
let gtkLoadError = null;
try {
    Gtk = requireGi('Gtk', '4.0');
} catch (err) {
    gtkLoadError = err;
}
let Adw = null;
try {
    Adw = requireGi('Adw', '1');
} catch {
    // Adwaita is optional — the ComboRow repro self-skips without it.
}
const gtkSkip = gtkLoadError ? `Gtk-4.0 typelib unavailable: ${gtkLoadError.message}` : false;
const widgetSkip =
    gtkSkip ||
    (!Adw ? 'Adwaita-1 typelib unavailable' : false) ||
    (!haveDisplay ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)' : false);

// A fresh Gio.ListStore (a plain GObject implementing GListModel) to feed into a
// GListModel-typed property.
function makeListStore(n) {
    const store = Gio.ListStore.new(Gio.SimpleAction.$gtype);
    for (let i = 0; i < n; i++) store.append(new Gio.SimpleAction({ name: `a${i}` }));
    return store;
}

test(
    'interface prop: a GListModel impl round-trips at construction (Gtk.SingleSelection:model)',
    { skip: gtkSkip },
    () => {
        const store = makeListStore(3);
        const sel = new Gtk.SingleSelection({ model: store });
        assert.equal(sel.get_n_items(), 3, 'the GListModel was marshalled into the interface-typed property');
    },
);

test('interface prop: reads back the identical wrapper', { skip: gtkSkip }, () => {
    const store = makeListStore(2);
    const sel = new Gtk.SingleSelection({ model: store });
    const back = sel.model;
    assert.equal(back === store, true, 'the interface-typed property reads back the identical wrapper');
    assert.equal(back.get_n_items(), 2, 'the round-tripped GListModel is the real instance');
});

test('interface prop: assignment replaces the model and reads back', { skip: gtkSkip }, () => {
    const sel = new Gtk.SingleSelection({ model: makeListStore(1) });
    const other = makeListStore(4);
    sel.model = other;
    assert.equal(sel.model === other, true);
    assert.equal(sel.model.get_n_items(), 4);
});

test('interface prop: null clears it (model reads back as null)', { skip: gtkSkip }, () => {
    const sel = new Gtk.SingleSelection({ model: makeListStore(1) });
    sel.model = null;
    assert.equal(sel.model, null, 'null cleared the interface-typed property');
});

test('interface prop: a non-implementing GObject throws a clean TypeError', { skip: gtkSkip }, () => {
    // Gio.SimpleAction is a GObject that does NOT implement GListModel.
    assert.throws(
        () => new Gtk.SingleSelection({ model: new Gio.SimpleAction({ name: 'x' }) }),
        /expected an object implementing GListModel, got GSimpleAction/,
    );
});

test('interface prop: a non-GObject value throws a clean TypeError', { skip: gtkSkip }, () => {
    assert.throws(() => new Gtk.SingleSelection({ model: 'not-a-gobject' }), /expected a node-gi GObject handle/);
});

// The exact storybook repro: Adw.ComboRow:model is a GListModel-typed construct
// property. This is a widget, so it needs a display (gtk_init).
test('interface prop: the storybook repro — Adw.ComboRow({ model: Gtk.StringList })', { skip: widgetSkip }, () => {
    if (typeof Gtk.init === 'function') Gtk.init();
    const list = new Gtk.StringList({ strings: ['alpha', 'beta', 'gamma'] });
    const combo = new Adw.ComboRow({ model: list });
    assert.equal(combo.model.get_n_items(), 3, 'Adw.ComboRow accepted the GListModel-typed model and reads it back');
});
