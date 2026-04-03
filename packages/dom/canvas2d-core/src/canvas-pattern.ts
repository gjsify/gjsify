// CanvasPattern implementation backed by Cairo SurfacePattern
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/CanvasPattern

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';

/**
 * CanvasPattern wrapping a Cairo SurfacePattern.
 */
export class CanvasPattern {
    private _pattern: Cairo.SurfacePattern;

    private constructor(surface: Cairo.ImageSurface, repetition: string | null) {
        this._pattern = new Cairo.SurfacePattern(surface);

        // Set extend mode based on repetition
        // setExtend exists at runtime on SurfacePattern but is missing from GIR types
        const pat = this._pattern as any;
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
    static create(image: any, repetition: string | null): CanvasPattern | null {
        // HTMLImageElement (GdkPixbuf-backed)
        if ('isPixbuf' in image && typeof (image as any).isPixbuf === 'function' && (image as any).isPixbuf()) {
            const pixbuf = (image as any)._pixbuf as import('@girs/gdkpixbuf-2.0').default.Pixbuf;
            // Create a Cairo surface from the pixbuf
            const w = pixbuf.get_width();
            const h = pixbuf.get_height();
            const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
            const ctx = new Cairo.Context(surface);
            Gdk.cairo_set_source_pixbuf(ctx as any, pixbuf, 0, 0);
            ctx.paint();
            ctx.$dispose();
            return new CanvasPattern(surface, repetition);
        }

        // HTMLCanvasElement with a 2D context
        if (typeof image?.getContext === 'function') {
            const ctx2d = image.getContext('2d');
            if (ctx2d && typeof ctx2d._getSurface === 'function') {
                const sourceSurface = ctx2d._getSurface() as Cairo.ImageSurface;
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
        return this._pattern;
    }
}
