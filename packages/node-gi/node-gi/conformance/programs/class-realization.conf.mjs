// SPDX-License-Identifier: MIT
// A classed GType is REALIZED when its `$gtype` is read (#1438).
//
// GObject installs a class's signals and properties in `class_init`, which GLib runs
// the first time something takes a `g_type_class_ref`. gjs keeps the invariant its own
// gi/function.cpp states — "the GType class is referenced at least once when the JS
// constructor is initialized" — so a lookup off `$gtype` answers with no instance ever
// built. node-gi took no such ref: `GObject.signal_lookup('popped',
// Adw.NavigationView.$gtype)` was 84 under gjs and 0 here, with nothing thrown, which
// a caller reads as "this class has no such signal".
//
// NOTHING MAY CONSTRUCT OR TOUCH THESE CLASSES FIRST — the whole measurement is what
// an UNrealized class reports, so each type below appears exactly once. Signal IDs are
// per-process allocation order and are deliberately never printed.
//
// Headless on purpose (Gio + GObject, no GTK): the issue's vectors were Adwaita
// widgets, but the seam is GObject's and Gio reproduces it exactly.
import GObject from 'gi://GObject?version=2.0';
import Gio from 'gi://Gio?version=2.0';

const has = (signal, klass) => GObject.signal_lookup(signal, klass.$gtype) !== 0;

// Each of these signals exists only once its class has been realized.
print('MountOperation ask-password:', has('ask-password', Gio.MountOperation));
print('MountOperation aborted:', has('aborted', Gio.MountOperation));
print('SocketClient event:', has('event', Gio.SocketClient));
print('Cancellable cancelled:', has('cancelled', Gio.Cancellable));
print('DBusServer new-connection:', has('new-connection', Gio.DBusServer));

// Inherited from GObjectClass, so it holds on any realized descendant.
print('inherited notify:', has('notify', Gio.SocketClient));

// Realizing must not turn the lookup into a rubber stamp.
print('a signal the class has not:', has('no-such-signal', Gio.MountOperation));

// An UNCLASSED GType has no class to realize — g_type_class_ref on one is a
// programmer error, not a no-op — so these reads stay plain GType reads.
print('boxed $gtype:', GObject.type_name(Gio.FileAttributeMatcher.$gtype) !== null);
print('enum $gtype:', GObject.type_name(Gio.BusType.$gtype) !== null);
print('interface $gtype:', GObject.type_name(Gio.File.$gtype) !== null);
print('interface has no class:', has('no-such-signal', Gio.File));
