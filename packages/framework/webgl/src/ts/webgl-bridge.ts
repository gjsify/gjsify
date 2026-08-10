// WebGLBridge — GTK container for HTMLCanvasElement (WebGL) backed by Gtk.GLArea.
// Provides a Gtk.GLArea subclass that handles all WebGL bootstrapping boilerplate.

import GObject from 'gi://GObject';
// Value import (not `import type`): `Gdk.GLAPI` is read at construction to
// declare which GL APIs this widget accepts — see the constructor.
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { HTMLCanvasElement as OurHTMLCanvasElement } from './html-canvas-element.js';
// Value imports (not `import type`): `installGlobals()` installs both
// constructors on globalThis, so it needs the classes at runtime.
import { WebGLRenderingContext as OurWebGLRenderingContext } from './webgl-rendering-context.js';
import { WebGL2RenderingContext as OurWebGL2RenderingContext } from './webgl2-rendering-context.js';
import { attachEventControllers } from '@gjsify/event-bridge';
import { Event } from '@gjsify/dom-events';
import { notifyElementResize } from '@gjsify/dom-elements';
import { isSoftwareRenderer } from './software-renderer.js';

// Public callback type uses globalThis.HTMLCanvasElement (lib.dom) so callers can pass the
// canvas directly to WebGL demos that type their canvas parameter as HTMLCanvasElement.
// Internally _canvas is OurHTMLCanvasElement and is cast at the API boundary.
type WebGLReadyCallback = (canvas: globalThis.HTMLCanvasElement, gl: globalThis.WebGLRenderingContext) => void;

