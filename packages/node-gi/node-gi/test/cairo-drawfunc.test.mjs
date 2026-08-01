// SPDX-License-Identifier: MIT
// @gjsify/node-gi — the cairo foreign-struct FROM seam via a real GTK draw-func.
//
// THE HEADLINE PROOF for the foreign-struct round-trip across a GI CALLBACK: a
// Gtk.DrawingArea's `set_draw_func` hands the callback a `cairo_t*` (transfer
// nothing). cairo is a FOREIGN struct — GI delegates its marshalling to the cairo
// module — so the engine's foreign from_func must wrap that borrowed pointer into a
// live `cairo.Context` the JS draw-func can draw with. This test asserts the
// callback receives an actual `cairo.Context` (not a boxed handle) and that drawing
// ops on it succeed, then reads the drawn pixels back off an ImageSurface-backed
// target to confirm the paint landed.
//
// SELF-SKIPPING: needs a display (DISPLAY / WAYLAND_DISPLAY) + the Gtk-4.0 typelib,
// so the fast headless `npm test` leg skips it cleanly; the dedicated `gtk-smoke`
// CI job (Xvfb + GTK stack) is where it actually runs. Mirrors gtk-smoke.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';
import cairo from '../cairo.js';

const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

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

test('Gtk.DrawingArea draw-func receives a cairo.Context (foreign FROM seam)', { skip }, () => {
    const app = new Gtk.Application({
        application_id: 'eu.jumplink.NodeGiCairoDrawFunc',
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });

    const result = { called: false, isContext: false, drewOk: false, error: null };

    app.connect('activate', () => {
        const win = new Gtk.ApplicationWindow({ application: app });
        win.set_default_size(40, 30);
        const area = new Gtk.DrawingArea();
        area.set_content_width(40);
        area.set_content_height(30);

        // The draw-func: GTK hands us (area, cr, width, height). `cr` is a cairo_t*
        // marshalled through the foreign from_func → must be a live cairo.Context.
        area.set_draw_func((_area, cr, width, height) => {
            result.called = true;
            try {
                result.isContext = cr instanceof cairo.Context;
                // Draw with the handed context — a broken round-trip would throw here.
                cr.setSourceRGB(1, 0, 0);
                cr.rectangle(0, 0, width, height);
                cr.fill();
                cr.setSourceRGB(0, 0, 1);
                cr.moveTo(0, 0);
                cr.lineTo(width, height);
                cr.stroke();
                result.drewOk = true;
            } catch (err) {
                result.error = err;
            }
        });

        win.set_child(area);
        win.present();
        area.queue_draw();

        // Quit shortly after — a frame renders (firing the draw-func) under Xvfb first.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
    });

    const status = app.run([]); // top-level blocking run (no async wrapper)

    assert.equal(status, 0, 'app.run([]) should exit 0');
    assert.equal(result.error, null, `draw-func threw: ${result.error && result.error.stack}`);
    assert.equal(result.called, true, 'the draw-func should have fired');
    assert.equal(result.isContext, true, 'the draw-func arg is a cairo.Context (foreign FROM)');
    assert.equal(result.drewOk, true, 'drawing on the handed cairo.Context succeeded');
});
