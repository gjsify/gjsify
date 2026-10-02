// <gtk-drawing-area> — a blank widget you draw on. It owns no painting of its own: it
// carries a SIZE, a CALLBACK and a resize notification, and everything you can see is
// what the callback painted.
//
// WHAT THE C ACTUALLY DOES, IN FOUR PLACES (gtkdrawingarea.c):
//
//   · `gtk_drawing_area_measure` (:210-231) returns `content_width` / `content_height`
//     as BOTH the minimum and the natural size of the matching orientation. A zero — the
//     default — means the widget has no intrinsic size on that axis at all, so the parent
//     decides; a non-zero one is a floor the parent cannot allocate below, not a fixed
//     size. `_drawing.scss` spells that pair as `width`/`min-width`.
//   · `gtk_drawing_area_size_allocate` (:233-238) does nothing but emit `::resize` with
//     the new width and height. That is the whole allocation path: no re-measure, no
//     re-layout, one signal.
//   · `gtk_drawing_area_snapshot` (:240-267) returns early WITHOUT calling the draw
//     function when none is set, appends a cairo region the size of the allocation and
//     calls it with `width`/`height` from the allocation, not from the properties.
//   · `gtk_drawing_area_set_draw_func` (:474-491) runs the previous `destroy` notifier,
//     stores the triple and calls `gtk_widget_queue_draw`, so installing a function
//     repaints. `set_draw_func(NULL)` is therefore a documented way to blank the widget.
//
// THE CALLBACK. GTK's is `(area, cr, width, height, user_data)`. The `user_data` /
// `destroy` pair is what this renderer has no use for — a JS closure holds its own
// captures and the garbage collector is the notifier — so the browser signature drops
// both and the element keeps the first four in the C's order. Replacing a function is a
// plain assignment; there is no second copy to leak, which is the only thing the
// `destroy` notifier is for.
//
// LOGICAL PIXELS, ONCE. The cairo region GTK hands the callback is in the widget's LOGICAL
// size (`:248-262` — the allocation, unscaled), and GTK scales the surface at composite
// time. A `<canvas>` is a PIXEL buffer whose `width`/`height` attributes are its backing
// store, so the element multiplies that by the device pixel ratio and scales the 2D
// context by the same factor before calling in. The callback still draws in logical
// pixels, which is the property an application port depends on.
//
// EACH FRAME STARTS EMPTY. GTK's renderer builds every frame into a fresh surface, so a
// draw function that paints a background covers what was there; a canvas keeps its pixels
// between frames, so the element clears the allocation before calling in. Without that a
// second frame would composite over the first — the one difference a naive port shows and
// the reason this is written down rather than left to the reader.
//
// A11Y: no role, and none invented. GtkDrawingArea is a blank widget with no accessible
// role of its own, so naming one would add an interface GTK does not have. A drawing
// area that shows text owes the screen reader a label from the application, which an
// ordinary `aria-label` on the element already does.
//
// Events: `resize` (CustomEvent, bubbles, detail `{ width, height }` — GtkDrawingArea's
// own signal, gtkdrawingarea.c:311-328) on the first allocation and every change of one,
// and `notify::<prop>` (CustomEvent, bubbles, detail `{ <prop>: value }`) on a real change.
//
// Reference: refs/gtk/gtk/gtkdrawingarea.c
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { glibClamp } from '@gjsify/adwaita-core';

/**
 * `GtkDrawingAreaDrawFunc` with the `user_data` / `destroy` pair dropped — see the header.
 *
 * @param area the drawing area being painted, as the C's first argument
 * @param cr a 2D context over the whole allocation, in logical pixels
 * @param width the width of the allocation — NOT of `content-width`
 * @param height the height of the allocation — NOT of `content-height`
 */
export type GtkDrawingAreaDrawFunc = (
    area: GtkDrawingArea,
    cr: CanvasRenderingContext2D,
    width: number,
    height: number,
) => void;

/** `G_MAXINT`, the top of `g_param_spec_int`'s range (:288-304). */
const MAX_INT = 2147483647;

