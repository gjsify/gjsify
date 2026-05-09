// CanvasPattern implementation backed by Cairo SurfacePattern
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/CanvasPattern

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';

import { asCairoPattern, type CairoPattern } from './cairo-types.js';
import { isPixbufImageSource, isCanvasImageSource } from './dom-types.js';

/**
 * CanvasPattern wrapping a Cairo SurfacePattern.
 */
export class CanvasPattern {
    private _pattern: CairoPattern;

    private constructor(surface: Cairo.ImageSurface, repetition: string | null) {
        const raw = new Cairo.SurfacePattern(surface);
        // setExtend is missing from the GIR types; asCairoPattern narrows.
        const pat = asCairoPattern(raw);
        if (!pat) {
            throw new TypeError(
                'CanvasPattern: cairo SurfacePattern is missing setExtend at runtime — incompatible Cairo binding',
            );
        }
        this._pattern = pat;

        // Set extend mode based on repetition
        switch (repetition) {
            case 'repeat':
            case '':
            case null:
                pat.setExtend(Cairo.Extend.REPEAT);
                break;
            case 'repeat-x':
            case 'repeat-y':
                // Cairo doesn't have separate x/y repeat — use REPEAT as approximation
                pat.setExtend(Cairo.Extend.REPEAT);
                break;
            case 'no-repeat':
                pat.setExtend(Cairo.Extend.NONE);
                break;
        }
    }

    /** Create a CanvasPattern from a supported image source. Returns null if unsupported. */
    static create(image: unknown, repetition: string | null): CanvasPattern | null {
        // HTMLImageElement (GdkPixbuf-backed)
        if (isPixbufImageSource(image)) {
            const pixbuf = image._pixbuf;
            // Create a Cairo surface from the pixbuf
            const w = pixbuf.get_width();
            const h = pixbuf.get_height();
            const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
            const ctx = new Cairo.Context(surface);
            Gdk.cairo_set_source_pixbuf(ctx, pixbuf, 0, 0);
            ctx.paint();
            ctx.$dispose();
            return new CanvasPattern(surface, repetition);
        }

        // HTMLCanvasElement with a 2D context
        if (isCanvasImageSource(image)) {
            const ctx2d = image.getContext('2d');
            if (ctx2d && typeof ctx2d._getSurface === 'function') {
                const sourceSurface = ctx2d._getSurface();
                const w = sourceSurface.getWidth();
                const h = sourceSurface.getHeight();
                const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
                const ctx = new Cairo.Context(surface);
                ctx.setSourceSurface(sourceSurface, 0, 0);
                ctx.paint();
                ctx.$dispose();
                return new CanvasPattern(surface, repetition);
            }
        }

        return null;
    }

    /** @internal Get the underlying Cairo pattern for rendering. */
    _getCairoPattern(): Cairo.SurfacePattern {
        return this._pattern as unknown as Cairo.SurfacePattern;
    }
}
