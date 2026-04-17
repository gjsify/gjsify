// WebGLBridge — GTK container for HTMLCanvasElement (WebGL) backed by Gtk.GLArea.
// Provides a Gtk.GLArea subclass that handles all WebGL bootstrapping boilerplate.

import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { HTMLCanvasElement as OurHTMLCanvasElement } from './html-canvas-element.js';
import type { WebGLRenderingContext as OurWebGLRenderingContext } from './webgl-rendering-context.js';
import { attachEventControllers } from '@gjsify/event-bridge';
import { Event } from '@gjsify/dom-events';

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
 * - `installGlobals()` sets `globalThis.requestAnimationFrame` and `globalThis.performance`
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
        // Time origin in microseconds (GLib monotonic clock).
        // Both requestAnimationFrame timestamps and performance.now() are
        // relative to this origin, matching the browser DOMHighResTimeStamp spec.
        _timeOrigin: number = GLib.get_monotonic_time();

        constructor(params?: Partial<Gtk.GLArea.ConstructorProps>) {
            super(params);
            this.set_use_es(true);
            this.set_required_version(3, 2);
            this.set_has_depth_buffer(true);
            this.set_has_stencil_buffer(true);

            // Bridge GTK events → DOM events on the canvas element.
            // captureKeys=true: consume key events so GTK focus traversal (arrow keys)
            // never steals focus from the game canvas.
            attachEventControllers(this, () => this._canvas, { captureKeys: true });

            // Initialize canvas on first render
            const initId = this.connect('render', () => {
                this.disconnect(initId);
                this.make_current();
                this._canvas = new OurHTMLCanvasElement(this);
                // Attach to document.body so event bubbling reaches ownerDocument
                // (e.g. OrbitControls registers pointermove on ownerDocument).
                if ((globalThis as any).document?.body) {
                    (globalThis as any).document.body.appendChild(this._canvas);
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
                    for (const cb of this._readyCallbacks) {
                        cb(this._canvas as unknown as globalThis.HTMLCanvasElement, gl as unknown as globalThis.WebGLRenderingContext);
                    }
                    this._readyCallbacks = [];
                }
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
            this.connect('resize', () => {
                const width = this.get_allocated_width();
                const height = this.get_allocated_height();
                if (this._canvas) {
                    this._canvas.dispatchEvent(new Event('resize'));
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
                this._canvas = null;
            });
        }

        /** The HTMLCanvasElement wrapping this GLArea. Available after the first render. */
        get canvas(): globalThis.HTMLCanvasElement | null {
            return this._canvas as unknown as globalThis.HTMLCanvasElement | null;
        }

        /**
         * Registers a callback to be called once the WebGL context is ready.
         * If the context is already available, the callback fires synchronously.
         */
        onReady(cb: WebGLReadyCallback): void {
            if (this._canvas) {
                const gl = this._canvas.getContext('webgl') as OurWebGLRenderingContext | null;
                if (gl) {
                    cb(this._canvas as unknown as globalThis.HTMLCanvasElement, gl as unknown as globalThis.WebGLRenderingContext);
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
         * Backed by GTK frame clock (vsync-synced) + the GLArea render signal.
         * Returns 0 (handle — cancel not yet implemented).
         */
        requestAnimationFrame(cb: FrameRequestCallback): number {
            this._frameCallback = cb;
            if (this._tickCallbackId === null) {
                this._tickCallbackId = this.add_tick_callback((_widget: Gtk.Widget, _frameClock: Gdk.FrameClock) => {
                    this._tickCallbackId = null;
                    if (this._renderTag === null) {
                        this._renderTag = this.connect('render', (_widget: Gtk.GLArea) => {
                            this.disconnect(this._renderTag!);
                            this._renderTag = null;
                            // DOMHighResTimeStamp: ms since time origin, matching performance.now()
                            const time = (GLib.get_monotonic_time() - this._timeOrigin) / 1000;
                            if ((globalThis as any).__GJSIFY_DEBUG_RAF === true) {
                                console.log(`[rAF] frame callback fires t=${time.toFixed(1)}`);
                            }
                            this._frameCallback?.(time);
                            return true;
                        });
                    }
                    this.queue_render();
                    return GLib.SOURCE_REMOVE;
                });
            }
            // Ensure GTK schedules a new frame so the tick callback fires.
            // Without this, requestAnimationFrame called during the paint phase
            // (e.g. from onReady) may not trigger the frame clock to tick again.
            this.queue_render();
            return 0;
        }

        /**
         * Sets browser globals (`requestAnimationFrame`, `performance`) so that
         * browser-targeted code (e.g. Three.js) works unchanged on GJS.
         */
        installGlobals(): void {
            (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
                this.requestAnimationFrame(cb);
            (globalThis as any).cancelAnimationFrame = (_id: number) => {
                // Cancel is not yet fully implemented — clear pending frame callback.
                this._frameCallback = null;
            };
            // Install performance.now() on the same time origin as rAF timestamps.
            // Always override to ensure consistency — native GJS performance.now()
            // may use a different time origin than the frame clock.
            const timeOrigin = this._timeOrigin;
            (globalThis as any).performance = {
                now: () => (GLib.get_monotonic_time() - timeOrigin) / 1000,
                timeOrigin: Date.now(),
            };
        }
    }
);

// Export the instance type so callers can type-annotate their WebGLBridge variables
export type WebGLBridge = InstanceType<typeof WebGLBridge>;