/** A missing or unparseable attribute is `0`, which is also the GIR default. */
function intAttribute(element: HTMLElement, name: string): number {
    const raw = Number.parseInt(element.getAttribute(name) ?? '', 10);
    return Number.isFinite(raw) ? raw : 0;
}

export class GtkDrawingArea extends HTMLElement {
    private _canvas!: HTMLCanvasElement;
    private _context: CanvasRenderingContext2D | null = null;
    private _initialized = false;
    private _drawFunc: GtkDrawingAreaDrawFunc | null = null;
    /** The last allocation the draw function was called with, as `::resize` sees it. */
    private _width = -1;
    private _height = -1;
    /** The last device pixel ratio the backing store was built for. */
    private _scale = 1;
    private _resize: ResizeObserver | null = null;

    static get observedAttributes() {
        return ['content-width', 'content-height'];
    }

    /** `Gtk.DrawingArea:content-width` — the minimum AND natural width. Defaults to 0. */
    get contentWidth(): number {
        return intAttribute(this, 'content-width');
    }

    set contentWidth(v: number) {
        // The pspec range is 0…G_MAXINT (:290-294), so a write outside it is clamped
        // rather than refused — which is what `set_property` does with the value.
        this._write('content-width', String(glibClamp(Math.trunc(v) || 0, 0, MAX_INT)));
    }

    /** `Gtk.DrawingArea:content-height` — the minimum AND natural height. Defaults to 0. */
    get contentHeight(): number {
        return intAttribute(this, 'content-height');
    }

    set contentHeight(v: number) {
        this._write('content-height', String(glibClamp(Math.trunc(v) || 0, 0, MAX_INT)));
    }

