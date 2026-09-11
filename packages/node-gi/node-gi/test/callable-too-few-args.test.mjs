// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a GI call with too FEW arguments throws gjs's TypeError instead of
// padding the missing ones with `undefined`.
//
// The defect this pins is type- and class-independent, and it is silent. node-gi read
// a missing JS argument as `undefined` and marshalled it, so on a GValue parameter
// `JsToFreshGValue` guessed `G_TYPE_POINTER` (gjs's guess for null) and handed that to
// the callee. `get_property` is where users meet it: on ANY class, custom or stock,
//
//     label.get_property('label')
//       → GLib-GObject-CRITICAL: g_object_get_property: can't retrieve property
//         'label' of type 'gchararray' as value of type 'gpointer'
//       → undefined
//
// and the set_property twin mirrors it ("unable to set property … from value of type
// 'gpointer'"). gjs refuses the same call BEFORE any marshalling
// (refs/gjs/gi/function.cpp:891 → JS::CallArgs::reportMoreArgsNeeded), so the two-arg
// spelling is the only one that ever worked on either runtime — the fix converts a
// silently wrong answer into the identical refusal.
//
// Messages are byte-compared against gjs 1.88.1, including the singular/plural of
// "argument" and gjs's `format_name()` spelling (method Ns.Class.name / function
// Ns.name, refs/gjs/gi/function.cpp:801).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

const GObject = requireGi('GObject', '2.0');
const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

test("get_property with one argument throws gjs's arity TypeError", () => {
    const obj = new GObject.Object();
    assert.throws(() => obj.get_property('some-property'), {
        name: 'TypeError',
        message: 'method GObject.Object.get_property: At least 2 arguments required, but only 1 passed',
    });
});

test('set_property with one argument throws too', () => {
    const obj = new GObject.Object();
    assert.throws(() => obj.set_property('some-property'), {
        name: 'TypeError',
        message: 'method GObject.Object.set_property: At least 2 arguments required, but only 1 passed',
    });
});

test('the two-argument get_property/set_property spelling still works', () => {
    // A stock C class with no JS in play: the property round-trips through a caller
    // GValue exactly as on gjs.
    const file = Gio.File.new_for_path('/tmp/node-gi-arity-probe');
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);
    // GFile has no writable property to round-trip, so use a GObject that has one.
    const action = new Gio.SimpleAction({ name: 'probe' });
    action.get_property('name', value);
    assert.equal(value.get_string(), 'probe', 'the caller GValue was filled');
    assert.ok(file, 'the stock file handle is intact');
});

test('a namespace function reports the singular "argument"', () => {
    assert.throws(() => GLib.path_is_absolute(), {
        name: 'TypeError',
        message: 'function GLib.path_is_absolute: At least 1 argument required, but only 0 passed',
    });
});

test('a method reports its DECLARING class, as gjs does', () => {
    const file = Gio.File.new_for_path('/tmp');
    assert.throws(() => file.get_child(), {
        name: 'TypeError',
        message: 'method Gio.File.get_child: At least 1 argument required, but only 0 passed',
    });
});

test('too MANY arguments stay permitted (gjs only warns)', () => {
    // gjs emits a JS warning and runs the call; node-gi has no JS warning reporter, so
    // it runs the call silently. Either way the extra argument must not turn into a
    // refusal — a consumer passing a stray argument keeps working on both runtimes.
    assert.equal(GLib.path_is_absolute('/a', 'stray'), true);
});

test('a stock widget property is refused identically', { skip: !haveDisplay && 'needs a display' }, () => {
    const Gtk = requireGi('Gtk', '4.0');
    Gtk.init();
    const label = new Gtk.Label({ label: 'hello' });
    assert.throws(() => label.get_property('label'), {
        name: 'TypeError',
        message: 'method GObject.Object.get_property: At least 2 arguments required, but only 1 passed',
    });
    // The accessor path is untouched and still answers.
    assert.equal(label.label, 'hello');
});
