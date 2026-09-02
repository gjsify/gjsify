// GDK-backed implementation of the pixel-interop seam in ./pixel-bridge.ts, which explains why GDK
// is the only option. The one module of this package that touches GTK, unreachable from
// `src/index.ts` and shipped behind the `@gjsify/canvas2d-core/gdk` subpath so that pulling GTK in
// stays an explicit, greppable act. Importing it registers the bridge, hence the entry in
// `package.json#sideEffects` (AGENTS.md § Tree-shakeable globals).

import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import type Cairo from 'cairo';

import { type CanvasImageHandle, type CanvasPixelBridge, setCanvasPixelBridge } from './pixel-bridge.js';

/** The GDK-backed {@link CanvasPixelBridge}. */
export const gdkPixelBridge: CanvasPixelBridge = {
    imageFromSurface(
        surface: Cairo.Surface,
        srcX: number,
        srcY: number,
        width: number,
        height: number,
    ): CanvasImageHandle | null {
        return Gdk.pixbuf_get_from_surface(surface, srcX, srcY, width, height);
    },

    setSourceImage(cr: Cairo.Context, image: CanvasImageHandle, x: number, y: number): void {
        Gdk.cairo_set_source_pixbuf(cr, image as GdkPixbuf.Pixbuf, x, y);
    },

    setSourcePixels(cr: Cairo.Context, rgba: Uint8Array, width: number, height: number, x: number, y: number): void {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            rgba,
            GdkPixbuf.Colorspace.RGB,
            true, // has_alpha
            8, // bits_per_sample
            width,
            height,
            width * 4, // rowstride — tightly packed RGBA
        );
        Gdk.cairo_set_source_pixbuf(cr, pixbuf, x, y);
    },
};

setCanvasPixelBridge(gdkPixelBridge);
