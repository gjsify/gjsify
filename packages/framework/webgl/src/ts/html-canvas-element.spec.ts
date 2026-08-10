// HiDPI sizing contract of the GLArea-backed HTMLCanvasElement.
//
// The bug this pins: GtkGLArea's framebuffer is `allocation × scale-factor` and
// the GL viewport is raw device pixels, but `canvas.width` reported the
// ALLOCATION. Every consumer that sizes its viewport from `canvas.width` /
// `gl.drawingBufferWidth` (Three.js `setSize(canvas.width, …, false)`,
// Excalibur's `ExcaliburGraphicsContextWebGL`) therefore drew into the
// bottom-left `1/scale²` of the framebuffer and left the rest at the clear
// colour. Measured on a OnePlus 6T (postmarketOS, GNOME Mobile, 1080×2340 at
// scale-factor 3): a 360×655-logical widget rendered a 120×218 corner.
//
// A REAL Gtk.GLArea cannot cover this — CI runners and desktops report
// scale-factor 1, which is exactly the case that never failed. The stub below
// is the point: it varies the one number the hardware would not.

import type Gtk from 'gi://Gtk?version=4.0';
import { describe, expect, it } from '@gjsify/unit';
import { HTMLCanvasElement } from './html-canvas-element.js';

/** Minimal Gtk.GLArea stand-in — the canvas only ever asks it for these three. */
function stubGlArea(allocW: number, allocH: number, scale: number): Gtk.GLArea {
    return {
        get_allocated_width: () => allocW,
        get_allocated_height: () => allocH,
        get_scale_factor: () => scale,
    } as unknown as Gtk.GLArea;
}

export default async () => {
    // A clone has no GLArea to be backed by, and the default `new
    // this.constructor()` built one anyway — `gtkGlArea` came out `undefined`
    // and the first `width` read threw. Excalibur switches renderers exactly
    // this way (`canvas.cloneNode(false)` → `replaceChild` → `getContext('2d')`),
    // so its whole fallback died at the clone (gjsify#1107). A real Gtk.GLArea
    // cannot cover this on the hosts that run CI, hence the stub.
    await describe('HTMLCanvasElement (GLArea) — cloneNode', async () => {
        await it('clones to a plain canvas instead of throwing', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(640, 480, 1));
            const clone = canvas.cloneNode(false) as unknown as HTMLCanvasElement;
            expect(clone.width).toBe(640);
            expect(clone.height).toBe(480);
        });

        await it('gives the clone a writable size — no widget owns it', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(640, 480, 1));
            const clone = canvas.cloneNode(false) as unknown as HTMLCanvasElement;
            clone.width = 800;
            clone.height = 600;
            expect(clone.width).toBe(800);
            expect(clone.height).toBe(600);
        });

        await it('leaves the original bound to its widget', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(640, 480, 2));
            canvas.cloneNode(false);
            expect(canvas.width).toBe(1280);
        });
    });

    await describe('HTMLCanvasElement (GLArea) — drawing buffer vs CSS size', async () => {
        await it('reports the drawing buffer in DEVICE pixels on a HiDPI surface', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(360, 655, 3));
            expect(canvas.width).toBe(1080);
            expect(canvas.height).toBe(1965);
        });

        await it('keeps the CSS layout size LOGICAL on the same surface', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(360, 655, 3));
            expect(canvas.clientWidth).toBe(360);
            expect(canvas.clientHeight).toBe(655);
            expect(canvas.offsetWidth).toBe(360);
            expect(canvas.offsetHeight).toBe(655);
        });

        await it('CSS size × devicePixelRatio equals the drawing buffer', async () => {
            // The identity an unmodified browser consumer relies on. Broken
            // before the fix in BOTH directions: the ratio was a hardcoded 1 and
            // the buffer was reported as the allocation.
            const canvas = new HTMLCanvasElement(stubGlArea(800, 600, 2));
            expect(canvas.clientWidth * canvas.scaleFactor).toBe(canvas.width);
            expect(canvas.clientHeight * canvas.scaleFactor).toBe(canvas.height);
        });

        await it('is a no-op change at scale-factor 1 (every pre-HiDPI host)', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(1024, 768, 1));
            expect(canvas.width).toBe(1024);
            expect(canvas.height).toBe(768);
            expect(canvas.clientWidth).toBe(1024);
            expect(canvas.clientHeight).toBe(768);
        });

        await it('treats an unrealized widget (scale 0) as scale 1, not as a 0×0 buffer', async () => {
            // `get_scale_factor()` answers 0 before the widget has a surface;
            // multiplying by it would report a zero-sized drawing buffer, and
            // Three.js divides by it for the camera aspect.
            const canvas = new HTMLCanvasElement(stubGlArea(640, 480, 0));
            expect(canvas.scaleFactor).toBe(1);
            expect(canvas.width).toBe(640);
            expect(canvas.height).toBe(480);
        });

        await it('ignores width/height writes — GTK owns the allocation', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(360, 655, 3));
            canvas.width = 42;
            canvas.height = 42;
            expect(canvas.width).toBe(1080);
            expect(canvas.height).toBe(1965);
        });
    });
};
