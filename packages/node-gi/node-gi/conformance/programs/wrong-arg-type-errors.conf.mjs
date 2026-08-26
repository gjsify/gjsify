// SPDX-License-Identifier: MIT
// A wrong-typed argument must THROW the way gjs throws — GTK's own failure mode
// is one CRITICAL at exit 0, so a binding that passes the value through turns
// every caller's recovery path into dead code. Measured before the fix:
// `page.add(box)` logged `assertion 'ADW_IS_PREFERENCES_GROUP (group)' failed`
// and returned, and `add_titled(child, 5, …)` registered a page named "5" —
// while gjs threw on both, which is what @gjsify/gtk-host's refused-insert and
// refused-layout-write recoveries are built on.
//
//   non-string for a utf8 arg   → Error, gjs's report_typeof_mismatch message
//   wrong GObject for an object arg → TypeError, gjs's typecheck message
//     ("Ns.Name" for the actual instance, the GType name for the expected type)
//
// null/undefined are NOT pinned here: node-gi accepts both as NULL for nullable
// args (gjs additionally refuses `undefined`) — a separate, pre-existing surface.
import Gio from 'gi://Gio?version=2.0';

const item = new Gio.MenuItem();
for (const [label, value] of [
    ['number', 5],
    ['boolean', true],
    ['object', {}],
]) {
    try {
        item.set_label(value);
        print(label + ': no-throw');
    } catch (e) {
        print(label + ': ' + e.constructor.name + ': ' + e.message);
    }
}

const menu = new Gio.Menu();
const action = new Gio.SimpleAction({ name: 'a' });
try {
    menu.append_item(action);
    print('wrong-gobject: no-throw');
} catch (e) {
    print('wrong-gobject: ' + e.constructor.name + ': ' + e.message);
}
