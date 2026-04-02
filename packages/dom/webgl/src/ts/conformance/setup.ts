// Shared GL context setup for Khronos conformance test ports.
// Provides a blocking GTK/GLib initialization pattern identical to webgl1.spec.ts.

import { CanvasWebGLWidget } from '@gjsify/webgl';
import GLib from '@girs/glib-2.0';
import Gtk from '@girs/gtk-4.0';

export interface GLSetup {
    gl: WebGLRenderingContext;
    gl2: WebGL2RenderingContext | null;
    glArea: CanvasWebGLWidget;
    win: Gtk.Window;
}

/**
 * Synchronously initialises a GTK window + CanvasWebGLWidget and blocks until
 * the GL context is ready (or 10 s timeout).
 * Returns null when no display is available.
 */
export function createGLSetup(): GLSetup | null {
    Gtk.init();

    let result: GLSetup | null = null;
    const readyLoop = new GLib.MainLoop(null, false);

    const win = new Gtk.Window({});
    win.set_default_size(1, 1);

    const glArea = new CanvasWebGLWidget();
    glArea.onReady((canvas: globalThis.HTMLCanvasElement, g: globalThis.WebGLRenderingContext) => {
        const gl = g as unknown as WebGLRenderingContext;
        const gl2 = (canvas as any).getContext('webgl2') as WebGL2RenderingContext | null;
        result = { gl, gl2, glArea, win };
        readyLoop.quit();
    });

    win.set_child(glArea);
    win.present();

    const giveUpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
        readyLoop.quit();
        return GLib.SOURCE_REMOVE;
    });

    readyLoop.run();
    GLib.source_remove(giveUpId);

    return result;
}
