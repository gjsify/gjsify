// A Gtk.GLArea subclass that carries the WebGL bootstrapping for
// HTMLCanvasElement.

import GObject from 'gi://GObject?version=2.0';
// Value import: `Gdk.GLAPI` is read at construction (see `set_allowed_apis`).
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { HTMLCanvasElement as OurHTMLCanvasElement } from './html-canvas-element.js';
// Value imports: `installGlobals()` puts both constructors on globalThis.
import { WebGLRenderingContext as OurWebGLRenderingContext } from './webgl-rendering-context.js';
import { WebGL2RenderingContext as OurWebGL2RenderingContext } from './webgl2-rendering-context.js';
import { attachEventControllers } from '@gjsify/event-bridge';
import { Event } from '@gjsify/dom-events';
import { notifyElementResize } from '@gjsify/dom-elements';
import { isSoftwareRenderer } from './software-renderer.js';

// Typed with lib.dom's `HTMLCanvasElement` so callers can hand the canvas straight to
// WebGL demos; `_canvas` is ours and is cast at the API boundary.
type WebGLReadyCallback = (canvas: globalThis.HTMLCanvasElement, gl: globalThis.WebGLRenderingContext) => void;

/**
 * A `Gtk.GLArea` subclass that negotiates the GL context, wraps it in an
 * `HTMLCanvasElement` on first render, and drives `requestAnimationFrame` off the GTK
 * frame clock.
 *
 * `installGlobals()` must run BEFORE the app code that expects the browser globals:
 * ```ts
 * const widget = new WebGLBridge();
 * widget.installGlobals();
 * widget.onReady((canvas, gl) => { … });
 * window.set_child(widget);
 * ```
 */
