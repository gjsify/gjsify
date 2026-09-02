// A Gtk.DrawingArea subclass carrying the Canvas 2D bootstrapping, Cairo-backed.

import GObject from 'gi://GObject?version=2.0';
import type Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import type Cairo from 'cairo';
import { HTMLCanvasElement as GjsifyHTMLCanvasElement, notifyElementResize } from '@gjsify/dom-elements';
// `_onDraw` calls `canvas.getContext('2d')`, so the DOM pillar's `'2d'` factory must be
// registered. Imported HERE, in the module that needs it, per the framework-package rule
// — not re-registered locally and not left to `--globals auto` spotting
// `HTMLCanvasElement` in the consumer's bundle. Tree-shakes with the bridge.
import '@gjsify/dom-elements/register/canvas';
// `@gjsify/canvas2d-core`'s root entry is headless (Cairo + PangoCairo only), so its
// pixel interop is injected. This package already binds Gtk/Gdk, so it supplies the
// GDK-backed implementation explicitly. Idempotent side-effect module.
import '@gjsify/canvas2d-core/gdk';
import { attachEventControllers } from '@gjsify/event-bridge';
import type { CanvasRenderingContext2D } from '@gjsify/canvas2d-core';
import { Event } from '@gjsify/dom-events';

type Canvas2DReadyCallback = (canvas: globalThis.HTMLCanvasElement, ctx: CanvasRenderingContext2D) => void;

/**
 * A `Gtk.DrawingArea` subclass that creates an `HTMLCanvasElement` +
 * `CanvasRenderingContext2D` on first draw and blits its Cairo surface each frame.
 *
 * `installGlobals()` must run BEFORE the app code that expects the browser globals:
 * ```ts
 * const widget = new Canvas2DBridge();
 * widget.installGlobals();
 * widget.onReady((canvas, ctx) => { … });
 * window.set_child(widget);
 * ```
 *
 * No custom 'resize' signal: the one inherited from Gtk.Widget has the same shape as
 * Gtk.GLArea's, so `widget.connect('resize', …)` is one pattern across both bridges.
 */
export const Canvas2DBridge = GObject.registerClass(
    { GTypeName: 'GjsifyCanvas2DBridge' },
    class Canvas2DBridge extends Gtk.DrawingArea {
        _canvas: GjsifyHTMLCanvasElement | null = null;
        _ctx: CanvasRenderingContext2D | null = null;
        _readyCallbacks: Canvas2DReadyCallback[] = [];
        _resizeCallbacks: ((w: number, h: number) => void)[] = [];
        _tickCallbackId: number | null = null;
        _frameCallback: FrameRequestCallback | null = null;
        // Origin for both rAF timestamps and `performance.now()`, per the browser
        // DOMHighResTimeStamp spec.
        _timeOrigin: number = GLib.get_monotonic_time();

        constructor(params?: Partial<Gtk.DrawingArea.ConstructorProps>) {
            super(params);
            this.set_draw_func(this._onDraw.bind(this));

            // captureKeys: stops GTK focus traversal from consuming arrow/Enter keys.
            attachEventControllers(this, () => this._canvas, { captureKeys: true });

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
        _onDraw(_area: Gtk.DrawingArea, cr: Cairo.Context, width: number, height: number): void {
            // Dimensions are NOT synced once onReady has fired: a ready callback may have
            // set its own canvas size for a static render, and syncing would clear the
            // surface it just drew into.
            if (!this._canvas) {
                this._canvas = new GjsifyHTMLCanvasElement();
                this._canvas.width = width;
                this._canvas.height = height;
                this._ctx = this._canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
                if (this._ctx) {
                    for (const cb of this._readyCallbacks) {
                        cb(this._canvas as unknown as globalThis.HTMLCanvasElement, this._ctx);
                    }
                    this._readyCallbacks = [];
                }
            } else if (this._canvas.width !== width || this._canvas.height !== height) {
                // The widget was resized. Gtk.DrawingArea already emits the inherited
                // 'resize' signal itself; the DOM event, the ResizeObserver notification
                // (ancestor walk included, for Excalibur's FillContainer mode) and the
                // onResize callbacks are what this adds.
                this._canvas.width = width;
                this._canvas.height = height;
                this._canvas.dispatchEvent(new Event('resize'));
                notifyElementResize(this._canvas, width, height);
                for (const cb of this._resizeCallbacks) {
                    cb(width, height);
                }
            }

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

        /** The 2D rendering context; available after the first draw. */
        getContext(_id: '2d'): CanvasRenderingContext2D | null {
            return this._ctx;
        }

        /** Runs `cb` once the 2D context is ready — synchronously if it already is. */
        onReady(cb: Canvas2DReadyCallback): void {
            if (this._canvas && this._ctx) {
                cb(this._canvas as unknown as globalThis.HTMLCanvasElement, this._ctx);
                return;
            }
            this._readyCallbacks.push(cb);
        }

        /**
         * Runs `cb` on every GTK resize, with the canvas dimensions already updated. Call
         * `queue_draw()` after re-rendering to push the new surface to screen.
         */
        onResize(cb: (width: number, height: number) => void): void {
            this._resizeCallbacks.push(cb);
        }

        /**
         * Browser `requestAnimationFrame`, driven by the vsync-synced GTK frame clock.
         * Always returns 0: there is no `cancelAnimationFrame` here to hand a handle to.
         */
        requestAnimationFrame(cb: FrameRequestCallback): number {
            this._frameCallback = cb;
            if (this._tickCallbackId === null) {
                this._tickCallbackId = this.add_tick_callback((_widget: Gtk.Widget, frameClock: Gdk.FrameClock) => {
                    this._tickCallbackId = null;
                    const time = (frameClock.get_frame_time() - this._timeOrigin) / 1000;
                    this._frameCallback?.(time);
                    this.queue_draw();
                    return GLib.SOURCE_REMOVE;
                });
            }
            // Without this, a rAF issued during the paint phase (e.g. from onReady) may
            // never make the frame clock tick again.
            this.queue_draw();
            return 0;
        }

        /**
         * Sets browser globals (`requestAnimationFrame`, `performance`) so that
         * browser-targeted code works unchanged on GJS.
         */
        installGlobals(): void {
            interface _RafGlobals {
                requestAnimationFrame?: (cb: FrameRequestCallback) => number;
                performance?: { now: () => number; timeOrigin: number };
            }
            const g = globalThis as unknown as _RafGlobals;

            g.requestAnimationFrame = (cb: FrameRequestCallback) => this.requestAnimationFrame(cb);
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

export type Canvas2DBridge = InstanceType<typeof Canvas2DBridge>;
