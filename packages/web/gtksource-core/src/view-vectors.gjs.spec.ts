// THE ORACLE: the view vectors against real `gi://GtkSource` and `gi://Gtk`. A vector that fails here
// is a wrong vector; fix the vector. The defaults read pspecs; the surface vectors build a view, which
// needs a display, so they run only where `Gtk.init_check()` finds one.

import { describe, expect, it, on } from '@gjsify/unit';

import { GUTTER_PAINT_VECTORS, type GutterPaintSurface } from './gutter-paint-vectors.js';
import {
    GTKSOURCE_VIEW_DEFAULT_VECTORS,
    GTKSOURCE_VIEW_SURFACE_VECTORS,
    type GtkSourceViewSurfaceLike,
} from './view-vectors.js';

export default async () => {
    await on('Gjs', async () => {
        const GtkSource = (await import('gi://GtkSource?version=5' as string))
            .default as GtkSourceViewSurfaceLike['GtkSource'] & {
            View: { find_property(name: string): { get_default_value(): unknown } };
        };
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkSourceViewSurfaceLike['Gtk'] & {
            init_check(): boolean;
        };
        await describe('GJS (real GtkSource): View defaults', async () => {
            for (const vector of GTKSOURCE_VIEW_DEFAULT_VECTORS) {
                await it(vector.property, () => {
                    expect(GtkSource.View.find_property(vector.property).get_default_value()).toStrictEqual(
                        vector.shows,
                    );
                });
            }
        });
        const display = Gtk.init_check();
        await describe(`GJS (real GtkSource): View surface (display: ${display})`, async () => {
            for (const vector of GTKSOURCE_VIEW_SURFACE_VECTORS) {
                if (vector.instance && !display) continue;
                await it(vector.rule, () => {
                    expect(vector.observe({ Gtk, GtkSource })).toStrictEqual(vector.shows);
                });
            }
        });
        if (!display) return;
        const GObject = (await import('gi://GObject?version=2.0' as string)).default as GutterPaintSurface['GObject'];
        const GLib = (await import('gi://GLib?version=2.0' as string)).default as {
            PRIORITY_DEFAULT: number;
            SOURCE_REMOVE: boolean;
            timeout_add(priority: number, ms: number, callback: () => boolean): number;
        };
        // A pass needs a window on screen and a running main loop; the frame clock paints it later.
        const sleep = (ms: number) =>
            new Promise<void>((resolve) =>
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                }),
            );
        await describe('GJS (real GtkSource): gutter paint', async () => {
            for (const vector of GUTTER_PAINT_VECTORS) {
                await it(vector.rule, async () => {
                    const windows: { destroy(): void }[] = [];
                    const harness = {
                        async present(view: object) {
                            const window = new (
                                Gtk as unknown as {
                                    Window: new () => { set_child(w: object): void; present(): void; destroy(): void };
                                }
                            ).Window();
                            window.set_child(view);
                            window.present();
                            windows.push(window);
                            await sleep(400);
                        },
                        settle: () => sleep(250),
                    };
                    try {
                        expect(await vector.observe({ Gtk, GtkSource, GObject }, harness)).toStrictEqual(vector.shows);
                    } finally {
                        for (const window of windows) window.destroy();
                    }
                });
            }
        });
    });
};
