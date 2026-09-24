// HiDPI drawing-buffer contract of WebGLBridge, against a REAL Gtk.GLArea.
//
// `html-canvas-element.spec.ts` pins the arithmetic with a stub, so it runs at any
// scale on any host. What a stub cannot say is whether the arithmetic matches the
// framebuffer GTK actually allocates: that `allocation × get_scale_factor()` is
// what `Gtk.GLArea` hands to GL on a given backend. This file asks GTK itself, via
// three witnesses that do not go through our own getters:
//   - the device-pixel size GTK passes to the GLArea `resize` signal,
//   - the viewport GTK leaves bound when it emits `render`,
//   - a pixel written to and read back from the far corner of the framebuffer.
//
// At scale-factor 1 all three agree trivially, so on its own this file proves
// nothing at 1. It is meant to run where the scale is NOT 1: on a Retina Mac
// natively (measured on macOS 27 / Apple silicon at scale 2 — with the `Gl` gate
// opened by hand, since `canRealizeGl` stands down on darwin until a CI leg proves
// the context there), and in CI under `GDK_SCALE=2` on X11 (`test:hidpi`).
// `GJSIFY_TEST_EXPECT_SCALE` turns that intent into an assertion, so a harness
// whose scale override stopped taking effect fails instead of passing vacuously.

import { describe, it, expect, on } from '@gjsify/unit';
import type { WebGLRenderingContext } from '@gjsify/webgl';
import { WebGLBridge } from '@gjsify/webgl';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

/** What one rendered frame looked like from inside the `render` signal. */
interface FrameWitness {
    allocW: number;
    allocH: number;
    scale: number;
    dpr: number;
    canvasW: number;
    canvasH: number;
    clientW: number;
    clientH: number;
    bufferW: number;
    bufferH: number;
    /** The REAL GL_VIEWPORT as GTK left it, read before this code touches it. */
    gtkViewport: number[];
    /** RGBA of the framebuffer's top-right DEVICE pixel after painting it green. */
    farCorner: number[];
}

const GL_VIEWPORT = 0x0ba2;

/** The Gwebgl binding under the context — the one reader that bypasses our shadow state. */
function nativeGl(gl: WebGLRenderingContext): { getParameteriv(pname: number, n: number): ArrayLike<number> } {
    return (gl as unknown as { _native: { getParameteriv(pname: number, n: number): ArrayLike<number> } })._native;
}

/** Spin the main loop until `done()` or `timeoutMs`; returns whether `done()` held. */
function spinUntil(done: () => boolean, timeoutMs = 10000): boolean {
    const ctx = GLib.MainContext.default();
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    // A blocking iteration waits for the NEXT event; this wakeup bounds that wait, so a
    // GLArea that never renders fails at the deadline instead of hanging the suite.
    const wakeup = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => GLib.SOURCE_CONTINUE);
    while (!done() && GLib.get_monotonic_time() < deadline) ctx.iteration(true);
    GLib.source_remove(wakeup);
    return done();
}

