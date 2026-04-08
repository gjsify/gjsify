// Canvas2DWidget GTK widget for GJS — original implementation using Gtk.DrawingArea + Cairo
// Provides a Gtk.DrawingArea subclass that handles Canvas 2D bootstrapping.
// Pattern follows packages/dom/iframe/src/iframe-widget.ts (IFrameWidget)

import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { HTMLCanvasElement as GjsifyHTMLCanvasElement } from '@gjsify/dom-elements';
import { attachEventControllers } from '@gjsify/event-bridge';
import { CanvasRenderingContext2D } from '@gjsify/canvas2d-core';
import { Event } from '@gjsify/dom-events';

type Canvas2DReadyCallback = (canvas: globalThis.HTMLCanvasElement, ctx: CanvasRenderingContext2D) => void;

/**
 * A `Gtk.DrawingArea` subclass that handles Canvas 2D bootstrapping:
 * - Creates an `HTMLCanvasElement` + `CanvasRenderingContext2D` on first draw
 * - Blits the Canvas 2D Cairo.ImageSurface onto the DrawingArea each frame
 * - Fires `onReady()` callbacks with (canvas, ctx) once the context is available
 * - Provides `requestAnimationFrame()` backed by GTK frame clock (vsync)
 * - `installGlobals()` sets `globalThis.requestAnimationFrame` and `globalThis.performance`
 *
 * Usage:
 * ```ts
 * const widget = new Canvas2DWidget();
 * widget.installGlobals();  // sets globalThis.requestAnimationFrame
 * widget.onReady((canvas, ctx) => {
 *     ctx.fillStyle = 'red';
 *     ctx.fillRect(0, 0, 100, 100);
 * });
 * window.set_child(widget);
 * ```
 */
// Gtk.DrawingArea inherits a 'resize' signal with signature
// (widget: Drawable, width: int, height: int) from its ancestors (Gtk.Widget).
// CanvasWebGLWidget uses Gtk.GLArea which has the same-shaped signal. We do
// NOT register a custom signal — we piggyback on the inherited one so
// consumers can use a single pattern on both widgets:
//   widget.connect('resize', (w, width, height) => { ... })
// In addition, _onDraw fires onResize(cb) callbacks and dispatches a DOM
// 'resize' event on the canvas for browser-style listeners.

