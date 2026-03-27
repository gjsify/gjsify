// Canvas2DWidget GTK widget for GJS — original implementation using Gtk.DrawingArea + Cairo
// Provides a Gtk.DrawingArea subclass that handles Canvas 2D bootstrapping.
// Pattern follows packages/dom/iframe/src/iframe-widget.ts (IFrameWidget)

import GObject from 'gi://GObject';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { HTMLCanvasElement as GjsifyHTMLCanvasElement } from '@gjsify/dom-elements';
import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';

type Canvas2DReadyCallback = (canvas: globalThis.HTMLCanvasElement, ctx: CanvasRenderingContext2D) => void;

/**
 * A `Gtk.DrawingArea` subclass that handles Canvas 2D bootstrapping:
 * - Creates an `HTMLCanvasElement` + `CanvasRenderingContext2D` on first draw
 * - Blits the Canvas 2D Cairo.ImageSurface onto the DrawingArea each frame
 * - Fires `onReady()` callbacks with (canvas, ctx) once the context is available
 * - Provides `requestAnimationFrame()` backed by GLib.idle_add + queue_draw
 * - `installGlobals()` sets `globalThis.requestAnimationFrame` to use this widget
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
export const Canvas2DWidget = GObject.registerClass(
    { GTypeName: 'GjsifyCanvas2DWidget' },
    class Canvas2DWidget extends Gtk.DrawingArea {
        _canvas: GjsifyHTMLCanvasElement | null = null;
        _ctx: CanvasRenderingContext2D | null = null;
        _readyCallbacks: Canvas2DReadyCallback[] = [];
        _idleTag: number | null = null;
        _frameCallback: FrameRequestCallback | null = null;

        constructor(params?: Partial<Gtk.DrawingArea.ConstructorProps>) {
            super(params);
            this.set_draw_func(this._onDraw.bind(this));

            this.connect('unrealize', () => {
                if (this._idleTag !== null) {
                    GLib.source_remove(this._idleTag);
                    this._idleTag = null;
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
            // Lazy init: create canvas + 2D context on first draw
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
            }

            // Sync dimensions if widget was resized
            if (this._canvas.width !== width || this._canvas.height !== height) {
                this._canvas.width = width;
                this._canvas.height = height;
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
         * Schedules a single animation frame callback, matching the browser `requestAnimationFrame` API.
         * Backed by GLib.idle_add. The callback draws on the 2D context, then queue_draw blits to screen.
         * Returns 0 (handle — cancel not yet implemented).
         */
        requestAnimationFrame(cb: FrameRequestCallback): number {
            this._frameCallback = cb;
            if (this._idleTag === null) {
                this._idleTag = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._idleTag = null;
                    const time = GLib.get_monotonic_time() / 1000;
                    this._frameCallback?.(time);
                    this.queue_draw();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return 0;
        }

        /**
         * Sets `globalThis.requestAnimationFrame` to use this widget.
         * Call this once after creating the widget and before running Canvas 2D code
         * that relies on the browser `requestAnimationFrame` global.
         */
        installGlobals(): void {
            (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
                this.requestAnimationFrame(cb);
        }
    }
);

// Export the instance type so callers can type-annotate their Canvas2DWidget variables
export type Canvas2DWidget = InstanceType<typeof Canvas2DWidget>;
