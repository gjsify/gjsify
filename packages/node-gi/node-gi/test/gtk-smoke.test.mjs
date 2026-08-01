// SPDX-License-Identifier: MIT
// @gjsify/node-gi — Gtk.Application smoke test (GTK layering milestone, PR1).
//
// Proves an UNCHANGED Gtk.Application runs on Node via the node-gi engine:
// construct the app, connect('activate'), build a Gtk.ApplicationWindow with a
// Gtk.Button, present it, and quit from a GLib timeout — all under the libuv↔GLib
// bridge. THE HEADLINE PROOF: g_application_run iterates the DEFAULT GMainContext,
// to which the node-gi bridge attaches its GSource (g_source_attach(src, NULL)),
// so Node's libuv (timers / I/O / microtasks) is co-pumped during the blocking
// GTK loop. A setTimeout() scheduled BEFORE run() therefore fires while run()
// blocks — asserted after run() returns (global.__uvTimerFired).
//
// Also exercises the one engine gap the idiomatic shape hits: an object-typed
// CONSTRUCT property. `new Gtk.ApplicationWindow({ application: app })` sets the
// G_TYPE_OBJECT `application` property — JsToGValue must marshal the node-gi
// GObject handle into the GValue (the addon.cc fix landed alongside this test).
//
// SELF-SKIPPING: needs a display (DISPLAY / WAYLAND_DISPLAY) and the Gtk-4.0
// typelib, so the fast headless `npm test` / `test:gc` legs skip it cleanly; the
// dedicated `gtk-smoke` CI job (Xvfb + GTK stack) is where it actually runs.
//
// run() is called at the TOP LEVEL of a synchronous test body (not inside an
// async scope) so the node-gtk #442 nested-microtask-checkpoint caveat does not
// bite; the quit is driven from a GLib timeout running INSIDE the loop.
//
// Reference: refs/gjs (g_application_run semantics), refs/node-gtk src/loop.cc
// (romgrk and contributors, MIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

// Resolve the GTK stack up front: a missing Gtk-4.0 typelib (a headless dev box
// with no gtk4-devel) must SKIP, not throw. The GLib/Gio deps come along too.
let Gtk;
let Gio;
let GLib;
let loadError = null;
if (haveDisplay) {
    try {
        GLib = requireGi('GLib', '2.0');
        Gio = requireGi('Gio', '2.0');
        Gtk = requireGi('Gtk', '4.0');
    } catch (err) {
        loadError = err;
    }
}

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : loadError
      ? `Gtk-4.0 typelib unavailable: ${loadError.message}`
      : false;

// The runtime that is running THIS file. Two INDEPENDENT properties are under
// test here and must stay apart: the GTK half is portable (a real
// `Gtk.Application` builds a window, activates and exits 0 on gjs, node, bun
// and deno), while the libuv co-pump is Node-only by design — Bun and Deno
// drive GLib from the portable `startMainContextPump`, so a blocking `run()`
// does not advance their own loop. Asserting both at once would report a
// missing Node-only extra as a missing GUI capability.
const RUNTIME =
    typeof globalThis.Bun !== 'undefined' ? 'bun' : typeof globalThis.Deno !== 'undefined' ? 'deno' : 'node';

test('Gtk.Application.run() runs a real app', { skip }, () => {
    const app = new Gtk.Application({
        application_id: 'eu.jumplink.NodeGiSmoke',
        flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
    });

    let activated = false;

    // Scheduled on libuv BEFORE the blocking run(). Without the bridge co-pumping
    // libuv during g_application_run, this 10ms timer would never fire while run()
    // blocks → concrete proof the GTK loop advances Node's event loop.
    global.__uvTimerFired = false;
    setTimeout(() => {
        global.__uvTimerFired = true;
    }, 10);

    app.connect('activate', () => {
        activated = true;
        // The engine fix under test: `application` is a G_TYPE_OBJECT construct-only
        // property — JsToGValue must marshal the node-gi GObject handle into it.
        const win = new Gtk.ApplicationWindow({ application: app });
        win.set_default_size(200, 120);
        win.set_child(new Gtk.Button({ label: 'hi' })); // object as a method argument
        win.present();
        // Quit from a timeout running INSIDE the GTK loop → run() returns cleanly.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
    });

    const status = app.run([]); // top-level blocking run (no async wrapper)

    try {
        assert.equal(status, 0, 'app.run([]) should exit 0');
        assert.equal(activated, true, 'the activate signal handler should have run');

        // Node-only: the uv-nesting bridge co-pumps libuv during the blocking GLib
        // loop. On bun/deno the portable pump is not active while run() blocks, so
        // this timer legitimately does not fire — assert the DIFFERENCE rather than
        // skipping, so a regression in either direction is caught.
        if (RUNTIME === 'node') {
            assert.equal(
                global.__uvTimerFired,
                true,
                'libuv must advance (setTimeout fires) during the blocking g_application_run',
            );
        } else {
            assert.equal(
                global.__uvTimerFired,
                false,
                `${RUNTIME}: a blocking run() is not expected to advance the runtime loop (no uv co-pump)`,
            );
        }
    } finally {
        delete global.__uvTimerFired;
    }
});
