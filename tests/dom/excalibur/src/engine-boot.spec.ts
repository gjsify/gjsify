// Excalibur engine boot test — verifies ex.Engine initializes without throwing on GJS/WebGL.
// Pattern: GTK Window + WebGLBridge + GLib.MainLoop (same as packages/dom/webgl/src/ts/webgl1.spec.ts:18-50)
// Only runs when DISPLAY is available (on('Display', ...)).

import { describe, it, expect, on } from '@gjsify/unit';
import * as ex from 'excalibur';
import '@gjsify/dom-elements/register';
import { WebGLBridge } from '@gjsify/webgl';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

export default async () => {
    await on('Display', async () => {
        Gtk.init();

        await describe('ex.Engine', async () => {
            await it('constructs without throwing on a WebGL canvas', async () => {
                const loop = new GLib.MainLoop(null, false);
                const win = new Gtk.Window({});
                win.set_default_size(300, 200);
                const widget = new WebGLBridge();
                widget.installGlobals();

                let error: unknown = null;
                let game: ex.Engine | null = null;

                // Safety timeout: give up after 10 s if GL context never becomes ready
                const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
                    loop.quit();
                    return GLib.SOURCE_REMOVE;
                });

                widget.onReady((canvas) => {
                    GLib.source_remove(giveUpId);
                    try {
                        game = new ex.Engine({
                            canvasElement: canvas as any,
                            suppressPlayButton: true,

                        });
                    } catch (e) {
                        error = e;
                    }
                    loop.quit();
                });

                win.set_child(widget);
                win.present();
                loop.run();

                win.destroy();

                if (error) throw error;
                expect(game).toBeDefined();
                expect((game as ex.Engine).canvas).toBeDefined();
            });

            await it('ex.Engine canvas has positive dimensions after init', async () => {
                const loop = new GLib.MainLoop(null, false);
                const win = new Gtk.Window({});
                win.set_default_size(320, 240);
                const widget = new WebGLBridge();
                widget.installGlobals();

                let game: ex.Engine | null = null;
                let error: unknown = null;

                const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
                    loop.quit();
                    return GLib.SOURCE_REMOVE;
                });

                widget.onReady((canvas) => {
                    GLib.source_remove(giveUpId);
                    try {
                        game = new ex.Engine({
                            canvasElement: canvas as any,
                            suppressPlayButton: true,

                        });
                    } catch (e) {
                        error = e;
                    }
                    loop.quit();
                });

                win.set_child(widget);
                win.present();
                loop.run();
                win.destroy();

                if (error) throw error;
                // Canvas dimensions are GTK-allocated — just verify they are positive
                expect((game as ex.Engine).canvas.width).toBeGreaterThan(0);
                expect((game as ex.Engine).canvas.height).toBeGreaterThan(0);
            });
        });
    });
};
