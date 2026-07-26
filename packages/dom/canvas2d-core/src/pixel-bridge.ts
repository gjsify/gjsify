// Pixel-interop seam for the headless Canvas 2D core.
//
// `@gjsify/canvas2d-core` is the HEADLESS half of the Canvas 2D stack: it
// renders with Cairo + PangoCairo and must NOT reach GTK/GDK (see AGENTS.md,
// `packages/dom/` table). Cairo alone, however, cannot do two things the
// Canvas 2D spec requires:
//
//   1. read raw pixels back out of a `Cairo.ImageSurface` (`getImageData`,
//      `drawImage(canvas, …)`, `createPattern(canvas, …)`), and
//   2. install raw RGBA bytes or a decoded platform image as the Cairo source
//      (`putImageData`, `drawImage(image, …)`, `createPattern(image, …)`).
//
// GJS' built-in `cairo` module deliberately does not bind
// `cairo_image_surface_get_data()` / `cairo_image_surface_create_for_data()`
// (see `refs/gjs/modules/cairo-image-surface.cpp` — `getData` is commented out
// of `proto_funcs`), and no headless GI typelib fills the gap: the only
// introspectable Cairo⇄GdkPixbuf converters are `Gdk.pixbuf_get_from_surface()`
// and `Gdk.cairo_set_source_pixbuf()`, which live in `Gdk-4.0` — i.e. inside
// `libgtk-4.so`.
//
// So the capability is injected instead of imported: this module defines the
// contract and the registry, and a platform module supplies the implementation
// (`@gjsify/canvas2d-core/gdk`, the GDK-backed one, pulled in by
// `@gjsify/dom-elements/register/canvas` and `@gjsify/canvas2d`). The core
// itself stays free of every `gi://Gdk` reference.
//
// Reference: refs/node-canvas — the equivalent boundary is node-canvas' native
// `Image`/`Canvas` backends, which own pixel I/O for the same reason.

import type Cairo from 'cairo';

/**
 * A decoded, readable platform image.
 *
 * Structurally the slice of `GdkPixbuf.Pixbuf` the core consumes — declared
 * here rather than imported from `gi://GdkPixbuf` so the core carries no GI
 * value *or* type dependency. Both the pixbufs produced by
 * `@gjsify/dom-elements`' `HTMLImageElement` and the ones a
 * {@link CanvasPixelBridge} reads back out of a Cairo surface satisfy it.
 */
export interface CanvasImageHandle {
    get_width(): number;
    get_height(): number;
    get_pixels(): Uint8Array;
    get_rowstride(): number;
    get_n_channels(): number;
    get_has_alpha(): boolean;
}

/**
 * The Cairo ⇄ pixel-buffer interop the headless core cannot implement itself.
 *
 * Implementations are platform code (today: GDK). Register one with
 * {@link setCanvasPixelBridge}; every method is expected to behave exactly
 * like the GDK original it mirrors.
 */
export interface CanvasPixelBridge {
    /**
     * Read a rectangular region of a Cairo surface into a readable image
     * handle, un-premultiplying alpha (mirrors `Gdk.pixbuf_get_from_surface`).
     *
     * Returns `null` when the region cannot be read (out of bounds, an
     * unsupported surface format, or a zero-sized rectangle).
     */
    imageFromSurface(
        surface: Cairo.Surface,
        srcX: number,
        srcY: number,
        width: number,
        height: number,
    ): CanvasImageHandle | null;

    /**
     * Install a decoded image as the Cairo context's source pattern, with the
     * image's top-left corner at (`x`, `y`) in user space (mirrors
     * `Gdk.cairo_set_source_pixbuf`).
     */
    setSourceImage(cr: Cairo.Context, image: CanvasImageHandle, x: number, y: number): void;

    /**
     * Install raw, NON-premultiplied RGBA bytes (8 bits per channel, tightly
     * packed at `width * 4` bytes per row) as the Cairo context's source
     * pattern, with the buffer's top-left corner at (`x`, `y`) in user space.
     */
    setSourcePixels(cr: Cairo.Context, rgba: Uint8Array, width: number, height: number, x: number, y: number): void;
}

let bridge: CanvasPixelBridge | null = null;

/**
 * Register the platform pixel bridge. Last registration wins, so an embedder
 * can substitute its own implementation (e.g. a test double).
 */
export function setCanvasPixelBridge(implementation: CanvasPixelBridge): void {
    bridge = implementation;
}

/** Whether a pixel bridge has been registered. */
export function hasCanvasPixelBridge(): boolean {
    return bridge !== null;
}

/**
 * The registered pixel bridge.
 *
 * Throws — rather than silently degrading to blank pixels — when nothing has
 * been registered, because the caller asked for a pixel operation that cannot
 * be answered correctly without one.
 */
export function getCanvasPixelBridge(): CanvasPixelBridge {
    if (!bridge) {
        throw new TypeError(
            '@gjsify/canvas2d-core: no pixel bridge registered — pixel operations ' +
                '(getImageData / putImageData / drawImage / createPattern) need a platform ' +
                "backend. On GJS, import '@gjsify/canvas2d-core/gdk' (or use " +
                "'@gjsify/dom-elements' / '@gjsify/canvas2d', which register it for you).",
        );
    }
    return bridge;
}