/**
 * A `Gtk.GLArea` subclass that handles WebGL bootstrapping:
 * - Sets up OpenGL ES 3.2 context, depth buffer, stencil buffer
 * - Creates an `HTMLCanvasElement` wrapping the GLArea on first render
 * - Fires `onReady()` callbacks with (canvas, gl) once the context is available
 * - Provides `requestAnimationFrame()` backed by GTK frame clock (vsync) + render signal
 * - `installGlobals()` sets `globalThis.{requestAnimationFrame, cancelAnimationFrame,
 *   performance, WebGLRenderingContext, WebGL2RenderingContext}`
 *
 * Usage:
 * ```ts
 * const widget = new WebGLBridge();
 * widget.installGlobals();  // sets globalThis.requestAnimationFrame
 * widget.onReady((canvas, gl) => {
 *     gl.clearColor(0, 0, 0, 1);
 *     // requestAnimationFrame is now available globally
 * });
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
        // The most recently fired frame callback, retained AFTER invocation. A
        // GTK-initiated repaint with no pending rAF — an offscreen snapshot (the
        // devtools Screenshot re-renders via Gtk.WidgetPaintable), an expose, or
        // an occlusion change — would otherwise clear the GLArea FBO and capture
        // a blank frame for demand-driven apps (Three.js render-on-demand renders
        // on OrbitControls 'change', not a loop). The 'render' handler replays
        // this so the framebuffer keeps reflecting current content. Cleared on an
        // explicit cancelAnimationFrame (the app stopping) and on unrealize.
        _lastFrameCallback: FrameRequestCallback | null = null;
        // Timestamp the retained frame last ran at. The replay re-feeds THIS (not
        // the current clock) so a delta-time integrator (`dt = t - lastT`) sees
        // dt≈0 and doesn't jump the simulation by the whole idle gap.
        _lastFrameTime: number = 0;
        // True only while replaying `_lastFrameCallback` for a GTK-initiated
        // repaint. A self-rearming callback's `requestAnimationFrame()` is ignored
        // while set, so a side-effect-free repaint (snapshot/expose) can't
        // resurrect a loop the app paused/stopped.
        _replaying: boolean = false;
        // ID of the pending frame callback (matches the value returned by the
        // most recent requestAnimationFrame call). `cancelAnimationFrame(id)`
        // only clears the callback when this matches — without ID tracking a
        // single cancel from anywhere (e.g. an Excalibur.stop() during a
        // transient parent unmap) would kill the entire loop because every
        // request would have returned the same handle. Starts at 0 so an
        // "early" cancel before the first request is a no-op.
        _frameCallbackId: number = 0;
        _nextFrameId: number = 1;
        // Time origin in microseconds (GLib monotonic clock).
        // Both requestAnimationFrame timestamps and performance.now() are
        // relative to this origin, matching the browser DOMHighResTimeStamp spec.
        _timeOrigin: number = GLib.get_monotonic_time();
        // Unmasked GL vendor/renderer, filled in once the context exists.
        private _rendererInfo: { vendor: string; renderer: string } | null = null;

        constructor(params?: Partial<Gtk.GLArea.ConstructorProps>) {
            super(params);
            // GLES where the platform HAS a GLES profile, desktop GL where it does
            // not. `set_use_es(true)` is `set_allowed_apis(GDK_GL_API_GLES)` — i.e.
            // GLES-ONLY — and macOS offers NO GLES profile at all (CGL caps at
            // desktop GL 4.1), so on every darwin host that call left the GLArea
            // permanently in error (`get_error()` = "Application does not support
            // OpenGL API", `get_context()` null, no `render` signal ever): the
            // widget could not draw one pixel. Allowing BOTH changes nothing where
            // GLES exists — GDK prefers it (measured on gtk 4.22 / Wayland / Mesa:
            // both-allowed realizes GLES 3.2, byte-for-byte the API and version
            // `set_use_es(true)` produced) — and picks desktop GL 4.1 on macOS.
            //
            // The choice MUST be made before realize: `gtk_gl_area_set_allowed_apis`
            // asserts `!gtk_widget_get_realized`, so "retry wider after a failed
            // realize" is not available (measured, gtk 4.22). Hence no probe and no
            // platform sniffing — declare what we accept and let GDK pick.
            this.set_allowed_apis(Gdk.GLAPI.GL | Gdk.GLAPI.GLES);
            this.set_required_version(3, 2);
            this.set_has_depth_buffer(true);
            this.set_has_stencil_buffer(true);

            // Bridge GTK events → DOM events on the canvas element.
            // captureKeys=true: consume key events so GTK focus traversal (arrow keys)
            // never steals focus from the game canvas.
            attachEventControllers(this, () => this._canvas, { captureKeys: true });

            // Persistent tick callback: fires every GTK frame clock tick.
            // Calls queue_render() only when a frame callback is pending — avoids
            // redundant GPU wakeups when the animation loop is idle.
            // SOURCE_CONTINUE keeps a single GLib.Source alive for the widget lifetime,
            // eliminating per-rAF GLib.Source allocation + GObject signal connect/disconnect.
            this._tickCallbackId = this.add_tick_callback((_widget: Gtk.Widget, _frameClock: Gdk.FrameClock) => {
                if (this._frameCallback !== null) {
                    this.queue_render();
                }
                return GLib.SOURCE_CONTINUE;
            });

            // One-shot init render handler: bootstraps the GL context and canvas,
            // then installs the persistent frame render handler.
            const initId = this.connect('render', () => {
                this.disconnect(initId);
                this.make_current();
                this._canvas = new OurHTMLCanvasElement(this);
                // Attach to document.body so event bubbling reaches ownerDocument
                // (e.g. OrbitControls registers pointermove on ownerDocument).
                {
                    const g = globalThis as unknown as { document?: { body?: { appendChild(el: unknown): void } } };
                    if (g.document?.body) {
                        g.document.body.appendChild(this._canvas);
                    }
                }
                // Eagerly create BOTH WebGL and WebGL2 contexts during the init
                // render signal so their underlying _init() calls capture GtkGLArea's
                // private FBO ID via GL_FRAMEBUFFER_BINDING. If we only create webgl1
                // here and the consumer later calls getContext('webgl2') (as Excalibur
                // 0.32 does — it uses WebGL2 exclusively), the webgl2 context would be
                // instantiated OUTSIDE the render signal, GL_FRAMEBUFFER_BINDING would
                // read 0, _gtkFboId would be 0, and bindFramebuffer(null) would bind
                // FBO 0 instead of GtkGLArea's FBO → invisible rendering.
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

                // Persistent frame render handler — installed once after canvas init.
                // Fires after the tick callback calls queue_render() with a pending rAF.
                // Clears _frameCallback before invoking it so re-entrant rAF calls
                // (standard game loop pattern) set a fresh pending callback correctly.
                this._renderTag = this.connect('render', (_widget: Gtk.GLArea) => {
                    const time = (GLib.get_monotonic_time() - this._timeOrigin) / 1000;
                    if (this._frameCallback !== null) {
                        if ((globalThis as { __GJSIFY_DEBUG_RAF?: boolean }).__GJSIFY_DEBUG_RAF === true) {
                            console.log(`[rAF] frame callback fires t=${time.toFixed(1)}`);
                        }
                        const cb = this._frameCallback;
                        // Clear BEFORE invoking so a synchronous rAF call from
                        // inside `cb` (the standard game-loop pattern — Excalibur,
                        // Three.js, etc.) installs a fresh pending callback +
                        // assigns a fresh ID. Without this the re-entered request
                        // would compare its own freshly-assigned ID against itself
                        // and immediately get cancelled by stray cancel calls.
                        this._frameCallback = null;
                        this._frameCallbackId = 0;
                        // Retain for replay on GTK-initiated repaints (see below).
                        this._lastFrameCallback = cb;
                        this._lastFrameTime = time;
                        cb(time);
                    } else if (this._lastFrameCallback !== null) {
                        // No app frame is pending, yet GTK asked us to repaint —
                        // typically an OFFSCREEN SNAPSHOT (devtools Screenshot via
                        // Gtk.WidgetPaintable), an expose, or an occlusion change.
                        // Demand-driven apps (Three.js render-on-demand) would draw
                        // nothing here, leaving the FBO blank → the snapshot captures
                        // an empty GLArea. Re-present the last frame so the
                        // framebuffer reflects current content.
                        //
                        // This must be SIDE-EFFECT-FREE: re-feed the last frame's
                        // timestamp (not `time`) so a delta-time integrator sees
                        // dt≈0, and set `_replaying` so a self-rearming callback's
                        // requestAnimationFrame() can't resurrect a loop the app
                        // paused/stopped. A still-running loop never reaches this
                        // branch — it always has a pending callback.
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

            // Re-render when the widget is resized so demand-driven apps
            // (no animation loop) don't show a black frame after resize.
            // queue_render() alone only triggers the GTK render signal — it does
            // NOT re-execute the application's render logic.  We schedule a rAF
            // that re-invokes the last frame callback, which runs inside the
            // GTK frame pipeline with the GL context current.
            //
            // Also notify onResize() subscribers and dispatch a DOM 'resize'
            // event on the canvas, matching the unified API exposed by
            // Canvas2DBridge. Consumers can use any of:
            //   widget.connect('resize', (w, width, height) => { ... })  // GObject
            //   widget.onResize((width, height) => { ... })              // convenience
            //   canvas.addEventListener('resize', () => { ... })         // DOM
            //   new ResizeObserver(cb).observe(canvas)                   // W3C
            //   new ResizeObserver(cb).observe(document.body)            // W3C — ancestor walk
            // The ResizeObserver wiring (last two lines) goes through
            // notifyElementResize() which also walks the ancestor chain —
            // Excalibur.js 0.32's DisplayMode.FillContainer observes
            // canvas.parentElement (i.e. document.body), not the canvas
            // itself, and would otherwise never see GTK allocation changes.
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
         * The GL implementation GDK negotiated, unmasked — `{vendor, renderer}`
         * straight from `glGetString`, e.g. `Apple Software Renderer`. `null`
         * until the context exists (i.e. before the first `onReady`).
         *
         * Read it to REPORT what a host provides. It is not a capability check:
         * a CPU rasteriser draws everything a GPU does, only slower, and how much
         * slower depends entirely on the workload. Anything that switches
         * renderers should key on a measured frame budget, not on this string.
         */
        get rendererInfo(): { vendor: string; renderer: string } | null {
            return this._rendererInfo;
        }

        /**
         * Registers a callback to be called once the WebGL context is ready.
         * If the context is already available, the callback fires synchronously.
         */
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
         * Records the negotiated GL implementation and, when it rasterises on the
         * CPU, says so ONCE on stderr.
         *
         * A GPU-less host is invisible from inside the app: context creation
         * succeeds, every draw call succeeds, nothing rejects, and the only tell
         * is a frame budget blown by three orders of magnitude — which presents as
         * a window that sits there. Naming the renderer at the one place that
         * knows it turns that into a line anyone can act on, for every consumer,
         * without any of them asking.
         *
         * Diagnostic only: it changes no behaviour, because a software renderer is
         * fine for plenty of workloads (measured on one GPU-less macOS host: a
         * demand-driven three.js scene and a flat-shaded full-screen quad both run
         * comfortably on the same driver that needs 1.1 s for one textured
         * full-screen draw in a 2D game).
         */
        private _reportRenderer(gl: OurWebGLRenderingContext): void {
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
         * Register a callback invoked whenever the GTK widget is resized.
         * The callback fires alongside the native 'resize' GObject signal and
         * after the DOM 'resize' event has been dispatched on the canvas.
         * Canvas buffer dimensions are NOT automatically updated — consumers
         * should set `canvas.width`/`canvas.height` themselves if desired.
         */
        onResize(cb: (width: number, height: number) => void): void {
            this._resizeCallbacks.push(cb);
        }

        /**
         * Schedules a single animation frame callback, matching the browser `requestAnimationFrame` API.
         * Backed by a persistent GTK frame clock tick callback (vsync-synced) + a persistent GLArea
         * render signal handler. Both are installed once at construction / first render respectively,
         * eliminating per-frame GLib.Source allocation and GObject signal connect/disconnect overhead.
         *
         * Returns a monotonically-increasing handle; pass it to `cancelAnimationFrame(id)` to cancel
         * the specific pending callback. A second `requestAnimationFrame` call before the first has
         * fired replaces the pending callback (single-slot model — matching the existing rAF
         * convention of "queue 1 callback per frame, the latest wins"); the older handle becomes
         * stale and a `cancelAnimationFrame` with that handle is a no-op.
         */
        requestAnimationFrame(cb: FrameRequestCallback): number {
            const id = this._nextFrameId++;
            // A frame requested from inside a replay (see the 'render' handler) is
            // the retained callback re-arming its own loop. A GTK-initiated repaint
            // (snapshot/expose) must be side-effect-free, so don't resurrect a loop
            // the app paused/stopped: hand back a handle but schedule nothing (a
            // later cancelAnimationFrame(id) stays a harmless no-op). Demand-driven
            // apps don't re-arm during their frame, so they never hit this.
            if (this._replaying) {
                return id;
            }
            this._frameCallback = cb;
            this._frameCallbackId = id;
            // Trigger a render pass immediately. The persistent tick callback fires on
            // every GTK frame tick and calls queue_render() whenever _frameCallback is set,
            // keeping the loop going; this call ensures the first/resumed frame isn't delayed.
            this.queue_render();
            return id;
        }

        /**
         * Cancels a previously-scheduled animation frame callback, matching the browser
         * `cancelAnimationFrame` API. Only clears the pending callback when `id` matches
         * the handle returned by the most recent `requestAnimationFrame` call — a stale
         * handle (from a callback that already fired, or was replaced by a later
         * `requestAnimationFrame`) is a no-op.
         *
         * Per-ID matching is load-bearing: without it any consumer that calls
         * `cancelAnimationFrame` (e.g. Excalibur's `Engine.stop()`, called from a
         * transient parent `unmap` in a responsive layout) would clear the loop's
         * latest pending callback and freeze rendering until the next manual
         * `requestAnimationFrame`. With it, the cancel only fires for the handle
         * the caller actually owns.
         */
        cancelAnimationFrame(id: number): void {
            if (id !== 0 && id === this._frameCallbackId) {
                this._frameCallback = null;
                this._frameCallbackId = 0;
                // An explicit cancel is the app deliberately stopping. Drop the
                // retained frame too, so a later GTK repaint can't replay (and
                // re-render) a loop the app ended, and the callback's closure
                // (scene, renderer, GL buffers) is released.
                this._lastFrameCallback = null;
                this._lastFrameTime = 0;
            }
        }

        /**
         * Sets the browser globals this bridge owns — `requestAnimationFrame`,
         * `cancelAnimationFrame`, `performance` and the two WebGL context
         * constructors — so that browser-targeted code (e.g. Three.js) works
         * unchanged on GJS.
         *
         * `WebGLRenderingContext` / `WebGL2RenderingContext` are installed
         * UNCONDITIONALLY here: per ADR 0012 rule 5 a bridge's `installGlobals()`
         * and its `/register` install the same set, `installGlobals()` being the
         * explicit imperative path (`@gjsify/webgl/register` keeps the
         * if-undefined guard instead). They used to reach `globalThis` for free
         * as a side effect of importing the `@gjsify/webgl` barrel; moving that
         * write into `register.ts` must not shrink what this method does.
         */
        installGlobals(): void {
            /**
             * Module-local typed view of the globalThis slots this method writes.
             * Avoids 5 `(globalThis as any)` writes at the call sites.
             */
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
            // devicePixelRatio — an ACCESSOR reading the widget's live scale
            // factor, not a snapshot: it changes when the window moves to another
            // monitor, and `@gjsify/dom-elements`' register module seeds a
            // hardcoded `1` that predates any HiDPI testing. A consumer scaling a
            // CSS size by this ratio must land on `canvas.width` (the GL drawing
            // buffer, device pixels) — that identity is what makes an unmodified
            // Excalibur/Three.js viewport cover the whole framebuffer on a
            // scale-factor-3 phone instead of its bottom-left ninth.
            //
            // `defineProperty` rather than assignment: dom-elements installs it as
            // a plain value property, and a bridge owns the real answer.
            Object.defineProperty(globalThis, 'devicePixelRatio', {
                get: () => this.get_scale_factor() || 1,
                configurable: true,
            });
            // Install performance.now() on the same time origin as rAF timestamps.
            // Always override to ensure consistency — native GJS performance.now()
            // may use a different time origin than the frame clock.
            const timeOrigin = this._timeOrigin;
            g.performance = {
                now: () => (GLib.get_monotonic_time() - timeOrigin) / 1000,
                timeOrigin: Date.now(),
            };
        }
    },
);

// Export the instance type so callers can type-annotate their WebGLBridge variables
export type WebGLBridge = InstanceType<typeof WebGLBridge>;
