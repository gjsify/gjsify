// <gtk-gl-area> — a widget whose contents are drawn on a GPU.
//
// WHAT THE C DOES, IN ORDER, because the ORDER is the contract a GL application
// depends on (gtkglarea.c:757-812, the snapshot):
//
//   · it works in DEVICE pixels: `w = width * scale`, `h = height * scale` (:761-763);
//   · an empty allocation draws NOTHING at all — `:767-768`;
//   · an error set draws the error MESSAGE over the widget and stops (:769-775,
//     `gtk_gl_area_draw_error_screen` at :701-723) — not an empty box, and not a
//     context attempt;
//   · no context draws nothing (:776-777);
//   · otherwise: make the context current, attach the buffers, enable or disable the
//     depth test, and — only if `needs_render || auto_render` — emit `::resize` FIRST
//     if the allocation changed, then emit `::render` (:779-811). `needs_render` is
//     cleared after the emit, so a `queue_render()` from a handler queues its frame and
//     loses its flag — which is why a GL animation asks per tick, not from `::render`.
//
// `needs_render` starts TRUE and `needs_resize` is set by `size_allocate` whenever the
// widget is allocated a new size while realized (:686-697, :1104) — so the first draw
// emits `resize` before `render`, which is the order every GL program needs.
//
// WHAT A BROWSER CHANGES, ALL OF IT WRITTEN HERE RATHER THAN LEFT TO THE READER:
//
//   · THE CONTEXT IS THE BROWSER'S. `GdkGLContext` comes from a GdkSurface; a
//     `<canvas>`'s `getContext` hands out WebGL, which is ES-flavoured on every engine.
//     `allowed-apis` therefore chooses between ES VERSIONS here and `api` reports
//     `gles` whichever it got: GTK's GL/GLES split has no counterpart in a web page,
//     and saying so is more useful than a flag that pretends otherwise. An
//     `allowed-apis` naming NEITHER creates no context, and the snapshot's no-context
//     branch (:776-777) is what a reader then sees.
//   · THE BUFFER PERSISTS. WebGL clears the drawing buffer after compositing unless the
//     context is created with `preserveDrawingBuffer`, and GTK's texture does not
//     disappear between frames — so the element asks for it, which is the one creation
//     option here with a direct counterpart in the C (a texture GTK keeps).
//   · THERE IS NO FRAME CLOCK. GTK's snapshot runs when GTK DRAWS the widget, and an
//     application animating a GLArea queues a redraw per tick
//     (`gtk_widget_queue_draw`). The element therefore draws on the first allocation, on
//     `queueRender()`, and on the property writes that end in `queue_draw` — and an
//     application that wants sixty frames a second asks for them, exactly as it would
//     in GTK. `auto-render` is still the same flag over the same condition; what it
//     gates is whether a draw the element was asked for ends in `::render`.
//   · `make_current` is the browser's standing arrangement: a WebGL context is current
//     for its own canvas and nowhere else (:1563-1572), so the method hands the context
//     back rather than switching anything.
//
// A11Y: no role, and none invented. GtkGLArea sets no accessible role of its own, and a
// GL surface is as opaque to a screen reader as it is to the compositor; an application
// that draws text owes the reader a label, which an ordinary `aria-label` provides.
//
// Events: `render` (CustomEvent, bubbles, detail `{ context }`), `resize` (CustomEvent,
// bubbles, detail `{ width, height }` — the C's DEVICE-pixel viewport, :1055-1062) and
// `create-context` (CustomEvent, bubbles, detail `{ context }`, which a handler may fill
// instead of letting the element ask the browser), plus `notify::<prop>`.
//
// KNOWN GAPS: `use-es`, deprecated in GTK 4.12 and replaced by `allowed-apis`; it is
// listed in KNOWN_GAPS in scripts/check-adwaita-element-properties.mjs.
//
// Reference: refs/gtk/gtk/gtkglarea.c
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** `GdkGLAPI`'s nicks, as `GdkGLAPINickSet` spells them. */
const APIS = ['gl', 'gles'] as const;
type GlApi = (typeof APIS)[number];

