// SPDX-License-Identifier: MIT
// A GI call with too FEW arguments must be REFUSED, with gjs's message — and the
// refusal has to happen before any marshalling, or the missing argument gets
// invented. node-gi read a missing JS argument as `undefined` and marshalled that,
// so on a GValue parameter it became gjs's null guess (a G_TYPE_POINTER GValue) and
// the callee was handed the wrong type:
//
//   label.get_property('label')
//     → GLib-GObject-CRITICAL: g_object_get_property: can't retrieve property
//       'label' of type 'gchararray' as value of type 'gpointer'
//     → undefined
//
// Type- and class-independent — stock GTK classes and registerClass'd ones alike,
// with the set_property twin mirroring it ("unable to set property … from value of
// type 'gpointer'"). Silent, so every consumer that reached for the one-argument
// spelling got `undefined` and no error to follow.
//
// The messages below are gjs's, down to the singular/plural of "argument" and its
// `format_name()` spelling (method Ns.Class.name / function Ns.name,
// refs/gjs/gi/function.cpp:801) — which is why this is a conformance program and
// not only an assertion: the golden IS gjs's output.
//
// Too MANY arguments is deliberately the other way: gjs warns and runs the call, so
// the last case must print a RESULT, not a refusal.
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

function show(label, fn) {
    try {
        print(label + ': ' + JSON.stringify(fn()));
    } catch (e) {
        print(label + ': ' + e.constructor.name + ': ' + e.message);
    }
}

const object = new GObject.Object();
show('get_property/1', () => object.get_property('some-property'));
show('get_property/0', () => object.get_property());
show('set_property/1', () => object.set_property('some-property'));

const file = Gio.File.new_for_path('/tmp');
show('method/0 of 1', () => file.get_child());
show('function/0 of 1', () => GLib.path_is_absolute());
show('function/3 of 4', () => GObject.signal_emitv([], GObject.signal_lookup('notify', GObject.Object.$gtype), 0));

// The two-argument spelling is the one that always worked, on both runtimes.
const action = new Gio.SimpleAction({ name: 'probe' });
const value = new GObject.Value();
value.init(GObject.TYPE_STRING);
action.get_property('name', value);
print('get_property/2: ' + JSON.stringify(value.get_string()));

// Extra arguments stay permitted.
show('too many', () => GLib.path_is_absolute('/a', 'stray'));