export const Canvas2DWidget = GObject.registerClass(
    { GTypeName: 'GjsifyCanvas2DWidget' },
    class Canvas2DWidget extends Gtk.DrawingArea {
        _canvas: GjsifyHTMLCanvasElement | null = null;
        _ctx: CanvasRenderingContext2D | null = null;
        _readyCallbacks: Canvas2DReadyCallback[] = [];
        _resizeCallbacks: ((w: number, h: number) => void)[] = [];
        _tickCallbackId: number | null = null;
        _frameCallback: FrameRequestCallback | null = null;
        // Time origin in microseconds (GLib monotonic clock).
        // Both requestAnimationFrame timestamps and performance.now() are
        // relative to this origin, matching the browser DOMHighResTimeStamp spec.
        _timeOrigin: number = GLib.get_monotonic_time();

        constructor(params?: Partial<Gtk.DrawingArea.ConstructorProps>) {
            super(params);
            this.set_draw_func(this._onDraw.bind(this));

            // Bridge GTK events → DOM events on the canvas element
            attachEventControllers(this, () => this._canvas);

            this.connect('unrealize', () => {
                if (this._tickCallbackId !== null) {
                    this.remove_tick_callback(this._tickCallbackId);
                    this._tickCallbackId = null;
                }
                if (this._ctx) {
                    this._ctx._dispose();
                }
                this._canvas = null;
                this._ctx = null;
            });
        }

        /** @internal Draw function called by GTK. Blits the Cairo surface to screen. */
        _onDraw(_area: Gtk.DrawingArea, cr: any, width: number, height: number): void {
            // Lazy init: create canvas + 2D context on first draw.
            // We do NOT sync dimensions after onReady fires: ready callbacks may set their
            // own canvas dimensions (e.g. a static render at a fixed size). Syncing here
            // would clear the surface they just drew into.
            if (!this._canvas) {
                this._canvas = new GjsifyHTMLCanvasElement();
                this._canvas.width = width;
                this._canvas.height = height;
                // Import side-effect registers the '2d' factory, so getContext('2d') works
                this._ctx = this._canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
                if (this._ctx) {
                    for (const cb of this._readyCallbacks) {
                        cb(this._canvas as unknown as globalThis.HTMLCanvasElement, this._ctx);
                    }
                    this._readyCallbacks = [];
                }
            } else if (this._canvas.width !== width || this._canvas.height !== height) {
                // Subsequent draw: GTK widget was resized — sync canvas and notify listeners.
                // NOTE: Gtk.DrawingArea itself emits the 'resize' GObject signal
                // (inherited) when the allocation changes, so consumers can use
                // widget.connect('resize', ...) without us emitting it here.
                // We additionally dispatch a DOM 'resize' event on the canvas
                // and fire onResize() callbacks for cross-widget API parity
                // with CanvasWebGLWidget.
                this._canvas.width = width;
                this._canvas.height = height;
                this._canvas.dispatchEvent(new Event('resize'));
                for (const cb of this._resizeCallbacks) {
                    cb(width, height);
                }
            }

            // Blit the Canvas 2D's Cairo.ImageSurface onto the DrawingArea
            if (this._ctx) {
                const surface = this._ctx._getSurface();
                cr.setSourceSurface(surface, 0, 0);
                cr.paint();
            }
        }

        /** The HTMLCanvasElement backing this widget. Available after the first draw. */
        get canvas(): globalThis.HTMLCanvasElement | null {
            return this._canvas as unknown as globalThis.HTMLCanvasElement | null;
        }

        /** Get the 2D rendering context. Available after the first draw. */
        getContext(_id: '2d'): CanvasRenderingContext2D | null {
            return this._ctx;
        }

        /**
         * Register a callback to be invoked once the Canvas 2D context is ready.
         * If the context is already available, the callback fires synchronously.
         */
        onReady(cb: Canvas2DReadyCallback): void {
            if (this._canvas && this._ctx) {
                cb(this._canvas as unknown as globalThis.HTMLCanvasElement, this._ctx);
                return;
            }
            this._readyCallbacks.push(cb);
        }

        /**
         * Register a callback invoked whenever the GTK widget is resized.
         * Canvas dimensions are already updated when the callback fires.
         * Call `queue_draw()` after re-rendering to push the new surface to screen.
         */
        onResize(cb: (width: number, height: number) => void): void {
            this._resizeCallbacks.push(cb);
        }

        /**
         * Schedules a single animation frame callback, matching the browser `requestAnimationFrame` API.
         * Backed by GTK frame clock (vsync-synced, typically ~60 FPS).
         * Returns 0 (handle — cancel not yet implemented).
         */
        requestAnimationFrame(cb: FrameRequestCallback): number {
            this._frameCallback = cb;
            if (this._tickCallbackId === null) {
                this._tickCallbackId = this.add_tick_callback((_widget: Gtk.Widget, frameClock: Gdk.FrameClock) => {
                    this._tickCallbackId = null;
                    // DOMHighResTimeStamp: ms since time origin, matching performance.now()
                    const time = (frameClock.get_frame_time() - this._timeOrigin) / 1000;
                    this._frameCallback?.(time);
                    this.queue_draw();
                    return GLib.SOURCE_REMOVE;
                });
            }
            // Ensure GTK schedules a new frame so the tick callback fires.
            // Without this, requestAnimationFrame called during the paint phase
            // (e.g. from onReady) may not trigger the frame clock to tick again.
            this.queue_draw();
            return 0;
        }

        /**
         * Sets browser globals (`requestAnimationFrame`, `performance`) so that
         * browser-targeted code works unchanged on GJS.
         */
        installGlobals(): void {
            (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
                this.requestAnimationFrame(cb);
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

// Export the instance type so callers can type-annotate their Canvas2DWidget variables
export type Canvas2DWidget = InstanceType<typeof Canvas2DWidget>;
