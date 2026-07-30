// SPDX-License-Identifier: MIT
// Plain JS value → GObject.Value IN marshalling: a value passed where a GI
// function expects a GValue is boxed into a fresh GValue whose GType is guessed
// from the value, exactly as gjs (gi/arg-cache.cpp GValueIn::in →
// gjs_value_to_g_value, whose gjs_value_guess_g_type types an uninitialized
// GValue: int32→INT, double→DOUBLE, string→STRING, boolean→BOOLEAN,
// bigint→INT64/UINT64, object→its own GType).
//
// `set_property` is why this matters: its second GI argument IS a GValue, so
// without the boxing the most ordinary GObject call there is fails with
// "Unsupported interface IN argument" — which is what stopped
// `@gjsify/webaudio`'s GstPlayer (`volume.set_property('volume', 0.5)`) on the
// reverse bridge.
//
// A boxed handle is boxed INTO a GValue like any other value (a GVariant becomes
// a G_TYPE_VARIANT GValue); only a handle that already IS a GValue passes
// through. Both are pinned below. Read-back uses `get_property` with an explicit
// GObject.Value where the property type is a fundamental (that call takes two
// arguments on BOTH runtimes) and the plain property accessor otherwise.
// The golden is the gjs output.
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';

/** Read `name` off `obj` through an explicit, correctly-typed GObject.Value. */
function readProp(obj, name, gtype) {
    const v = new GObject.Value();
    v.init(gtype);
    obj.get_property(name, v);
    return v;
}

const app = new Gio.Application({ application_id: 'org.gjsify.GValueProbe' });

// string ← a JS string
app.set_property('application-id', 'org.gjsify.Changed');
print('string:', readProp(app, 'application-id', GObject.TYPE_STRING).get_string());

// uint ← an integral JS number. gjs guesses G_TYPE_INT for it, and
// g_object_set_property transforms int→uint, so the property lands exactly.
app.set_property('inactivity-timeout', 1234);
print('uint:', readProp(app, 'inactivity-timeout', GObject.TYPE_UINT).get_uint());

// boolean ← a JS boolean
const action = new Gio.SimpleAction({ name: 'probe', enabled: true });
action.set_property('enabled', false);
print('boolean:', readProp(action, 'enabled', GObject.TYPE_BOOLEAN).get_boolean());

// flags ← a flags value, a plain number at the JS boundary
app.set_property('flags', Gio.ApplicationFlags.IS_SERVICE);
print('flags:', Number(app.flags) === Number(Gio.ApplicationFlags.IS_SERVICE));

// boxed ← a GVariant handle: boxed into a G_TYPE_VARIANT GValue by its own
// registered GType, NOT passed through as if it were the GValue.
const stateful = Gio.SimpleAction.new_stateful('probe2', null, GLib.Variant.new_boolean(false));
stateful.set_property('state', GLib.Variant.new_boolean(true));
print('boxed-variant:', stateful.state.get_boolean());

// An already-typed GObject.Value passes through untouched.
const explicit = new GObject.Value();
explicit.init(GObject.TYPE_STRING);
explicit.set_string('org.gjsify.Explicit');
app.set_property('application-id', explicit);
print('explicit-gvalue:', readProp(app, 'application-id', GObject.TYPE_STRING).get_string());

// Repeated boxing must leave the property intact — each box is freed after the
// call, and a mishandled string ref would surface as a wrong read here.
for (let i = 0; i < 200; i++) app.set_property('application-id', `org.gjsify.N${i % 5}`);
print('repeat:', readProp(app, 'application-id', GObject.TYPE_STRING).get_string());
