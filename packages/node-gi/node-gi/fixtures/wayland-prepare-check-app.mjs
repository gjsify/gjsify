// SPDX-License-Identifier: MIT
// Child fixture for test/wayland-prepare-check.test.mjs — the smallest program
// that deadlocks when the uv pump's wake-up hint pass leaves the default
// GMainContext prepared without a matching check (gjsify #1145).
//
// The three ingredients, none of them optional:
//   1. `register()` BEFORE the run — it emits ::startup, so GTK/GDK (and GDK's
//      Wayland event source) exist while g_main_depth() is still 0, which is the
//      only depth at which the hint pass runs. An app that only ever calls run()
//      initialises GDK inside the loop and never meets it.
//   2. a libuv turn between the two — the hint pass runs from uv_prepare/uv_check,
//      so its prepare() must land after step 1. `runAsync` alone already defers the
//      blocking run to a macrotask; the explicit await makes the ordering visible.
//   3. `present()` — GTK realizes the surface and the GSK renderer, and a
//      `wl_display_roundtrip` in there blocks forever on the reader slot that
//      GDK's prepare() took and no check() gave back.
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