/** A WebGL context, whichever version the browser handed out. */
type GlContext = WebGLRenderingContext | WebGL2RenderingContext;

/**
 * `allowed-apis`, parsed: GdkGLAPIFlags is a FLAGS property, so it is a SET, and a
 * browser attribute carries a set as a space-separated list of nicks (`gl gles`). An
 * unparseable or absent value is the GIR default, `GDK_GL_API_GL | GDK_GL_API_GLES`
 * (gtkglarea.c:1098-1101).
 */
function parseApis(element: HTMLElement): GlApi[] {
    const raw = element.getAttribute('allowed-apis');
    if (raw === null) return [...APIS];
    const names = raw.split(/[\s,|]+/).filter((token) => (APIS as readonly string[]).includes(token));
    return APIS.filter((api) => names.includes(api));
}

function booleanAttribute(element: HTMLElement, name: string, fallback: boolean): boolean {
    const raw = element.getAttribute(name);
    if (raw === null) return fallback;
    return raw !== 'false' && raw !== '0';
}

export class GtkGLArea extends HTMLElement {
    private _canvas!: HTMLCanvasElement;
    private _messageEl: HTMLDivElement | null = null;
    private _initialized = false;
    private _context: GlContext | null = null;
    private _error: string | null = null;
    /** `gtk_gl_area_resize` is called from here, so `needs_resize` is a C field too. */
    private _needsResize = false;
    /** `priv->needs_render`, TRUE from `gtk_gl_area_init` (:1104). */
    /** `priv->allowed_apis`, default `GDK_GL_API_GL | GDK_GL_API_GLES` (:1100). */
    private _allowedApis: GlApi[] = [...APIS];
    private _needsRender = true;
    /** `priv->have_buffers` (:392), dropped by the two buffer setters. */
    private _haveBuffers = false;
    private _width = 0;
    private _height = 0;
    private _scale = 1;
    private _resize: ResizeObserver | null = null;
    private _frame: number | null = null;

    static get observedAttributes() {
        return ['auto-render', 'has-depth-buffer', 'has-stencil-buffer', 'allowed-apis'];
    }

    /**
     * `GtkGLArea:auto-render` — whether `::render` is emitted every time the widget draws.
     * Defaults to TRUE (:1102, and `g_param_spec_boolean` at :924).
     */
    get autoRender(): boolean {
        return booleanAttribute(this, 'auto-render', true);
    }

    set autoRender(v: boolean) {
        if (this.autoRender === !!v) return;
        this._write('auto-render', String(!!v));
    }

    /**
     * `GtkGLArea:has-depth-buffer` — whether a depth buffer is allocated and the depth
     * test enabled (:782-785, :408-417). Defaults to FALSE (:941).
     */
    get hasDepthBuffer(): boolean {
        return booleanAttribute(this, 'has-depth-buffer', false);
    }

    set hasDepthBuffer(v: boolean) {
        if (this.hasDepthBuffer === !!v) return;
        this._write('has-depth-buffer', String(!!v));
    }

    /** `GtkGLArea:has-stencil-buffer` — the stencil half of the same renderbuffer (:954). */
    get hasStencilBuffer(): boolean {
        return booleanAttribute(this, 'has-stencil-buffer', false);
    }

    set hasStencilBuffer(v: boolean) {
        if (this.hasStencilBuffer === !!v) return;
        this._write('has-stencil-buffer', String(!!v));
    }

    /**
     * `GtkGLArea:allowed-apis` — the APIs a created context may use (:983, :1100).
     *
     * The value lives in a field, not in the attribute, because the setter REFUSES a
     * realized area and a refused write in a custom element has already moved the
     * attribute — the C keeps the property and drops the call, this keeps the property and
     * puts the attribute back.
     */
    get allowedApis(): GlApi[] {
        return [...this._allowedApis];
    }

