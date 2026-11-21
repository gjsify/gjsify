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
import { HTMLCanvasElement, snapToDevicePixel } from './html-canvas-element.js';

/** Minimal Gtk.GLArea stand-in — the canvas only ever asks it for these three. */
function stubGlArea(allocW: number, allocH: number, scale: number, surfaceScale?: number): Gtk.GLArea {
    return {
        get_native: () =>
            surfaceScale === undefined ? null : { get_surface: () => ({ get_scale: () => surfaceScale }) },
        get_allocated_width: () => allocW,
        get_allocated_height: () => allocH,
        get_scale_factor: () => scale,
    } as unknown as Gtk.GLArea;
}

export default async () => {
    await describe('snapToDevicePixel', async () => {
        const landed = (position: number, scale: number) => (position + snapToDevicePixel(position, scale)) * scale;
        await it('leaves a device-aligned edge alone', async () => {
            expect(snapToDevicePixel(0, 1.25)).toBe(0);
            expect(snapToDevicePixel(4, 1.25)).toBe(0);
            expect(snapToDevicePixel(42, 1)).toBe(0);
            expect(snapToDevicePixel(21, 2)).toBe(0);
        });
        await it('lands every fractional edge on a whole device pixel', async () => {
            for (const scale of [1.25, 1.5, 1.75, 2.5]) {
                for (let position = 0; position < 200; position++) {
                    const device = landed(position, scale);
                    expect(Math.abs(device - Math.round(device)) < 1e-9).toBe(true);
                }
            }
        });
        await it('moves by less than half a device pixel', async () => {
            for (let position = 0; position < 200; position++) {
                expect(Math.abs(snapToDevicePixel(position, 1.25)) * 1.25 <= 0.5 + 1e-9).toBe(true);
            }
        });
        await it('ignores a missing scale', async () => {
            expect(snapToDevicePixel(7, 0)).toBe(0);
        });
    });

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

    // GTK reports the INTEGER `ceil(scale)` from get_scale_factor() and sizes the GL
    // framebuffer with it, while the surface knows the real fractional scale.
    await describe('HTMLCanvasElement (GLArea) — fractional scale', async () => {
        await it('reports the REAL device size at 125 %', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(400, 300, 2, 1.25));
            expect(canvas.scaleFactor).toBe(1.25);
            expect(canvas.width).toBe(500);
            expect(canvas.height).toBe(375);
        });

        await it('reports the REAL device size at 150 %', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(400, 300, 2, 1.5));
            expect(canvas.width).toBe(600);
            expect(canvas.height).toBe(450);
        });

        await it('rounds a non-integer device size to whole pixels', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(401, 301, 2, 1.25));
            expect(canvas.width).toBe(501);
            expect(canvas.height).toBe(376);
        });

        await it('never exceeds the ceil-sized GTK framebuffer', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(333, 777, 2, 1.25));
            expect(canvas.width).toBeLessThan(333 * 2 + 1);
            expect(canvas.height).toBeLessThan(777 * 2 + 1);
        });

        await it('falls back to the integer factor when no surface scale exists', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(400, 300, 2));
            expect(canvas.scaleFactor).toBe(2);
            expect(canvas.width).toBe(800);
        });

        await it('integer surface scale is unchanged', async () => {
            const canvas = new HTMLCanvasElement(stubGlArea(400, 300, 2, 2));
            expect(canvas.width).toBe(800);
        });
    });
};
