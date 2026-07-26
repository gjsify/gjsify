// GDK-backed implementation of the Canvas 2D pixel-interop seam.
//
// Reimplemented for GJS using Gdk 4 (`gdk_pixbuf_get_from_surface` /
// `gdk_cairo_set_source_pixbuf`) and GdkPixbuf.
//
// This is the ONE module of `@gjsify/canvas2d-core` that touches GTK. It is
// deliberately NOT reachable from `src/index.ts`: the package root stays
// headless (Cairo + PangoCairo), and this file ships behind the dedicated
// `@gjsify/canvas2d-core/gdk` subpath so pulling GTK in is an explicit,
// greppable act by a package that already lives in a GTK process
// (`@gjsify/dom-elements`' canvas register, `@gjsify/canvas2d`).
//
// Importing it registers the bridge as a side effect — mirroring the
// `/register` subpath convention (AGENTS.md, "Tree-shakeable globals"), which
// is why `package.json#sideEffects` lists the built file.
//
// Why GDK at all: GJS' `cairo` module binds no pixel accessor
// (`refs/gjs/modules/cairo-image-surface.cpp` comments `getData` out of
// `proto_funcs`), and `Gdk` is the only introspectable provider of the
// Cairo⇄GdkPixbuf converters. See `./pixel-bridge.ts` for the full rationale.

import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
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