export default async () => {
    await on('Gl', async () => {
        Gtk.init();

        const win = new Gtk.Window({ default_width: 320, default_height: 240 });
        const area = new WebGLBridge();
        area.set_hexpand(true);
        area.set_vexpand(true);
        // devicePixelRatio is an accessor that installGlobals() puts on globalThis; it
        // is part of the identity under test, so the real one must be installed.
        area.installGlobals();

        // GTK's own statement of the framebuffer size: GtkGLArea emits `resize` with
        // DEVICE pixels, independently of anything this package computes.
        const gtkResizes: [number, number][] = [];
        area.connect('resize', (_a: Gtk.GLArea, w: number, h: number) => {
            gtkResizes.push([w, h]);
        });

        let canvas: globalThis.HTMLCanvasElement | null = null;
        let gl: WebGLRenderingContext | null = null;
        area.onReady((c, g) => {
            canvas = c;
            gl = g as unknown as WebGLRenderingContext;
        });
        win.set_child(area);
        win.present();
        spinUntil(() => gl !== null);

        /** Render one frame through rAF and record what GTK bound for it. */
        const captureFrame = (): FrameWitness | null => {
            let witness: FrameWitness | null = null;
            area.requestAnimationFrame(() => {
                const g = gl!;
                const c = canvas!;
                // Straight from GL, not `getParameter(VIEWPORT)`: that answers from a JS
                // shadow of the app's own `viewport()` calls (per spec a canvas resize
                // leaves it alone), so it cannot witness what GTK bound.
                const gtkViewport = Array.from(nativeGl(g).getParameteriv(GL_VIEWPORT, 4));
                const bufferW = g.drawingBufferWidth;
                const bufferH = g.drawingBufferHeight;
                g.enable(g.SCISSOR_TEST);
                g.scissor(0, 0, bufferW, bufferH);
                g.clearColor(1, 0, 0, 1);
                g.clear(g.COLOR_BUFFER_BIT);
                g.scissor(bufferW - 1, bufferH - 1, 1, 1);
                g.clearColor(0, 1, 0, 1);
                g.clear(g.COLOR_BUFFER_BIT);
                g.disable(g.SCISSOR_TEST);
                const px = new Uint8Array(4);
                g.readPixels(bufferW - 1, bufferH - 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
                witness = {
                    allocW: area.get_allocated_width(),
                    allocH: area.get_allocated_height(),
                    scale: area.get_scale_factor(),
                    dpr: (globalThis as unknown as { devicePixelRatio: number }).devicePixelRatio,
                    canvasW: c.width,
                    canvasH: c.height,
                    clientW: c.clientWidth,
                    clientH: c.clientHeight,
                    bufferW,
                    bufferH,
                    gtkViewport,
                    farCorner: Array.from(px),
                };
            });
            spinUntil(() => witness !== null);
            return witness;
        };

        /** The contract, asserted against one frame. */
        const assertFrame = async (label: string, getFrame: () => FrameWitness | null) => {
            await describe(`WebGLBridge HiDPI on a real GLArea — ${label}`, async () => {
                await it('renders a frame', async () => {
                    expect(getFrame()).not.toBeNull();
                });

                await it('devicePixelRatio is the widget scale factor', async () => {
                    const f = getFrame()!;
                    expect(f.scale).toBeGreaterThan(0);
                    expect(f.dpr).toBe(f.scale);
                });

                await it('drawing buffer = CSS size × devicePixelRatio', async () => {
                    const f = getFrame()!;
                    expect(f.clientW).toBe(f.allocW);
                    expect(f.clientH).toBe(f.allocH);
                    expect(f.canvasW).toBe(f.clientW * f.dpr);
                    expect(f.canvasH).toBe(f.clientH * f.dpr);
                    expect(f.bufferW).toBe(f.canvasW);
                    expect(f.bufferH).toBe(f.canvasH);
                });

                await it("matches the size GTK's resize signal gave in device pixels", async () => {
                    const f = getFrame()!;
                    const last = gtkResizes[gtkResizes.length - 1];
                    expect(last).toBeDefined();
                    expect(last[0]).toBe(f.bufferW);
                    expect(last[1]).toBe(f.bufferH);
                });

                await it('matches the viewport GTK bound for the render', async () => {
                    // A drawing buffer reported at the ALLOCATION would read [0,0,w/s,h/s]
                    // against GTK's [0,0,w,h] here — the bottom-left 1/s² bug.
                    const f = getFrame()!;
                    expect(f.gtkViewport.join(',')).toBe(`0,0,${f.bufferW},${f.bufferH}`);
                });

                await it('reaches the top-right device pixel of the framebuffer', async () => {
                    const f = getFrame()!;
                    expect(f.farCorner.join(',')).toBe('0,255,0,255');
                });
            });
        };

        expect(gl).not.toBeNull();

        const first = captureFrame();
        await assertFrame('initial size', () => first);

        const expectScale = GLib.getenv('GJSIFY_TEST_EXPECT_SCALE');
        if (expectScale) {
            await describe('WebGLBridge HiDPI — requested scale took effect', async () => {
                await it(`runs at scale ${expectScale}`, async () => {
                    expect(first?.scale).toBe(Number(expectScale));
                });
            });
        }

        // Grow the widget: a size request forces the window up regardless of window
        // manager, where set_default_size on a mapped window is only a hint.
        const before = gtkResizes.length;
        const grownW = (first?.allocW ?? 320) + 160;
        const grownH = (first?.allocH ?? 240) + 120;
        area.set_size_request(grownW, grownH);
        spinUntil(() => gtkResizes.length > before && area.get_allocated_width() >= grownW);
        const resized = captureFrame();
        await assertFrame('after resize', () => resized);

        await describe('WebGLBridge HiDPI — resize', async () => {
            await it('the drawing buffer followed the new allocation', async () => {
                expect(resized!.allocW).toBeGreaterThan(first!.allocW);
                expect(resized!.bufferW).toBe(resized!.allocW * resized!.scale);
                expect(resized!.bufferH).toBe(resized!.allocH * resized!.scale);
            });
        });

        win.destroy();
    });
};
