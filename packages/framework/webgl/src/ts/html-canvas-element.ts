// The DOM-spec HTMLCanvasElement from @gjsify/dom-elements, backed by a Gtk.GLArea.

import { HTMLCanvasElement as BaseHTMLCanvasElement } from '@gjsify/dom-elements';
import type Gtk from 'gi://Gtk?version=4.0';
// The circular import is intentional and safe in ESM: these classes are only used at
// runtime, never at link time.
import { WebGLRenderingContext as OurWebGLRenderingContext } from './webgl-rendering-context.js';
import { WebGL2RenderingContext as OurWebGL2RenderingContext } from './webgl2-rendering-context.js';

/**
 * The REAL device-pixels-per-logical-pixel of a widget: the surface's fractional scale
 * (1.25, 1.5) where GTK reports one, else the integer `get_scale_factor()`.
 *
 * `get_scale_factor()` is `ceil(scale)` — GTK sizes the GLArea framebuffer with it, so
 * at 125 % it is 2 while the display shows 1.25. `0` / missing means no surface yet.
 */
export function deviceScale(widget: Gtk.Widget): number {
    const surfaceScale = widget.get_native?.()?.get_surface?.()?.get_scale?.();
    if (typeof surfaceScale === 'number' && surfaceScale > 0) return surfaceScale;
    return widget.get_scale_factor() || 1;
}

/**
 * Logical shift that lands a device-space coordinate on a whole device pixel.
 *
 * `position` is where an edge sits in the surface in LOGICAL px. A widget's logical
 * origin is an integer, but its device origin is `origin × scale`, which is fractional at
 * 125 % and 150 % (a 3 px margin is 4.5 device px at 1.5). GSK draws the GL texture at
 * that fractional spot with a linear filter, so every texel edge is blended with its
 * neighbour: a 1-texel checkerboard comes out grey, and pixel art loses its edges.
 * Shifting the draw by this amount puts the texel grid back on the device grid.
 */
export function snapToDevicePixel(position: number, scale: number): number {
    if (!(scale > 0)) return 0;
    const device = position * scale;
    return (Math.round(device) - device) / scale;
}

export class HTMLCanvasElement extends BaseHTMLCanvasElement {
    _webgl?: OurWebGLRenderingContext;
    _webgl2?: OurWebGL2RenderingContext;

    constructor(readonly gtkGlArea: Gtk.GLArea) {
        super();
    }

    /**
     * DRAWING-BUFFER width, in DEVICE pixels (overrides the DOM attr-backed getter).
     *
     * GtkGLArea's framebuffer is `allocation × scale-factor` and the GL viewport is raw
     * device pixels: GTK does NOT apply the surface scale to GL the way it silently
     * pre-scales a Cairo context for `Gtk.DrawingArea`. A viewport computed from the
     * ALLOCATION therefore covers the bottom-left ninth at scale 3 and the rest stays at
     * the clear colour — measured on a OnePlus 6T (postmarketOS, 1080×2340 at scale 3),
     * where the three.js teapot rendered into a 120×218 corner of a 360×655 widget.
     *
     * Device pixels are also what the browser contract means by `canvas.width` (the
     * drawing buffer). CSS layout size stays logical in `clientWidth`/`offsetWidth`, so a
     * consumer multiplying a layout size by `devicePixelRatio` lands on this number.
     */
    override get width(): number {
        return Math.round(this.gtkGlArea.get_allocated_width() * this.scaleFactor);
    }

    override set width(_width: number) {
        /* GTK manages size */
    }

    /** DRAWING-BUFFER height, in DEVICE pixels. See `width` for why it is scaled. */
    override get height(): number {
        return Math.round(this.gtkGlArea.get_allocated_height() * this.scaleFactor);
    }

    override set height(_height: number) {
        /* GTK manages size */
    }

    /**
     * The widget's surface scale factor. Read live rather than cached: moving a window
     * between monitors changes it, and GTK re-allocates the widget rather than recreating
     * the canvas.
     */
    get scaleFactor(): number {
        return deviceScale(this.gtkGlArea);
    }

    /** CSS layout width — the GTK allocation, in LOGICAL pixels. */
    get clientWidth(): number {
        return this.gtkGlArea.get_allocated_width();
    }

    /** CSS layout height — the GTK allocation, in LOGICAL pixels. */
    get clientHeight(): number {
        return this.gtkGlArea.get_allocated_height();
    }

    /** CSS layout width — same as `clientWidth` for a border-less canvas. */
    get offsetWidth(): number {
        return this.clientWidth;
    }

    /** CSS layout height — same as `clientHeight` for a border-less canvas. */
    get offsetHeight(): number {
        return this.clientHeight;
    }

    /** Returns the underlying Gtk.GLArea. Used by WebGLRenderingContext for GLSL version detection. */
    getGlArea(): Gtk.GLArea {
        return this.gtkGlArea;
    }

    /**
     * A copy of this canvas is a PLAIN, widget-less one.
     *
     * There is one `Gtk.GLArea` and it stays with the original, so a clone cannot be
     * GLArea-backed: the default `new this.constructor()` produced one with
     * `gtkGlArea === undefined` and the first `width` read threw. That is how Excalibur
     * switches renderers (`cloneNode(false)` → `replaceChild` → `getContext('2d')`), so
     * the whole fallback died at the clone instead of degrading (gjsify#1107).
     *
     * A detached canvas is also what a browser hands back: same size, blank bitmap, no
     * context. The DOM base class gives exactly that, including a WRITABLE
     * `width`/`height` — the overrides above ignore writes because GTK owns the widget's
     * size, and a clone has no widget to own it.
     */
    protected override _createCloneTarget(): BaseHTMLCanvasElement {
        const clone = new BaseHTMLCanvasElement();
        clone.width = this.width;
        clone.height = this.height;
        return clone;
    }

    /**
     * A WebGL context backed by the underlying Gtk.GLArea: 'webgl' and
     * 'experimental-webgl' give WebGL 1.0, 'webgl2' gives WebGL 2.0, anything else falls
     * through to the base class's context-factory registry.
     */
    override getContext(contextId: string, options?: unknown): unknown {
        if (contextId === 'webgl' || contextId === 'experimental-webgl') {
            if (!this._webgl) {
                // Native Gwebgl construction reads OpenGL state from the CURRENTLY BOUND
                // context, and a getContext() called outside a render signal (app code
                // during init) has none — hence the explicit make_current().
                this.gtkGlArea.make_current();
                this._webgl = new OurWebGLRenderingContext(this as unknown as HTMLCanvasElement, options);
            }
            return this._webgl;
        }
        if (contextId === 'webgl2') {
            if (!this._webgl2) {
                this.gtkGlArea.make_current();
                this._webgl2 = new OurWebGL2RenderingContext(this as unknown as HTMLCanvasElement, options);
            }
            return this._webgl2;
        }
        // '2d' and friends live in the base class's factory registry.
        return super.getContext(contextId, options);
    }
}
