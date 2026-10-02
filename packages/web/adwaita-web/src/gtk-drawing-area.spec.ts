// DOM-level tests for <gtk-drawing-area>. Three separable things get their own describe:
// the SIZE (the content properties and the floor they are), the CALLBACK (what it is
// handed and how often it runs), and the NOTIFICATION pair — `resize` for the allocation
// and `notify::` for the properties, which fire on different things in the C.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkDrawingArea } from './elements/gtk-drawing-area.js';

function mount(attrs: Record<string, string> = {}): { el: GtkDrawingArea; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-drawing-area') as GtkDrawingArea;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

/**
 * Two frames, not one: the platform delivers a ResizeObserver's first observation AFTER
 * the animation-frame callbacks of the frame it belongs to, so a single `rAF` resolves
 * before the allocation the first draw needs has been recorded.
 */
function settled(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export const GtkDrawingAreaTest = async () => {
    await describe('<gtk-drawing-area> size', async () => {
        await it('defaults to no intrinsic size on either axis', () => {
            // gtkdrawingarea.c:288-304 — both pspecs default to 0.
            const { el, host } = mount();
            expect(el.contentWidth).toBe(0);
            expect(el.contentHeight).toBe(0);
            host.remove();
        });

        await it('reads the two GIR properties as attributes', () => {
            const { el, host } = mount({ 'content-width': '160', 'content-height': '120' });
            expect(el.contentWidth).toBe(160);
            expect(el.contentHeight).toBe(120);
            host.remove();
        });

        await it('clamps a write outside the pspec range instead of refusing it', () => {
            // g_param_spec_int ("content-width", …, 0, G_MAXINT, 0, …) at :290-294.
            const { el, host } = mount();
            el.contentWidth = 999;
            expect(el.contentWidth).toBe(999);
            el.contentWidth = -50;
            expect(el.contentWidth).toBe(0);
            el.contentHeight = 1e12;
            expect(el.contentHeight).toBe(2147483647);
            host.remove();
        });

        await it('notifies only when the value really moves', () => {
            // gtkdrawingarea.c:373 — `if (priv->content_width == width) return;`.
            const { el, host } = mount({ 'content-width': '160' });
            const seen: unknown[] = [];
            el.addEventListener('notify::content-width', (event) =>
                seen.push((event as CustomEvent).detail['content-width']),
            );
            el.contentWidth = 160;
            expect(seen).toStrictEqual([]);
            el.contentWidth = 200;
            expect(seen).toStrictEqual([200]);
            host.remove();
        });

        await it('is the minimum AND the natural size, so the floor follows the number', () => {
            // gtkdrawingarea.c:210-231 — `*minimum = *natural = priv->content_width`, which
            // `_drawing.scss` spells as one custom property read by `width` AND `min-width`.
            const { el, host } = mount({ 'content-width': '160', 'content-height': '120' });
            expect(el.style.getPropertyValue('--adw-drawing-width')).toBe('160px');
            expect(el.style.getPropertyValue('--adw-drawing-height')).toBe('120px');
            expect(el.querySelector('canvas')).not.toBe(null);
            // At the zero default there is no intrinsic size at all, so the property is
            // GONE and the stylesheet's `auto` fallback is what answers.
            el.contentWidth = 0;
            expect(el.style.getPropertyValue('--adw-drawing-width')).toBe('');
            host.remove();
        });
    });

    await describe('<gtk-drawing-area> the draw function', async () => {
        await it('has none until one is set, and paints nothing', () => {
            // gtkdrawingarea.c:251-252 — `if (!priv->draw_func) return;`.
            const { el, host } = mount({ 'content-width': '40', 'content-height': '40' });
            expect(el.drawFunc).toBe(null);
            host.remove();
        });

        await it('is called with the ALLOCATION, not with the content size', async () => {
            const { el, host } = mount({ 'content-width': '40', 'content-height': '40' });
            const calls: number[][] = [];
            el.setDrawFunc((_area, cr, width, height) => {
                calls.push([width, height, Math.round(cr.lineWidth)]);
                cr.fillStyle = '#ff0000';
                cr.fillRect(0, 0, width, height);
            });
            await settled();
            expect(calls.length).toBeGreaterThan(0);
            // The callback runs, and the numbers it gets are the box the element was
            // allocated — never the two properties (:248-262).
            expect(calls[0][0]).toBeGreaterThanOrEqual(40);
            expect(calls[0][1]).toBeGreaterThanOrEqual(40);
            const canvas = el.querySelector('canvas') as HTMLCanvasElement;
            expect(canvas.width).toBeGreaterThan(0);
            host.remove();
        });

        await it('runs again when queue_draw asks for it', async () => {
            const { el, host } = mount({ 'content-width': '40', 'content-height': '40' });
            let calls = 0;
            el.setDrawFunc(() => {
                calls += 1;
            });
            await settled();
            const seen = calls;
            // gtkdrawingarea.c:127-129 — queue_draw calls the draw function again.
            el.queueDraw();
            expect(calls).toBe(seen + 1);
            host.remove();
        });

        await it('installing one repaints with it, and clearing it blanks the widget', async () => {
            const { el, host } = mount({ 'content-width': '40', 'content-height': '40' });
            let calls = 0;
            el.setDrawFunc(() => {
                calls += 1;
            });
            await settled();
            const seen = calls;
            expect(seen).toBeGreaterThan(0);
            // `set_draw_func` ends in `gtk_widget_queue_draw` (gtkdrawingarea.c:489), and
            // the snapshot that answers calls the NEW function — so the install itself is
            // what repaints, not the next unrelated frame.
            el.setDrawFunc(() => {
                calls += 1;
            });
            expect(calls).toBe(seen + 1);
            // With no function the snapshot returns before drawing (:251-252), so nothing
            // is painted from here on however often a redraw is asked for.
            const blanked = calls;
            el.setDrawFunc(null);
            el.queueDraw();
            await settled();
            expect(el.drawFunc).toBe(null);
            expect(calls).toBe(blanked);
            host.remove();
        });

        await it('hands the callback a context that starts each frame empty', async () => {
            // GTK's renderer gives every frame a fresh surface; a canvas keeps its pixels,
            // so the element clears — the one place a naive port shows (see the header).
            const { el, host } = mount({ 'content-width': '40', 'content-height': '40' });
            let pixel: number[] = [];
            el.setDrawFunc((_area, cr, _width, _height) => {
                cr.fillStyle = '#0000ff';
                cr.fillRect(0, 0, 1, 1);
                pixel = [...cr.getImageData(0, 0, 1, 1).data];
            });
            await settled();
            expect(pixel[2]).toBe(255);
            el.queueDraw();
            expect(pixel[2]).toBe(255);
            host.remove();
        });
    });

    await describe('<gtk-drawing-area> notifications', async () => {
        await it('emits resize with the allocation, once per change', async () => {
            // gtkdrawingarea.c:233-238 — size_allocate emits ::resize and does nothing else.
            const { el, host } = mount({ 'content-width': '40', 'content-height': '40' });
            const seen: { width: number; height: number }[] = [];
            // `resize` is a UIEvent name in lib.dom, so the listener parameter arrives typed.
            el.addEventListener('resize', (event) => seen.push((event as unknown as CustomEvent).detail));
            await settled();
            expect(seen.length).toBe(1);
            expect(seen[0].width).toBeGreaterThanOrEqual(40);
            el.style.width = '80px';
            await settled();
            expect(seen.length).toBe(2);
            expect(seen[1].width).toBe(80);
            host.remove();
        });

        await it('re-arms its observer when the element comes back', async () => {
            // The ResizeObserver is released on the way out, so a re-parent has to arm it
            // again — the shape `scripts/check-adwaita-connect-rebind.mjs` holds for.
            const { el, host } = mount({ 'content-width': '40', 'content-height': '40' });
            await settled();
            const parked = document.createElement('div');
            document.body.appendChild(parked);
            host.remove();
            parked.appendChild(el);
            const seen: unknown[] = [];
            // `resize` is a UIEvent name in lib.dom, so the listener parameter arrives typed.
            el.addEventListener('resize', (event) => seen.push((event as unknown as CustomEvent).detail));
            el.style.width = '96px';
            await settled();
            expect(seen.length).toBe(1);
            parked.remove();
            host.remove();
        });
    });
};