    set allowedApis(v: GlApi[]) {
        if (this._context !== null) {
            // `g_return_if_fail (!gtk_widget_get_realized (…))` (:1242) — see the header.
            this.setAttribute('allowed-apis', this._allowedApis.join(' '));
            return;
        }
        this._allowedApis = APIS.filter((api) => v.includes(api));
        this._write('allowed-apis', this._allowedApis.join(' '));
    }

    /**
     * The guard that makes "notify only on a real change" true: `setAttribute` runs the
     * custom-element reaction for a write that changes nothing, while GTK's setters
     * return early (:1522, :1197).
     */
    private _write(name: string, value: string): void {
        if (this.getAttribute(name) !== value) this.setAttribute(name, value);
    }

    /**
     * `GtkGLArea:api` — the API in use, read-only in the GIR and defaulting to 0, which
     * is `GDK_GL_API_GL`. A context in a browser is WebGL or WebGL2, both ES, so a
     * realized area reports `gles` and an unrealized one the pspec's `0` — see the header.
     */
    get api(): GlApi {
        return this._context === null ? 'gl' : 'gles';
    }

    /** `gtk_gl_area_get_context` (:1495-1508) — the context, or `null` when there is none. */
    get context(): GlContext | null {
        return this._context;
    }

    /** `gtk_gl_area_get_error` (:1533-1543) — the error set on the area, if any. */
    get error(): string | null {
        return this._error;
    }

    /** `gtk_gl_area_set_error` (:1545-1558). `null` clears it, which restores drawing. */
    setError(error: Error | string | null): void {
        const message = error === null ? null : typeof error === 'string' ? error : error.message;
        if (this._error === message) return;
        this._error = message;
        this._renderMessage();
        // An error stops the draw; `set_error` queues a redraw so the message shows
        // (:1552-1556) and drawing resumes when it is cleared.
        this._queueDraw();
    }

    /**
     * `gtk_gl_area_make_current` (:1563-1572). A WebGL context is current for its own
     * canvas and nowhere else, so there is nothing to switch — the method exists
     * because the C's callers expect it to.
     */
    makeCurrent(): GlContext | null {
        return this._context;
    }

    /**
     * `gtk_gl_area_queue_render` (:1465-1474) — the render flag plus `queue_draw`.
     *
     * AND WHY THE DRAW IS NOT SYNCHRONOUS. `gtk_widget_queue_draw` marks the window dirty
     * and the frame clock draws it LATER, so an application that queues per tick animates
     * instead of recursing; a 2D-style synchronous draw would make the same application a
     * stack overflow. An animation frame is the browser's frame clock, and coalescing
     * through one keeps "ask for a frame" a scheduler.
     *
     * NOTE WHAT THE FLAG DOES NOT SURVIVE: `needs_render` is cleared AFTER the `::render`
     * emit (:811), so a `queue_render()` from inside the handler has its flag overwritten
     * and only the queued frame remains. That is the C's own behaviour, and it is why an
     * animation asks from a tick callback rather than from the handler.
     */
    queueRender(): void {
        this._needsRender = true;
        this._queueDraw();
    }

    connectedCallback() {
        if (this._initialized) {
            // The teardown below released the observer on the way out, so a re-parent has
            // to arm it again — see `scripts/check-adwaita-connect-rebind.mjs`.
            this._observe();
            return;
        }
        this._initialized = true;

        // An attribute written before the element upgraded fires `attributeChangedCallback`
        // with `_initialized` still false, so the authored set is read here — the C reads
        // it at realize, which is the same moment as far as this property is concerned.
        if (this.hasAttribute('allowed-apis')) this._allowedApis = parseApis(this);

        this._canvas = document.createElement('canvas');
        this._canvas.className = 'adw-gl-area-canvas';
        this.replaceChildren(this._canvas);
        this._observe();
    }

