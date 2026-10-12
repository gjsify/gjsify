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

        const pump = async (done: () => boolean, turns = 60) => {
            for (let i = 0; i < turns && !done(); i++) {
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
                    const window = new Gtk.Window({ default_width: 1, default_height: 1 });
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
                        get_root(): { set_default_size(w: number, h: number): void } | null;
                    };
                    widget.content_width = width;
                    widget.content_height = height;
                    widget.get_root()?.set_default_size(1, 1);
                    widget.queue_draw();
                    await pump(() => bridge.canvas?.width === width && bridge.canvas?.height === height);
                    // Bounded: an unchanged allocation never makes the canvas match, so it waits the turns out.
                    // One more turn so a notification emitted by the same allocation has landed.
                    await pump(() => false, 20);
                },
            },
            { describe, it, expect },
        );

        for (const window of windows) window.destroy();
    });
};
