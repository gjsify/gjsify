// THE ORACLE: CANVAS2D_VECTORS against the real `Gtk.DrawingArea` bridge in a real window. A
// vector that fails here is a wrong vector; fix the vector. Needs a display, so it skips without
// one. `.gjs.spec.ts` is skipped by `audit-runtimes.mjs`.

import { describe, expect, it, on } from '@gjsify/unit';

import { type Canvas2DBridgeLike, driveCanvas2DVectors } from './conformance.js';
import { Canvas2DBridge } from './index.js';

export default async () => {
    await on('Gjs', async () => {
        const GLib = (await import('gi://GLib?version=2.0' as string)).default;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default;
        if (!Gtk.init_check()) return;

        const windows: { destroy(): void }[] = [];

        // Deadline, not a turn count: how soon the frame clock delivers a draw depends on the display
        // server (Xvfb, Broadway and Wayland differ by an order of magnitude), and a turn count that
        // fits one host times out on the next.
        const pump = async (done: () => boolean, ms = 10000) => {
            const deadline = GLib.get_monotonic_time() + ms * 1000;
            while (!done() && GLib.get_monotonic_time() < deadline) {
                while (GLib.MainContext.default().iteration(false));
                await new Promise((resolve) => setTimeout(resolve, 5));
            }
        };

        await driveCanvas2DVectors(
            {
                name: 'GJS (Gtk.DrawingArea)',
                create() {
                    const bridge = new Canvas2DBridge() as unknown as Canvas2DBridgeLike & {
                        halign: number;
                        valign: number;
                    };
                    bridge.halign = Gtk.Align.START;
                    bridge.valign = Gtk.Align.START;
                    // A fixed, larger window: the bridge is START-aligned, so its allocation is its own
                    // content size and no vector depends on a window manager resizing a toplevel.
                    const window = new Gtk.Window({ default_width: 256, default_height: 256 });
                    window.set_child(bridge);
                    window.present();
                    windows.push(window);
                    return bridge;
                },
                async allocate(bridge, width, height) {
                    const widget = bridge as unknown as {
                        content_width: number;
                        content_height: number;
                        queue_draw(): void;
                        queue_resize(): void;
                    };
                    widget.content_width = width;
                    widget.content_height = height;
                    widget.queue_resize();
                    widget.queue_draw();
                    await pump(() => bridge.canvas?.width === width && bridge.canvas?.height === height);
                    // A short settle so a notification emitted by the same allocation has landed.
                    await pump(() => false, 150);
                },
            },
            { describe, it, expect },
        );

        for (const window of windows) window.destroy();
    });
};
