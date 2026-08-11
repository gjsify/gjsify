// Pixel-interop seam for the headless Canvas 2D core. Cairo alone cannot read pixels back out
// of a surface or install raw RGBA as its source: GJS' `cairo` module binds no pixel accessor,
// and the only introspectable Cairo⇄GdkPixbuf converters live in `Gdk-4.0`, i.e. inside
// `libgtk-4.so`, which this package must not reach. So the capability is injected — this module
// owns the contract and the registry, `@gjsify/canvas2d-core/gdk` supplies the implementation.
// Rationale: packages/dom/AGENTS.md § canvas2d-core.

import type Cairo from 'cairo';

/**
 * A decoded, readable platform image: structurally the slice of `GdkPixbuf.Pixbuf` the core
 * consumes, declared here rather than imported from `gi://GdkPixbuf` so the core carries no GI
 * value *or* type dependency.
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
 * The Cairo ⇄ pixel-buffer interop the headless core cannot implement itself. Implementations
 * are platform code (today: GDK), registered with {@link setCanvasPixelBridge}; each method must
 * behave exactly like the GDK original it mirrors.
 */
export interface CanvasPixelBridge {
    /**
     * Read a rectangular region of a Cairo surface into a readable image handle,
     * un-premultiplying alpha (mirrors `Gdk.pixbuf_get_from_surface`). `null` when the region
     * cannot be read: out of bounds, unsupported surface format, or a zero-sized rectangle.
     */
    imageFromSurface(
        surface: Cairo.Surface,
        srcX: number,
        srcY: number,
        width: number,
        height: number,
    ): CanvasImageHandle | null;

    /**
     * Install a decoded image as the Cairo context's source pattern, its top-left corner at
     * (`x`, `y`) in user space (mirrors `Gdk.cairo_set_source_pixbuf`).
     */
    setSourceImage(cr: Cairo.Context, image: CanvasImageHandle, x: number, y: number): void;

    /**
     * Install raw, NON-premultiplied RGBA bytes (8 bits per channel, tightly packed at
     * `width * 4` bytes per row) as the Cairo context's source pattern, the buffer's top-left
     * corner at (`x`, `y`) in user space.
     */
    setSourcePixels(cr: Cairo.Context, rgba: Uint8Array, width: number, height: number, x: number, y: number): void;
}

let bridge: CanvasPixelBridge | null = null;

/**
 * Register the platform pixel bridge. Last registration wins, so an embedder can substitute its
 * own implementation (e.g. a test double).
 */
export function setCanvasPixelBridge(implementation: CanvasPixelBridge): void {
    bridge = implementation;
}

export function hasCanvasPixelBridge(): boolean {
    return bridge !== null;
}

/**
 * The registered pixel bridge. Throws rather than silently degrading to blank pixels: the caller
 * asked for a pixel operation that cannot be answered correctly without one.
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
