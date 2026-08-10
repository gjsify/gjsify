// GTK-backed HTMLCanvasElement for GJS — original implementation using Gtk.GLArea
// Extends the DOM-spec base from @gjsify/dom-elements with GTK.GLArea integration.

import { HTMLCanvasElement as BaseHTMLCanvasElement } from '@gjsify/dom-elements';
import type Gtk from 'gi://Gtk?version=4.0';
// Circular import is intentional and safe in ESM (classes are only used at runtime, not at link time)
import { WebGLRenderingContext as OurWebGLRenderingContext } from './webgl-rendering-context.js';
import { WebGL2RenderingContext as OurWebGL2RenderingContext } from './webgl2-rendering-context.js';

export class HTMLCanvasElement extends BaseHTMLCanvasElement {
    _webgl?: OurWebGLRenderingContext;
    _webgl2?: OurWebGL2RenderingContext;

    constructor(readonly gtkGlArea: Gtk.GLArea) {
        super();
    }

    /**
     * DRAWING-BUFFER width, in DEVICE pixels (overrides the DOM attr-backed getter).
     *
     * GtkGLArea's framebuffer is `allocation × scale-factor`, and the GL viewport
     * is raw device pixels — GTK does NOT apply the surface scale to GL the way
     * it silently pre-scales a Cairo context for `Gtk.DrawingArea`. So on a
     * scale-factor-3 display (a phone) a viewport computed from the ALLOCATION
     * covers the bottom-left ninth of the framebuffer and the rest stays at the
     * clear colour. Measured on a OnePlus 6T / postmarketOS, GNOME Mobile,
     * 1080×2340 at scale 3: the three.js teapot and the Excalibur game each
     * rendered into a 120×218 corner of a 360×655-logical widget.
     *
     * Reporting device pixels here is also what the browser contract means by
     * `canvas.width` — the drawing buffer, which is exactly what
     * `WebGLRenderingContextBase.drawingBufferWidth` re-exports. CSS layout size
     * stays logical (`clientWidth`/`offsetWidth` below), so a consumer that
     * multiplies a layout size by `devicePixelRatio` (`installGlobals()` exposes
     * the live scale factor) lands on the same number.
     */
    override get width(): number {
        return this.gtkGlArea.get_allocated_width() * this.scaleFactor;
    }

    override set width(_width: number) {
        /* GTK manages size */
    }

    /** DRAWING-BUFFER height, in DEVICE pixels. See `width` for why it is scaled. */
    override get height(): number {
        return this.gtkGlArea.get_allocated_height() * this.scaleFactor;
    }

    override set height(_height: number) {
        /* GTK manages size */
    }

    /**
     * The widget's surface scale factor (1 on a standard display, 2–3 on HiDPI).
     * Read live rather than cached: moving a window between monitors changes it,
     * and GTK re-allocates the widget rather than recreating the canvas.
     */
    get scaleFactor(): number {
        // `get_scale_factor()` returns 0 for a widget with no surface yet (it is
        // read during the init render, so this is defensive rather than hot).
        return this.gtkGlArea.get_scale_factor() || 1;
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
     * There is exactly one `Gtk.GLArea` and it stays with the original, so a
     * clone cannot be GLArea-backed: the default `new this.constructor()` built
     * one with `gtkGlArea === undefined`, and the first `width` read threw. That
     * is not a hypothetical — it is how Excalibur switches renderers
     * (`canvas.cloneNode(false)` → `replaceChild` → `getContext('2d')`), so the
     * whole fallback died at the clone rather than degrading (gjsify#1107).
     *
     * A detached canvas is also what a browser hands back: same size, blank
     * bitmap, no context, not presented by anything. Dropping to the DOM base
     * class gives precisely that, including a writable `width`/`height` — the
     * overrides above deliberately ignore writes because GTK owns the widget's
     * size, and a clone has no widget to own it.
     */
    protected override _createCloneTarget(): BaseHTMLCanvasElement {
        const clone = new BaseHTMLCanvasElement();
        clone.width = this.width;
        clone.height = this.height;
        return clone;
    }

    /**
     * Returns a WebGL rendering context backed by the underlying Gtk.GLArea.
     * 'webgl' and 'experimental-webgl' return a WebGLRenderingContext (WebGL 1.0).
     * 'webgl2' returns a WebGL2RenderingContext (WebGL 2.0).
     * Other context types emit a warning and return null.
     */
    override getContext(contextId: string, options?: unknown): unknown {
        if (contextId === 'webgl' || contextId === 'experimental-webgl') {
            if (!this._webgl) {
                // Native Gwebgl context construction reads OpenGL state from
                // the currently bound context. If getContext() is called outside
                // of a GLArea render signal (e.g. from app code during init),
                // the widget's GL context may not be current — make it current
                // explicitly before instantiating.
                this.gtkGlArea.make_current();
                // GTK-backed canvas is structurally compatible with the spec
                // HTMLCanvasElement that the rendering context expects.
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
        // Fall through to the base class context factory registry
        // (e.g. @gjsify/canvas2d registers '2d' there)
        return super.getContext(contextId, options);
    }
}