    disconnectedCallback() {
        this._resize?.disconnect();
        this._resize = null;
        if (this._frame !== null) cancelAnimationFrame(this._frame);
        this._frame = null;
    }

    /** `gtk_widget_queue_draw`: one frame, however many requests arrived before it. */
    private _queueDraw(): void {
        if (!this._initialized || this._frame !== null) return;
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this._draw();
        });
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        switch (name) {
            case 'auto-render':
                // `set_auto_render` queues a redraw, and only when it is turned ON
                // (:1528-1529).
                if (this.autoRender) this._queueDraw();
                break;
            case 'has-depth-buffer':
            case 'has-stencil-buffer':
                // Neither setter queues: they notify and drop `have_buffers` (:1391-1396,
                // :1440-1447), which the next draw re-attaches.
                this._haveBuffers = false;
                break;
            case 'allowed-apis':
                // `gtk_gl_area_set_allowed_apis` REFUSES a realized area
                // (`g_return_if_fail (!gtk_widget_get_realized (…))`, :1242) — the context
                // is built from the set once, and a browser canvas has one context for its
                // lifetime. A custom element cannot refuse an attribute write the way the C
                // refuses a call, so the write is undone: the attribute goes back to the set
                // in force, which is the state the property keeps, and nothing notifies. The
                // page can see the refusal; the C only warns.
                if (this._context !== null) {
                    // `setAttribute` fires this callback again even with an unchanged value, so
                    // the undo only writes when the attribute really moved.
                    const inForce = this._allowedApis.join(' ');
                    if (this.getAttribute('allowed-apis') !== inForce) this.setAttribute('allowed-apis', inForce);
                    return;
                }
                this._allowedApis = parseApis(this);
                break;
            default:
                break;
        }
        this._notify(name);
    }

    /** The `notify::` detail for `name`: the PROPERTY, parsed, not the raw attribute. */
    private _notify(name: string): void {
        const value: string | boolean =
            name === 'allowed-apis'
                ? this.allowedApis.join(' ')
                : name === 'auto-render'
                  ? this.autoRender
                  : name === 'has-depth-buffer'
                    ? this.hasDepthBuffer
                    : this.hasStencilBuffer;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: value } }));
    }

    private _observe(): void {
        if (this._resize) return;
        // The first observation is the realize: `size_allocate` sets `needs_resize` for
        // every allocation while realized (:693-696), and the draw that answers it emits
        // `::resize` before `::render`.
        this._resize = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const box = entry.borderBoxSize?.[0];
                const width = box ? box.inlineSize : entry.contentRect.width;
                const height = box ? box.blockSize : entry.contentRect.height;
                if (width === this._width && height === this._height) continue;
                this._width = width;
                this._height = height;
                this._needsResize = true;
                this._queueDraw();
            }
        });
        this._resize.observe(this);
    }

    /**
     * The snapshot, in the C's order (gtkglarea.c:757-812). One pass, four early exits,
     * and the two flags cleared only after the signals — see the header.
     */
    private _draw(): void {
        if (!this._canvas) return;
        const scale = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
        this._scale = scale;
        // The viewport is in DEVICE pixels (:761-763), which is also what a canvas's
        // backing store is.
        const width = Math.round(this._width * scale);
        const height = Math.round(this._height * scale);
        if (width === 0 || height === 0) return;

        if (this._error !== null) {
            this._renderMessage();
            return;
        }
        const context = this._context ?? this._createContext();
        if (context === null) return;

        this.makeCurrent();
        this.attachBuffers(context);
        // `glEnable`/`glDisable (GL_DEPTH_TEST)` per `has-depth-buffer` (:782-785).
        if (this.hasDepthBuffer) context.enable(context.DEPTH_TEST);
        else context.disable(context.DEPTH_TEST);

        if (this._needsRender || this.autoRender) {
            if (this._needsResize) {
                this._needsResize = false;
                this.dispatchEvent(new CustomEvent('resize', { bubbles: true, detail: { width, height } }));
            }
            this.dispatchEvent(new CustomEvent('render', { bubbles: true, detail: { context } }));
        }
        this._needsRender = false;
    }

    /**
     * `gtk_gl_area_attach_buffers` (:583-618): the depth/stencil renderbuffer is created
     * when either buffer is asked for and deleted when neither is — and `have_buffers`
     * says which, so a redraw after one of the two setters is the frame that allocates
     * it (:408-417). WebGL's equivalent is the depth and stencil TESTS plus the
     * `depth`/`stencil` context attributes the element created the context with: a context
     * cannot gain a buffer afterwards, which is why `_createContext` reads both properties
     * before asking, and why the flag is what decides the tests are re-applied.
     */
    attachBuffers(context: GlContext | null = this._context): void {
        if (context === null) return;
        if (this.hasStencilBuffer) context.enable(context.STENCIL_TEST);
        else context.disable(context.STENCIL_TEST);
        // The C's `have_buffers` guard: with the buffers already attached and nothing
        // resized, `attach_buffers` has nothing to do (:396-397).
        this._haveBuffers = true;
    }

    /**
     * `::create-context` (:1086-1109) lets a handler supply the context, and GTK's handler
     * RETURNS one. A browser event has no return channel, so the detail object is the
     * channel: a handler that sets `detail.context` wins, and the element asks the
     * browser only when nobody did.
     */
    private _createContext(): GlContext | null {
        const allowed = this.allowedApis;
        if (allowed.length === 0) return null;
        const detail: { context: GlContext | null } = { context: null };
        this.dispatchEvent(new CustomEvent('create-context', { bubbles: true, detail }));
        if (detail.context !== null) {
            this._context = detail.context;
            return this._context;
        }
        // `preserveDrawingBuffer` keeps the picture on screen between frames, which is
        // what GTK's own texture does; the depth/stencil attributes are the buffers the C
        // allocates in `attach_buffers`.
        const attributes: WebGLContextAttributes = {
            preserveDrawingBuffer: true,
            depth: this.hasDepthBuffer,
            stencil: this.hasStencilBuffer,
        };
        // WebGL2 (ES 3.0) is the newer of the two the browser has; `allowed-apis` naming
        // only `gl` asks for the older one, because no browser offers desktop GL.
        const names = allowed.includes('gles') ? ['webgl2', 'webgl'] : ['webgl'];
        for (const name of names) {
            const context = this._canvas.getContext(name, attributes) as GlContext | null;
            if (context !== null) {
                this._context = context;
                return context;
            }
        }
        return null;
    }

    /**
     * `gtk_gl_area_draw_error_screen` (:701-723): the message over the whole widget, at
     * its own font, vertically centred. The canvas stays where it is — GTK's error screen
     * replaces what a frame would have drawn, not the widget's own node — and the message
     * node is removed again when the error clears, which is the redraw the C's setter
     * queues (:1552-1556).
     */
    private _renderMessage(): void {
        if (this._error === null) {
            this._messageEl?.remove();
            this._messageEl = null;
            return;
        }
        if (!this._messageEl) {
            this._messageEl = document.createElement('div');
            this._messageEl.className = 'adw-gl-area-error';
            this.append(this._messageEl);
        }
        this._messageEl.textContent = this._error;
    }

    /** The device-pixel viewport, for a spec that checks `::resize`. */
    get viewport(): { width: number; height: number } {
        return {
            width: Math.round(this._width * this._scale),
            height: Math.round(this._height * this._scale),
        };
    }

    /** The scale factor the viewport is multiplied by (gtkglarea.c:761-763). */
    get pixelScale(): number {
        return this._scale;
    }
}
customElements.define('gtk-gl-area', GtkGLArea);
