// SPDX-License-Identifier: MIT
//
// The @gjsify/node-gi LIVE Canvas2DBridge proof — ONE source, two runtimes.
//
//   gjsify build … --app gjs   → native gi:// Gtk/Cairo under GJS
//   gjsify build … --app node  → @gjsify/node-gi under Node.js
//
// It imports the REAL `Canvas2DBridge` from `@gjsify/canvas2d` — a
// `Gtk.DrawingArea` subclass wrapping an `HTMLCanvasElement` 2D context backed by
// Cairo — and drives the full realize → draw_func → blit path:
//
//   - the bridge widget goes into a `Gtk.ApplicationWindow`, `present()`ed under a
//     display (Xvfb in CI);
//   - `bridge.onReady((canvas, ctx) => …)` fires on the FIRST draw and draws via
//     the STANDARD 2D API (`fillStyle`/`fillRect`, a `createLinearGradient`) — the
//     exact API a browser/GJS app uses, unchanged;
//   - the `Gtk.DrawingArea`'s draw_func fires each frame and the bridge blits the
//     canvas' Cairo `ImageSurface` onto the widget (`cr.setSourceSurface` +
//     `cr.paint`) — the node-gi cairo foreign-struct seam carrying a live blit;
//   - `bridge.requestAnimationFrame(cb)` schedules a tick via the GTK frame clock
//     (`add_tick_callback`) — proved to fire before quit;
//   - pixels are read BACK off the canvas (`ctx.getImageData`) — a deterministic,
//     display-independent Cairo render — so gjs and node parity-check byte-for-byte.
//
// Quits from a `GLib.timeout_add` once the ready + rAF-tick signals are in (a
// bounded safety cap otherwise), so `app.run()` returns cleanly (exit 0). Every
// printed line is DETERMINISTIC — no hostname, path or timing — so the gjs output
// is byte-identical to the node output AND matches the fixed invariants the e2e
// asserts. `print` is ambient under GJS and injected by `--globals auto`
// (`@gjsify/node-gi/globals`) for the node build — NO `/register` import.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { Canvas2DBridge } from '@gjsify/canvas2d';

const W = 64;
const H = 48;

const app = new Gtk.Application({
    application_id: 'eu.jumplink.NodeGiCanvas2DBridge',
    flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
});

let readySeen = false;
let rafTicked = false;

app.connect('activate', () => {
    try {
        print('activated');

        const win = new Gtk.ApplicationWindow({ application: app });
        win.set_default_size(W, H);

        // The REAL bridge widget. installGlobals() wires globalThis.requestAnimationFrame
        // + performance onto the GTK frame clock — exercised via the rAF path below.
        const bridge = new Canvas2DBridge();
        bridge.set_content_width(W);
        bridge.set_content_height(H);
        bridge.installGlobals();

        // onReady fires on the FIRST draw_func, with the live canvas + 2D context.
        // Draw via the standard DOM 2D API — the same code path a browser app runs.
        bridge.onReady((canvas, ctx) => {
            readySeen = true;
            // The canvas is sized from the DrawingArea's draw allocation. The exact
            // WxH depends on the window manager (a bare Xvfb honours the default
            // size, a live WM may widen it), so assert only that it is sized — the
            // deterministic pixel read-backs below carry the real render proof.
            print(`ready: ${canvas.width > 0 && canvas.height > 0 ? 'sized' : 'empty'}`);

            ctx.fillStyle = 'rgb(0, 0, 0)';
            ctx.fillRect(0, 0, canvas.width, canvas.height); // clear to opaque black
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(4, 4, 20, 16); // a solid red square

            // A linear gradient fill — exercises createLinearGradient + a gradient
            // fillStyle (drawn, but sampled only in its solid interior below).
            const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
            grad.addColorStop(0, '#00ff00');
            grad.addColorStop(1, '#0000ff');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 30, canvas.width, 8);

            // Read pixels BACK off the canvas — a deterministic Cairo render, so
            // node-gi must match gjs byte-for-byte. Sample SOLID regions only (no
            // gradient/AA edges): inside the red square, and the black background.
            const red = ctx.getImageData(10, 10, 1, 1).data;
            const black = ctx.getImageData(2, 2, 1, 1).data;
            print(`pixel(10,10): ${red[0]},${red[1]},${red[2]},${red[3]}`);
            print(`pixel(2,2): ${black[0]},${black[1]},${black[2]},${black[3]}`);

            // rAF via the bridge → add_tick_callback on the GTK frame clock.
            bridge.requestAnimationFrame(() => {
                rafTicked = true;
            });
        });

        win.set_child(bridge);
        win.present();
        bridge.queue_draw();

        // Quit once ready + a rAF tick are in (proves realize→draw_func→blit AND the
        // frame-clock tick), plus one extra frame so the blit-only path runs again.
        // A bounded safety cap quits regardless so run() always returns.
        let ticks = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            ticks++;
            bridge.queue_draw(); // keep frames flowing (draw_func + blit re-run)
            const settled = readySeen && rafTicked && ticks >= 2;
            if (settled || ticks >= 80) {
                print(`draw: ${readySeen ? 'fired' : 'missing'}`);
                print(`raf: ${rafTicked ? 'ticked' : 'idle'}`);
                print('quit');
                app.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    } catch (error) {
        // Surface a failure as a deterministic line so a golden mismatch points at
        // the cause instead of hanging the loop.
        print(`activate-error: ${error instanceof Error ? error.message : String(error)}`);
        app.quit();
    }
});

print('canvas2d-bridge: start');
app.run([]); // top-level blocking run (no async wrapper — the node-gtk #442 caveat)
print('done');

// Force a clean exit(0) on BOTH runtimes. Under `gjs -m` the process exits on
// module completion regardless; under node-gi a mapped Gtk.DrawingArea's live
// GdkFrameClock stays an active GLib source after app.quit(), which the uv-driven
// auto-pump keeps mirroring onto libuv — so node would otherwise NOT exit (the
// documented "one lifetime divergence vs gjs": an active GLib source holds the
// process, matching setInterval semantics). This is node-gi's designed behaviour,
// not a bug; a GTK program that must terminate exits explicitly. Verified clean
// (exit 0, no double-exit) on gjs too.
process.exit(0);
