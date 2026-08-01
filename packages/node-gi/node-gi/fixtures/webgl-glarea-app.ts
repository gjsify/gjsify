// SPDX-License-Identifier: MIT
//
// The @gjsify/node-gi Gtk.GLArea / WebGL spike proof — ONE source, two runtimes.
//
//   gjsify build … --app gjs   → native gi:// Gtk/Gwebgl under GJS
//   gjsify build … --app node  → @gjsify/node-gi under Node.js
//
// THE question this answers: can a `Gtk.GLArea` be realized and hand JS a LIVE,
// CURRENT GL context under the node-gi reverse bridge on a headless/software-GL
// display? The GLArea is configured exactly like `@gjsify/webgl`'s `WebGLBridge`
// (`set_use_es(true)`, `set_required_version(3, 2)`, depth + stencil), put in a
// presented `Gtk.ApplicationWindow`, and driven through realize → render:
//
//   - on `realize`: `make_current()`, `get_error()` (the GError-return
//     marshalling path), `get_context()` (ES-ness + version), and
//     `Gdk.GLContext.get_current()` — the CURRENT-context proof;
//   - on `render`: `Gdk.GLContext.get_current()` again (GTK made the context
//     current for the frame), then the `gwebgl` Vala bridge — the SAME native
//     class `@gjsify/webgl`'s `WebGLRenderingContext` wraps:
//     `new Gwebgl.WebGLRenderingContextBase()` (a literal camelCase Vala GIR —
//     the method-name-resolution path), `getString(GL_VERSION/RENDERER/VENDOR)`,
//     a `getParameterx` GVariant round-trip, and a REAL WebGL draw:
//     `clearColor(1,0,0,1)` + `clear(COLOR_BUFFER_BIT)` + `readPixels` of one
//     pixel — asserted 255,0,0,255, the display-independent render proof;
//   - quits from a `GLib.timeout_add` once render + the GL checks are in (a
//     bounded safety cap otherwise), so `app.run()` returns cleanly (exit 0).
//
// Every stdout line is DETERMINISTIC (normalized ok/none/yes booleans + the fixed
// clear-color pixel) so the gjs output is byte-identical to the node output — the
// committed-golden pattern of `canvas2d-bridge`/`example-gtk`. The HOST-dependent
// GL strings (llvmpipe/Mesa versions, texture limits) go to STDERR via `printerr`
// as diagnostics for CI logs. `print`/`printerr` are ambient under GJS and
// injected by `--globals auto` (`@gjsify/node-gi/globals`) for the node build.
//
// Reference: packages/framework/webgl/src/ts/webgl-bridge.ts (the GLArea setup
// this mirrors), refs/gjs (g_application_run semantics).

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Gwebgl from 'gi://Gwebgl?version=0.1';

// GL enums (constants only — no GL headers needed).
const GL_VENDOR = 0x1f00;
const GL_RENDERER = 0x1f01;
const GL_VERSION = 0x1f02;
const GL_SHADING_LANGUAGE_VERSION = 0x8b8c;
const GL_MAX_TEXTURE_SIZE = 0x0d33;
const GL_COLOR_BUFFER_BIT = 0x4000;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;

const app = new Gtk.Application({
    application_id: 'eu.jumplink.NodeGiWebGLGLArea',
    flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
});

let renderChecked = false;

app.connect('activate', () => {
    try {
        print('activated');

        const win = new Gtk.ApplicationWindow({ application: app });
        win.set_default_size(128, 96);

        // The exact WebGLBridge GLArea configuration (webgl-bridge.ts ctor).
        const area = new Gtk.GLArea();
        area.set_use_es(true);
        area.set_required_version(3, 2);
        area.set_has_depth_buffer(true);
        area.set_has_stencil_buffer(true);

        area.connect('realize', () => {
            area.make_current();
            // GError-typed return: null when context creation succeeded.
            const error = area.get_error();
            print(`realize: error ${error === null ? 'none' : 'SET'}`);
            const ctx = area.get_context();
            const [major, minor] = ctx ? ctx.get_version() : [0, 0];
            const es32 = major > 3 || (major === 3 && minor >= 2);
            print(
                `realize: context ${ctx ? 'non-null' : 'NULL'} es=${ctx ? ctx.get_use_es() : false} version>=3.2 ${es32}`,
            );
            // THE headline probe: is the GLArea's GL context CURRENT for JS?
            const current = Gdk.GLContext.get_current();
            print(`realize: current ${current !== null ? 'yes' : 'NO'}`);
        });

        area.connect('render', () => {
            if (renderChecked) return true;
            renderChecked = true;
            print(`render: current ${Gdk.GLContext.get_current() !== null ? 'yes' : 'NO'}`);

            // The gwebgl Vala bridge — the native class @gjsify/webgl wraps.
            const gl = new Gwebgl.WebGLRenderingContextBase();
            const version = gl.getString(GL_VERSION);
            const renderer = gl.getString(GL_RENDERER);
            const vendor = gl.getString(GL_VENDOR);
            const glsl = gl.getString(GL_SHADING_LANGUAGE_VERSION);
            // Host-dependent — diagnostics only (stderr), normalized ok on stdout.
            printerr(`[webgl-glarea] GL_VERSION=${version}`);
            printerr(`[webgl-glarea] GL_RENDERER=${renderer}`);
            printerr(`[webgl-glarea] GL_VENDOR=${vendor}`);
            printerr(`[webgl-glarea] GLSL=${glsl}`);
            print(
                `gl-strings: ${version.length > 0 && renderer.length > 0 && vendor.length > 0 && glsl.length > 0 ? 'ok' : 'EMPTY'}`,
            );

            // GVariant-returning method round-trip (the webgl-context-base.ts
            // getParameterx path).
            const maxTex = gl.getParameterx(GL_MAX_TEXTURE_SIZE)?.deepUnpack() as number;
            printerr(`[webgl-glarea] MAX_TEXTURE_SIZE=${maxTex}`);
            print(`gl-param: max-texture-size ${typeof maxTex === 'number' && maxTex > 0 ? 'positive' : 'BAD'}`);

            // A REAL WebGL draw + read-back: clear to opaque red, read one pixel.
            gl.clearColor(1, 0, 0, 1);
            gl.clear(GL_COLOR_BUFFER_BIT);
            const px = gl.readPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, new GLib.Variant('ay', [0, 0, 0, 0]));
            print(`pixel(0,0): ${Array.from(px).join(',')}`);
            return true;
        });

        win.set_child(area);
        win.present();
        area.queue_render();

        // Quit once the render checks are in, plus one extra frame; a bounded
        // safety cap quits regardless so run() always returns.
        let ticks = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            ticks++;
            area.queue_render();
            if ((renderChecked && ticks >= 2) || ticks >= 80) {
                print(`render: ${renderChecked ? 'fired' : 'MISSING'}`);
                print('quit');
                app.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    } catch (error) {
        // Surface a failure as a deterministic line so a golden mismatch points
        // at the cause instead of hanging the loop.
        print(`activate-error: ${error instanceof Error ? error.message : String(error)}`);
        app.quit();
    }
});

print('webgl-glarea: start');
app.run([]); // top-level blocking run (no async wrapper — the node-gtk #442 caveat)
print('done');

// Force a clean exit(0) on BOTH runtimes: under node-gi a mapped GLArea's live
// GdkFrameClock stays an active GLib source after app.quit(), which the uv-driven
// auto-pump keeps mirroring onto libuv (the documented lifetime divergence vs
// gjs — an active GLib source holds the process, setInterval semantics).
process.exit(0);
