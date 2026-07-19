// SPDX-License-Identifier: MIT
//
// Excalibur.js on node-gi — ONE source, two runtimes. The Axis-5 capstone:
// a REAL WebGL game engine (Excalibur 0.32, the same engine the
// excalibur-jelly-jumper showcase and the PixelRPG map-editor run on GJS)
// boots against `@gjsify/webgl`'s `WebGLBridge` and renders through the
// node-gi reverse bridge:
//
//   gjsify build … --app gjs   → native gi:// under GJS   (the gold standard)
//   gjsify build … --app node  → @gjsify/node-gi under Node.js
//
// Where `webgl-bridge-app.ts` proves the TS WebGL stack (clear + readPixels),
// this fixture drives Excalibur's FULL WebGL2 renderer path UNCHANGED:
// `new ex.Engine({ canvasElement })` boots against the bridge's
// `HTMLCanvasElement` (context creation via `canvas.getContext('webgl2')`),
// `engine.start()` resolves (the DOM/rAF/clock surface works), the engine's
// render pipeline compiles its REAL shaders (`shaderSource`/`compileShader`/
// `linkProgram`), uploads geometry (`bufferData` with typed arrays, VAOs,
// `vertexAttribPointer`), renders solid quads (`uniformMatrix4fv`,
// `drawArrays`/`drawElements`, `clearBufferfv` at RenderTarget.blitToScreen)
// for N frames, and the committed golden asserts the drawn pixels read back
// off the GL framebuffer: the blue Actor at the screen center, the red engine
// clear color at the corner outside it — byte-identical between `gjs -m` and
// `node`.
//
// Loader: `ex.DefaultLoader` (the base loader) — no play-button overlay, no
// logo image. NB even the base loader runs `await WebAudio.unlock()`; the
// node build deliberately does NOT inject `AudioContext` (see the test file's
// globals list), so the unlock no-ops instead of pulling the Gst-backed
// `@gjsify/webaudio` stack into this GL-only fixture.
//
// Every stdout line is DETERMINISTIC; diagnostics go to stderr. `print` is
// ambient under GJS and injected for the node build. Globals: the gjs build
// injects the DOM surface via `--globals auto,dom` (jelly-jumper's flags);
// the node build names the needed identifiers explicitly — the reverse
// bridge's explicit-extras register injection.
//
// Reference: showcases/dom/excalibur-jelly-jumper (the full consumer this
// unblocks on node), packages/framework/webgl/src/ts/webgl-bridge.ts.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { WebGLBridge } from '@gjsify/webgl';
import * as ex from 'excalibur';

// Fallback size when the allocation is not yet available; the golden's pixel
// coordinates derive from the ACTUAL GLArea allocation (windows are sized to
// this, so allocation == W×H on both runtimes).
const W = 128;
const H = 96;
const FRAMES = 5;

const app = new Gtk.Application({
    application_id: 'eu.jumplink.NodeGiExcaliburWebGL',
    flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
});

let bootState = 'pending';

async function bootGame(
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext,
    bridge: InstanceType<typeof WebGLBridge>,
): Promise<void> {
    // Size the drawing buffer to the real allocation (jelly-jumper does the
    // same in its onReady) so Excalibur's viewport fills the whole GLArea FBO.
    const width = bridge.get_allocated_width() || W;
    const height = bridge.get_allocated_height() || H;
    canvas.width = width;
    canvas.height = height;
    print(`ready: canvas ${canvas.width > 0 && canvas.height > 0 ? 'sized' : 'empty'}`);

    const engine = new ex.Engine({
        canvasElement: canvas as unknown as HTMLCanvasElement,
        suppressConsoleBootMessage: true,
        suppressMinimumBrowserFeatureDetection: true,
        suppressPlayButton: true,
        resolution: { width, height },
        // The SAME display mode the excalibur-jelly-jumper showcase runs on
        // GJS: the canvas is parented to document.body (the bridge appends it),
        // and Excalibur observes that parent via our ResizeObserver polyfill.
        displayMode: ex.DisplayMode.FitContainerAndFill,
        pixelRatio: 1,
        backgroundColor: ex.Color.fromHex('#ff0000'), // the corner-pixel red
    });

    // A screen-centered solid Actor — Excalibur's default rectangle graphic
    // renders through the REAL quad pipeline (shader compile/link, bufferData,
    // vertexAttribPointer, drawArrays). Camera pinned to the screen center so
    // world == screen coordinates regardless of engine defaults.
    const actor = new ex.Actor({
        pos: ex.vec(width / 2, height / 2),
        width: 48,
        height: 40,
        color: ex.Color.fromHex('#0000ff'), // the center-pixel blue
    });
    engine.currentScene.add(actor);
    engine.currentScene.camera.pos = ex.vec(width / 2, height / 2);

    await engine.start(new ex.DefaultLoader());
    print('engine: started');

    let frames = 0;
    engine.on('postdraw', () => {
        frames++;
        if (frames !== FRAMES) return;
        // Frame N just flushed inside the GLArea render signal — the GL
        // context is current. bindFramebuffer(null) re-binds GtkGLArea's
        // private FBO (the surface Excalibur's final flush drew to), then
        // read the two proof pixels straight off it.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const px = new Uint8Array(4);
        // Center of the viewport → inside the blue Actor (y-flip symmetric).
        gl.readPixels(Math.floor(width / 2), Math.floor(height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        print(`pixel-center: ${Array.from(px).join(',')}`);
        // Corner (2,2) → outside the Actor: the engine's red clear color.
        gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        print(`pixel-corner: ${Array.from(px).join(',')}`);
        print(`frames: ${frames >= FRAMES ? 'ok' : String(frames)}`);
        engine.stop();
        bootState = 'done';
        print('quit');
        app.quit();
    });
}

app.connect('activate', () => {
    try {
        print('activated');
        const win = new Gtk.ApplicationWindow({ application: app });
        win.set_default_size(W, H);

        const bridge = new WebGLBridge();
        bridge.installGlobals();
        bridge.onReady((canvas, gl) => {
            bootGame(canvas as unknown as HTMLCanvasElement, gl as unknown as WebGLRenderingContext, bridge).catch(
                (error) => {
                    print(`boot-error: ${error instanceof Error ? error.message : String(error)}`);
                    printerr(error instanceof Error ? (error.stack ?? '') : '');
                    app.quit();
                },
            );
        });

        win.set_child(bridge);
        win.present();

        // Bounded safety cap: if the engine never reaches FRAMES postdraws the
        // run still terminates deterministically with a diagnosable line.
        let ticks = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            ticks++;
            if (bootState === 'done') return GLib.SOURCE_REMOVE;
            if (ticks >= 60) {
                print('boot-error: timeout waiting for engine frames');
                app.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    } catch (error) {
        print(`activate-error: ${error instanceof Error ? error.message : String(error)}`);
        app.quit();
    }
});

print('excalibur-webgl: start');
// runAsync (NOT the sync run()): defers the blocking loop to a macrotask so
// every dispatched callback gets its own microtask checkpoint — Excalibur's
// promise-driven boot (engine.start()) drains WHILE the loop runs on BOTH
// runtimes. This is the GJS-recommended lifecycle too (Gio.Application.runAsync).
await app.runAsync([]);
print('done');

// Force a clean exit(0) on BOTH runtimes: under node-gi the mapped GLArea's
// live GdkFrameClock stays an active GLib source after app.quit() (the
// documented lifetime divergence vs gjs — an active source holds the process).
process.exit(0);
