// SPDX-License-Identifier: MIT
// Child fixture for test/wayland-prepare-check.test.mjs — the smallest program
// that deadlocks when the uv pump's wake-up hint pass leaves the default
// GMainContext prepared without a matching check (gjsify #1145).
//
// The three ingredients, none of them optional:
//   1. `register()` BEFORE the run — it emits ::startup, so GTK/GDK (and GDK's Wayland
//      event source) exist while g_main_depth() is still 0, the only depth at which the
//      hint pass runs. An app that only calls run() initialises GDK inside the loop.
//   2. a libuv turn between the two, where the uv_prepare/uv_check hint pass lands.
//      `runAsync` already defers the run to a macrotask; the await makes it visible.
//   3. `present()` — GTK realizes the GSK renderer, and a `wl_display_roundtrip` in
//      there blocks forever on the reader slot GDK's prepare() took.
//
// NON_UNIQUE on purpose: no bus name, no single-instance handoff, so a stray
// instance from another run cannot turn the deadlock into a silent pass — and it
// keeps the reproduction free of the DBus machinery the symptom was first blamed on.
import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');
const Gtk = requireGi('Gtk', '4.0');

const app = new Gtk.Application({
    application_id: 'org.gjsify.NodeGiWaylandPrepareCheck',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app });
    win.set_default_size(200, 150);
    win.present();
    console.log('PRESENT_RETURNED');
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});

app.register(null);
console.log('REGISTERED');
await new Promise((resolve) => setTimeout(resolve, 50));
const code = await app.runAsync([]);
console.log(`RUN_RETURNED ${code}`);
