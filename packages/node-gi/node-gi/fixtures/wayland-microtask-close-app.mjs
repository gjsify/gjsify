// SPDX-License-Identifier: MIT
// Child fixture for test/wayland-microtask-close.test.mjs — closes a presented
// window from a promise continuation that a GLib callback settles.
//
// The continuation runs in the pump's microtask drain, i.e. inside a GLib prepare
// pass. If a source prepared earlier in that pass (GDK's Wayland source) still holds
// libwayland's reader slot, `gtk_window_close` -> GSK renderer unrealize (Vulkan WSI)
// -> `wl_display_roundtrip_queue` parks forever on that slot. Stamped's Node GUI hung
// on exit this way.
import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');
const Gtk = requireGi('Gtk', '4.0');

const app = new Gtk.Application({
    application_id: 'org.gjsify.NodeGiWaylandMicrotaskClose',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', async () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(200, 150);
    win.present();
    console.log('PRESENT_RETURNED');
    await new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
    win.close();
    console.log('CLOSE_RETURNED');
});

app.register(null);
const code = await app.runAsync([]);
console.log(`RUN_RETURNED ${code}`);