export const WebGLBridge = GObject.registerClass(
    { GTypeName: 'GjsifyWebGLBridge' },
    class WebGLBridge extends Gtk.GLArea {
        _canvas: OurHTMLCanvasElement | null = null;
        _readyCallbacks: WebGLReadyCallback[] = [];
        _resizeCallbacks: ((width: number, height: number) => void)[] = [];
        _renderTag: number | null = null;
        _tickCallbackId: number | null = null;
        _frameCallback: FrameRequestCallback | null = null;
        // The last fired frame callback, retained AFTER invocation so the 'render'
        // handler can replay it: a GTK-initiated repaint with no pending rAF (offscreen
        // snapshot via Gtk.WidgetPaintable, expose, occlusion change) otherwise clears
        // the GLArea FBO, and a demand-driven app (Three.js render-on-demand) draws
        // nothing into it. Cleared on an explicit cancelAnimationFrame and on unrealize.
        _lastFrameCallback: FrameRequestCallback | null = null;
        // The replay re-feeds THIS timestamp, not the current clock, so a delta-time
        // integrator sees dt≈0 instead of jumping the simulation by the idle gap.
        _lastFrameTime: number = 0;
        // While set, a self-rearming callback's `requestAnimationFrame()` is ignored, so
        // a repaint cannot resurrect a loop the app paused.
        _replaying: boolean = false;
        // Handle of the pending frame callback; `cancelAnimationFrame` matches on it
        // (see there for why). 0 makes a cancel before the first request a no-op.
        _frameCallbackId: number = 0;
        _nextFrameId: number = 1;
        // Origin for both rAF timestamps and `performance.now()`, per the browser
        // DOMHighResTimeStamp spec.
        _timeOrigin: number = GLib.get_monotonic_time();
        // Public-with-underscore like every field above: a `private` member of a
        // `GObject.registerClass` class cannot be named in the emitted declaration
        // (TS4094, exported anonymous class type).
        _rendererInfo: { vendor: string; renderer: string } | null = null;

        constructor(params?: Partial<Gtk.GLArea.ConstructorProps>) {
            super(params);
            // Allow BOTH, and let GDK pick: `set_use_es(true)` means GLES-ONLY, and
            // macOS has no GLES profile at all (CGL caps at desktop GL 4.1), so there it
            // left the GLArea permanently in error — null context, no `render` signal,
            // not one pixel drawn. Where GLES exists GDK still prefers it (measured on
            // gtk 4.22 / Wayland / Mesa: GLES 3.2, exactly what `set_use_es(true)` gave).
            //
            // It must be declared BEFORE realize — `gtk_gl_area_set_allowed_apis` asserts
            // `!gtk_widget_get_realized` — so "retry wider after a failed realize" does
            // not exist, and neither probing nor platform sniffing is an option.
            this.set_allowed_apis(Gdk.GLAPI.GL | Gdk.GLAPI.GLES);
            this.set_required_version(3, 2);
            this.set_has_depth_buffer(true);
            this.set_has_stencil_buffer(true);

            // captureKeys: consume key events, so GTK focus traversal (arrow keys) cannot
            // steal focus from the game canvas.
            attachEventControllers(this, () => this._canvas, { captureKeys: true });

            // One persistent tick callback for the widget's lifetime instead of a
            // GLib.Source per rAF, and it renders only with a callback pending, so an idle
            // loop costs no GPU wakeups.
            this._tickCallbackId = this.add_tick_callback((_widget: Gtk.Widget, _frameClock: Gdk.FrameClock) => {
                if (this._frameCallback !== null) {
                    this.queue_render();
                }
                return GLib.SOURCE_CONTINUE;
            });

            // One-shot init handler: bootstraps context + canvas, then installs the
            // persistent frame handler.
            const initId = this.connect('render', () => {
                this.disconnect(initId);
                this.make_current();
                this._canvas = new OurHTMLCanvasElement(this);
                // Attached to document.body so bubbling reaches ownerDocument, where
                // OrbitControls registers pointermove.
                {
                    const g = globalThis as unknown as { document?: { body?: { appendChild(el: unknown): void } } };
                    if (g.document?.body) {
                        g.document.body.appendChild(this._canvas);
                    }
                }
                // BOTH contexts are created inside the render signal, because that is the
                // only place `GL_FRAMEBUFFER_BINDING` reports GtkGLArea's private FBO. A
                // context built later (Excalibur 0.32 asks for 'webgl2' only) would read 0,
                // and `bindFramebuffer(null)` would then bind FBO 0 — invisible rendering.
                this._canvas.getContext('webgl2');
                const gl = this._canvas.getContext('webgl') as OurWebGLRenderingContext | null;
                if (gl) {
                    this._reportRenderer(gl);
                    for (const cb of this._readyCallbacks) {
                        cb(
                            this._canvas as unknown as globalThis.HTMLCanvasElement,
                            gl as unknown as globalThis.WebGLRenderingContext,
                        );
                    }
                    this._readyCallbacks = [];
                }

                // Persistent frame handler, installed once after canvas init.
                this._renderTag = this.connect('render', (_widget: Gtk.GLArea) => {
                    const time = (GLib.get_monotonic_time() - this._timeOrigin) / 1000;
                    if (this._frameCallback !== null) {
                        if ((globalThis as { __GJSIFY_DEBUG_RAF?: boolean }).__GJSIFY_DEBUG_RAF === true) {
                            console.log(`[rAF] frame callback fires t=${time.toFixed(1)}`);
                        }
                        const cb = this._frameCallback;
                        // Cleared BEFORE invoking, so the synchronous rAF a game loop makes
                        // from inside `cb` installs a fresh callback and a fresh ID rather
                        // than racing its own handle.
                        this._frameCallback = null;
                        this._frameCallbackId = 0;
                        // Retained for replay on GTK-initiated repaints (see below).
                        this._lastFrameCallback = cb;
                        this._lastFrameTime = time;
                        cb(time);
                    } else if (this._lastFrameCallback !== null) {
                        // GTK asked for a repaint with no app frame pending (snapshot,
                        // expose, occlusion change): re-present the last frame so the FBO is
                        // not blank. Must stay SIDE-EFFECT-FREE — hence the retained
                        // timestamp and `_replaying`. A running loop never gets here, it
                        // always has a pending callback.
                        this._replaying = true;
                        try {
                            this._lastFrameCallback(this._lastFrameTime);
                        } finally {
                            this._replaying = false;
                        }
                    }
                    return true;
                });

                return true;
            });

            // A resize re-arms a rAF because `queue_render()` triggers the GTK render
            // signal WITHOUT re-running the application's render logic, which would leave
            // a demand-driven app showing a black frame.
            //
            // The GObject signal, `onResize()`, the DOM 'resize' event and ResizeObserver
            // are all fed here. `notifyElementResize()` walks the ancestor chain, because
            // Excalibur 0.32's DisplayMode.FillContainer observes `canvas.parentElement`
            // rather than the canvas and would otherwise never see a GTK allocation change.
            this.connect('resize', () => {
                const width = this.get_allocated_width();
                const height = this.get_allocated_height();
                if (this._canvas) {
                    this._canvas.dispatchEvent(new Event('resize'));
                    notifyElementResize(this._canvas, width, height);
                }
                for (const cb of this._resizeCallbacks) {
                    cb(width, height);
                }
                if (this._frameCallback) {
                    this.requestAnimationFrame(this._frameCallback);
                }
            });

            this.connect('unrealize', () => {
                if (this._renderTag !== null) {
                    this.disconnect(this._renderTag);
                    this._renderTag = null;
                }
                if (this._tickCallbackId !== null) {
                    this.remove_tick_callback(this._tickCallbackId);
                    this._tickCallbackId = null;
                }
                this._frameCallback = null;
                this._lastFrameCallback = null;
                this._lastFrameTime = 0;
                this._replaying = false;
                this._canvas = null;
            });
        }

        /** The HTMLCanvasElement wrapping this GLArea. Available after the first render. */
        get canvas(): globalThis.HTMLCanvasElement | null {
            return this._canvas as unknown as globalThis.HTMLCanvasElement | null;
        }

        /**
         * The GL implementation GDK negotiated, unmasked, straight from `glGetString`;
         * `null` until the context exists.
         *
         * For REPORTING, not as a capability check: a CPU rasteriser draws everything a
         * GPU does, only slower, and by how much depends on the workload. Anything that
         * switches renderers should key on a measured frame budget, not on this string.
         */
        get rendererInfo(): { vendor: string; renderer: string } | null {
            return this._rendererInfo;
        }

        /** Runs `cb` once the WebGL context is ready — synchronously if it already is. */
        onReady(cb: WebGLReadyCallback): void {
            if (this._canvas) {
                const gl = this._canvas.getContext('webgl') as OurWebGLRenderingContext | null;
                if (gl) {
                    cb(
                        this._canvas as unknown as globalThis.HTMLCanvasElement,
                        gl as unknown as globalThis.WebGLRenderingContext,
                    );
                    return;
                }
            }
            this._readyCallbacks.push(cb);
        }

        /**
         * @deprecated Use `onReady()` instead.
         */
        onWebGLReady(cb: WebGLReadyCallback): void {
            this.onReady(cb);
        }

        /**
         * Records the negotiated GL implementation and, when it rasterises on the CPU,
         * says so ONCE on stderr.
         *
         * A GPU-less host is otherwise invisible from inside the app: the context is
         * created, every draw call succeeds, and the only tell is a frame budget blown by
         * three orders of magnitude, which presents as a window that just sits there.
         *
         * Diagnostic only, and deliberately changes no behaviour: a software renderer is
         * fine for plenty of workloads. Measured on one GPU-less macOS host, a
         * demand-driven three.js scene ran comfortably on the same driver that needed
         * 1.1 s for a single textured full-screen draw in a 2D game.
         */
        _reportRenderer(gl: OurWebGLRenderingContext): void {
            const ext = gl.getExtension('WEBGL_debug_renderer_info') as {
                UNMASKED_VENDOR_WEBGL: number;
                UNMASKED_RENDERER_WEBGL: number;
            };
            const vendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? '');
            const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
            this._rendererInfo = { vendor, renderer };

            if (isSoftwareRenderer(renderer)) {
                console.warn(
                    `[@gjsify/webgl] GL is rasterised on the CPU by "${renderer}" (${vendor}) — this host ` +
                        `exposes no usable GPU. Every draw call still works; fill-heavy or continuously ` +
                        `animating content will be orders of magnitude slower than on hardware, which can ` +
                        `look like a frozen window rather than a slow one. Read it yourself via ` +
                        `WebGLBridge.rendererInfo or the WEBGL_debug_renderer_info extension.`,
                );
            }
        }

        /**
         * Runs `cb` on every GTK resize, after the DOM 'resize' event has been dispatched
         * on the canvas. Canvas buffer dimensions are NOT updated for you: set
         * `canvas.width`/`canvas.height` yourself if the drawing buffer must follow.
         */
        onResize(cb: (width: number, height: number) => void): void {
            this._resizeCallbacks.push(cb);
        }

        /**
         * Browser `requestAnimationFrame`, driven by the vsync-synced GTK frame clock.
         *
         * SINGLE SLOT: a second call before the first has fired REPLACES the pending
         * callback (latest wins), which makes the older handle stale and a
         * `cancelAnimationFrame` with it a no-op.
         */
        requestAnimationFrame(cb: FrameRequestCallback): number {
            const id = this._nextFrameId++;
            // A frame requested from inside a replay is the retained callback re-arming
            // its own loop; the repaint must stay side-effect-free, so hand back a handle
            // and schedule nothing.
            if (this._replaying) {
                return id;
            }
            this._frameCallback = cb;
            this._frameCallbackId = id;
            // The tick callback keeps the loop going; this render is what stops the first
            // (or resumed) frame from waiting for it.
            this.queue_render();
            return id;
        }

        /**
         * Browser `cancelAnimationFrame`. Clears the pending callback only when `id` is
         * the handle from the most recent `requestAnimationFrame`; a stale handle is a
         * no-op.
         *
         * That matching is load-bearing: without it any stray cancel (Excalibur's
         * `Engine.stop()`, fired from a transient parent `unmap` in a responsive layout)
         * kills the loop's current callback and freezes rendering.
         */
        cancelAnimationFrame(id: number): void {
            if (id !== 0 && id === this._frameCallbackId) {
                this._frameCallback = null;
                this._frameCallbackId = 0;
                // An explicit cancel is the app stopping, so drop the retained frame too:
                // a later repaint must not replay an ended loop, and its closure (scene,
                // renderer, GL buffers) is released.
                this._lastFrameCallback = null;
                this._lastFrameTime = 0;
            }
        }

        /**
         * Sets the browser globals this bridge owns, so browser-targeted code (Three.js)
         * runs unchanged on GJS.
         *
         * The two context constructors are installed UNCONDITIONALLY: per ADR 0012 rule 5
         * `installGlobals()` is the explicit imperative path and installs the same set as
         * `@gjsify/webgl/register`, which keeps the if-undefined guard instead.
         */
        installGlobals(): void {
            /** Typed view of the globalThis slots below, in place of 5 `as any` writes. */
            interface _RafGlobals {
                requestAnimationFrame?: (cb: FrameRequestCallback) => number;
                cancelAnimationFrame?: (id: number) => void;
                performance?: { now: () => number; timeOrigin: number };
                WebGLRenderingContext?: typeof OurWebGLRenderingContext;
                WebGL2RenderingContext?: typeof OurWebGL2RenderingContext;
            }
            const g = globalThis as unknown as _RafGlobals;

            g.requestAnimationFrame = (cb: FrameRequestCallback) => this.requestAnimationFrame(cb);
            g.cancelAnimationFrame = (id: number) => this.cancelAnimationFrame(id);
            g.WebGLRenderingContext = OurWebGLRenderingContext;
            g.WebGL2RenderingContext = OurWebGL2RenderingContext;
            // An ACCESSOR, not a snapshot: the scale factor changes when the window moves
            // to another monitor, and `@gjsify/dom-elements` seeds a hardcoded `1`. A CSS
            // size scaled by this ratio must land on `canvas.width` (the GL drawing buffer,
            // in device pixels) — that identity is what makes an unmodified
            // Excalibur/Three.js viewport cover the whole framebuffer on a scale-factor-3
            // phone instead of its bottom-left ninth. `defineProperty`, because
            // dom-elements installs a plain value property and a bridge owns the answer.
            Object.defineProperty(globalThis, 'devicePixelRatio', {
                get: () => this.get_scale_factor() || 1,
                configurable: true,
            });
            // Always overridden: GJS's own `performance.now()` may sit on a different time
            // origin than the frame clock, and rAF timestamps must be comparable to it.
            const timeOrigin = this._timeOrigin;
            g.performance = {
                now: () => (GLib.get_monotonic_time() - timeOrigin) / 1000,
                timeOrigin: Date.now(),
            };
        }
    },
);

export type WebGLBridge = InstanceType<typeof WebGLBridge>;
