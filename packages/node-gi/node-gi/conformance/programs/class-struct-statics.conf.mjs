// SPDX-License-Identifier: MIT
// CLASS-STRUCT statics: the GObjectClass functions gjs exposes as statics ON the
// constructor — `Ns.Class.list_properties()`, `.find_property()`. They live on
// GObject.ObjectClass and nowhere else, so nothing finds them on the class's own
// GIObjectInfo; gjs reaches them through the constructor PROTOTYPE CHAIN, and
// node-gi through a class-struct walk up the object-info parent chain. Before that
// walk existed, every one of these calls threw "no static method '…' on Ns.Class",
// which is every element-creation path in @gjsify/gtk-host (props.ts paramSpecs()).
//
// Headless on purpose (Gio + GObject, no GTK): the whole conformance corpus runs
// without a display or a GTK typelib.
//
// NO camelCase spelling is exercised here, and that is deliberate: gjs defines
// camelCase aliases for instance methods only, so `Gtk.Button.listProperties` is
// `undefined` under gjs while node-gi's static proxy accepts it. A divergence, but
// a PRE-EXISTING one about the static proxy rather than about class structs.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

// Sorted: g_object_class_list_properties' order is the class's installation order,
// which is not a contract and shifts when a GLib/GTK release installs one earlier.
const names = (klass) =>
    klass
        .list_properties()
        .map((p) => p.get_name())
        .sort();

const direct = names(Gio.SimpleAction);
print('SimpleAction is array:', Array.isArray(Gio.SimpleAction.list_properties()));
print('SimpleAction count:', direct.length);
print('SimpleAction names:', direct.join(','));

// The base class itself installs no properties — so a leaf's pspecs cannot be
// leaking in from a shared/declarer class by accident.
print('GObject.Object count:', GObject.Object.list_properties().length);

// Three levels of GIObjectInfo parent (BufferedInputStream → FilterInputStream →
// InputStream → Object): proves the walk does not stop at the leaf's own class
// struct, AND that the class the call runs on is the LEAF's — an inherited
// property must be visible.
const buffered = names(Gio.BufferedInputStream);
print('BufferedInputStream count:', buffered.length);
print('BufferedInputStream names:', buffered.join(','));

const inherited = Gio.BufferedInputStream.find_property('base-stream');
print('inherited find_property:', inherited.get_name());
print('inherited value_type:', GObject.type_name(inherited.value_type));

const own = Gio.SimpleAction.find_property('enabled');
print('own find_property:', own.get_name());
print('own value_type:', GObject.type_name(own.value_type));
print('own owner_type:', GObject.type_name(own.owner_type));
print('own instanceof ParamSpec:', own instanceof GObject.ParamSpec);

// A miss is `null`, not a throw — GObject returns NULL and gjs marshals it through.
print('miss find_property:', Gio.SimpleAction.find_property('no-such-property'));