    /**
     * Every GObject setter here returns early when the value is already right
     * (gtkdrawingarea.c:373, :423), while `setAttribute` runs the reaction for a write
     * that changes nothing — so the guard that makes "notify only on a real change" true
     * for the numeric half is the same one `<gtk-level-bar>` uses.
     */
    private _write(name: string, value: string): void {
        if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    /** `GtkDrawingAreaDrawFunc`, or `null` — GTK's default, which paints nothing (:251). */
    get drawFunc(): GtkDrawingAreaDrawFunc | null {
        return this._drawFunc;
    }

    set drawFunc(fn: GtkDrawingAreaDrawFunc | null) {
        this.setDrawFunc(fn);
    }

    /**
     * `gtk_drawing_area_set_draw_func` (gtkdrawingarea.c:474-491): store the function and
     * `queue_draw`, which is what repaints. Passing `null` clears it, and the next
     * snapshot leaves the widget blank — the C's early return at :251.
     */
    setDrawFunc(fn: GtkDrawingAreaDrawFunc | null): void {
        this._drawFunc = fn;
        this.queueDraw();
    }

    /**
     * `gtk_widget_queue_draw` on this widget: the documented way to ask for the draw
     * function to be called again (gtkdrawingarea.c:127-129). GTK coalesces the request
     * into the next frame; here the draw is immediate, because a 2D canvas is drawn on
     * demand and there is no frame clock to wait for.
     */
    queueDraw(): void {
        if (!this._initialized) return;
        this._draw();
    }

    connectedCallback() {
        if (this._initialized) {
            // The teardown below released the observer on the way out, so a re-parent has
            // to arm it again — see `scripts/check-adwaita-connect-rebind.mjs`.
            this._observe();
            return;
        }
        this._initialized = true;

        this._canvas = document.createElement('canvas');
        this._canvas.className = 'adw-drawing-area-canvas';
        this._context = this._canvas.getContext('2d');
        this.replaceChildren(this._canvas);
        this._publishSize();
        this._observe();
    }

    disconnectedCallback() {
        this._resize?.disconnect();
        this._resize = null;
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        // A size property is a REQUEST, not a repaint: it changes the element's own box,
        // the observer hears the allocation that follows, and the paint is redone then.
        // `notify` fires either way, and the custom property the partial reads is
        // republished first so the CSS floor moves with the property.
        if (name === 'content-width' || name === 'content-height') this._publishSize();
        this._notify(name);
        if (name === 'content-width' || name === 'content-height') this._draw();
    }

    /**
     * `measure` returns one number per axis as the minimum AND the natural size
     * (gtkdrawingarea.c:210-231), and CSS has a property for each half — so the element
     * publishes the number once and `_drawing.scss` reads it twice. A zero removes the
     * property rather than declaring `0px`, because `var(--adw-drawing-width, auto)` is
     * how "no intrinsic size" is spelled.
     */
    private _publishSize(): void {
        const size: [string, number][] = [
            ['--adw-drawing-width', this.contentWidth],
            ['--adw-drawing-height', this.contentHeight],
        ];
        for (const [property, value] of size) {
            if (value > 0) this.style.setProperty(property, `${value}px`);
            else this.style.removeProperty(property);
        }
    }

    private _observe(): void {
        if (this._resize) return;
        // ResizeObserver delivers an initial observation on observe(), so the first draw
        // lands without a separate seeding pass — the `::resize` signal GTK emits "once
        // when the widget is realized" (:312-313).
        this._resize = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const box = entry.borderBoxSize?.[0];
                this._allocated(
                    box ? box.inlineSize : entry.contentRect.width,
                    box ? box.blockSize : entry.contentRect.height,
                );
            }
        });
        this._resize.observe(this);
    }

    /**
     * `gtk_drawing_area_size_allocate` (:233-238) emits `::resize` and does nothing else —
     * the signal IS the allocation path. The browser learns the allocation from the
     * observer instead, so the signal is emitted from here, and only when the allocation
     * really changed: GTK reaches `size_allocate` on every layout pass, and the signal
     * is documented as firing "each time the widget is changed" (:312-314).
     */
    private _allocated(width: number, height: number): void {
        const changed = width !== this._width || height !== this._height;
        this._width = width;
        this._height = height;
        if (changed) {
            this.dispatchEvent(new CustomEvent('resize', { bubbles: true, detail: { width, height } }));
        }
        this._draw();
    }

    /**
     * One frame. `gtk_drawing_area_snapshot` (:240-267) measures the ALLOCATION, not the
     * properties, and calls the function with it; the browser gets the allocation from the
     * observer instead of from the snapshot, and the drawing itself is the 2D context the
     * canvas already owns.
     */
    private _draw(): void {
        if (!this._canvas || this._width < 0) return;
        const width = this._width;
        const height = this._height;
        // The cairo region is the allocation unscaled (:248-262); the backing store is the
        // same size in device pixels, and the context carries the ratio.
        const scale = this._devicePixelRatio();
        const pixelWidth = Math.round(width * scale);
        const pixelHeight = Math.round(height * scale);
        if (this._canvas.width !== pixelWidth) this._canvas.width = pixelWidth;
        if (this._canvas.height !== pixelHeight) this._canvas.height = pixelHeight;
        this._scale = scale;

        const context = this._context;
        if (!context) return;
        // `setTransform` rather than `scale`, so a second frame does not compound the ratio.
        context.setTransform(scale, 0, 0, scale, 0, 0);
        // A fresh surface per frame, as GTK's renderer gives the callback.
        context.clearRect(0, 0, width, height);

        if (this._drawFunc) this._drawFunc(this, context, width, height);
    }

    /** The backing store is rebuilt when the display's ratio changes, not every frame. */
    private _devicePixelRatio(): number {
        return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    }

    /** The `notify::` detail for `name`: the PROPERTY, parsed, not the raw attribute. */
    private _notify(name: string): void {
        const value = name === 'content-width' ? this.contentWidth : this.contentHeight;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: value } }));
    }

    /** The last allocation, as `::resize` reported it — the spec reads it back. */
    get allocation(): { width: number; height: number } {
        return { width: this._width, height: this._height };
    }

    /** The ratio the backing store was built at, as the header describes. */
    get pixelScale(): number {
        return this._scale;
    }
}
customElements.define('gtk-drawing-area', GtkDrawingArea);
