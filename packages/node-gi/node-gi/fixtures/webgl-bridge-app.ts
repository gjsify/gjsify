// SPDX-License-Identifier: MIT
//
// The FULL `@gjsify/webgl` WebGLBridge on node-gi — ONE source, two runtimes.
//
//   gjsify build … --app gjs   → native gi:// under GJS
//   gjsify build … --app node  → @gjsify/node-gi under Node.js
//
// Where `webgl-glarea-app.ts` proves the RAW seam (Gtk.GLArea + the gwebgl
// native class), this fixture drives the complete TS WebGL stack UNCHANGED:
// `WebGLBridge` (a `Gtk.GLArea` subclass via `GObject.registerClass`) realizes,
// `onReady` hands out the standard `HTMLCanvasElement` + `WebGLRenderingContext`
// (whose construction alone exercises a broad marshalling surface —
// `new Gwebgl.WebGLRenderingContext({})`, `get_webgl_constants()` (a GHashTable
// return), the `_init()` `getParameterx` GVariant reads, texture-unit setup —
// AND eagerly creates the WebGL2 context too), and the browser-standard calls
// `gl.clearColor(0,0,1,1)` + `gl.clear(gl.COLOR_BUFFER_BIT)` +
// `gl.readPixels(…)` read the blue clear back off the GL framebuffer:
// `bridge-pixel(0,0): 0,0,255,255` in the committed golden, byte-identical
// between `gjs -m` and `node`.
//
// Every stdout line is DETERMINISTIC; diagnostics go to stderr. `print` is
// ambient under GJS and injected by `--globals auto` for the node build.
//
// Reference: packages/framework/webgl/src/ts/webgl-bridge.ts (the widget under
// test), showcases/dom/three-* (the consumer shape this unblocks on node).

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { WebGLBridge } from '@gjsify/webgl';

const app = new Gtk.Application({
    application_id: 'eu.jumplink.NodeGiWebGLBridge',
    flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
});

let readySeen = false;

app.connect('activate', () => {
    try {
        print('activated');
        const win = new Gtk.ApplicationWindow({ application: app });
        win.set_default_size(128, 96);

        // The REAL bridge widget — rAF/performance globals wired like a consumer.
        const bridge = new WebGLBridge();
        bridge.installGlobals();
        bridge.onReady((canvas, gl) => {
            readySeen = true;
            print(`ready: canvas ${canvas.width > 0 && canvas.height > 0 ? 'sized' : 'empty'}`);
            // The browser-standard WebGL draw + read-back through the TS stack.
            gl.clearColor(0, 0, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const px = new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            print(`bridge-pixel(0,0): ${Array.from(px).join(',')}`);
        });

        win.set_child(bridge);
        win.present();

        // Quit once onReady ran (plus one extra frame); bounded safety cap.
        let ticks = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            ticks++;
            bridge.queue_render();
            if ((readySeen && ticks >= 2) || ticks >= 80) {
                print(`ready: ${readySeen ? 'fired' : 'MISSING'}`);
                print('quit');
                app.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    } catch (error) {
        // Deterministic failure line — a golden mismatch names the cause.
        print(`activate-error: ${error instanceof Error ? error.message : String(error)}`);
        app.quit();
    }
});

print('webgl-bridge: start');
app.run([]); // top-level blocking run (no async wrapper — the node-gtk #442 caveat)
print('done');

// Force a clean exit(0) on BOTH runtimes: under node-gi the mapped GLArea's live
// GdkFrameClock stays an active GLib source after app.quit() (the documented
// lifetime divergence vs gjs — an active source holds the process).
process.exit(0);
