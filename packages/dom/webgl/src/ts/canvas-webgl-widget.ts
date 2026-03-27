// CanvasWebGLWidget GTK widget for GJS — original implementation using Gtk.GLArea
// Provides a Gtk.GLArea subclass that handles all WebGL bootstrapping boilerplate.

import GObject from 'gi://GObject';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { HTMLCanvasElement as OurHTMLCanvasElement } from './html-canvas-element.js';
import type { WebGLRenderingContext as OurWebGLRenderingContext } from './webgl-rendering-context.js';

// Public callback type uses globalThis.HTMLCanvasElement (lib.dom) so callers can pass the
// canvas directly to WebGL demos that type their canvas parameter as HTMLCanvasElement.
// Internally _canvas is OurHTMLCanvasElement and is cast at the API boundary.
type WebGLReadyCallback = (canvas: globalThis.HTMLCanvasElement, gl: globalThis.WebGLRenderingContext) => void;

/**
 * A `Gtk.GLArea` subclass that handles WebGL bootstrapping:
 * - Sets up OpenGL ES 3.2 context, depth buffer, stencil buffer
 * - Creates an `HTMLCanvasElement` wrapping the GLArea on first render
 * - Fires `onReady()` callbacks with (canvas, gl) once the context is available
 * - Provides `requestAnimationFrame()` backed by GLib.idle_add + render signal
 * - `installGlobals()` sets `globalThis.requestAnimationFrame` to use this widget
 *
 * Usage:
 * ```ts
 * const widget = new CanvasWebGLWidget();
 * widget.installGlobals();  // sets globalThis.requestAnimationFrame
 * widget.onReady((canvas, gl) => {
 *     gl.clearColor(0, 0, 0, 1);
 *     // requestAnimationFrame is now available globally
 * });
 * window.set_child(widget);
 * ```
 */
export const CanvasWebGLWidget = GObject.registerClass(
    { GTypeName: 'GjsifyCanvasWebGLWidget' },
    class CanvasWebGLWidget extends Gtk.GLArea {
        _canvas: OurHTMLCanvasElement | null = null;
        _readyCallbacks: WebGLReadyCallback[] = [];
        _renderTag: number | null = null;
        _idleTag: number | null = null;
        _frameCallback: FrameRequestCallback | null = null;

        constructor(params?: Partial<Gtk.GLArea.ConstructorProps>) {
            super(params);
            this.set_use_es(true);
            this.set_required_version(3, 2);
            this.set_has_depth_buffer(true);
            this.set_has_stencil_buffer(true);

            // Initialize canvas on first render
            const initId = this.connect('render', () => {
                this.disconnect(initId);
                this.make_current();
                this._canvas = new OurHTMLCanvasElement(this);
                const gl = this._canvas.getContext('webgl') as OurWebGLRenderingContext | null;
                if (gl) {
                    for (const cb of this._readyCallbacks) {
                        cb(this._canvas as unknown as globalThis.HTMLCanvasElement, gl as unknown as globalThis.WebGLRenderingContext);
                    }
                    this._readyCallbacks = [];
                }
                return true;
            });

            this.connect('unrealize', () => {
                if (this._renderTag !== null) {
                    this.disconnect(this._renderTag);
                    this._renderTag = null;
                }
                if (this._idleTag !== null) {
                    GLib.source_remove(this._idleTag);
                    this._idleTag = null;
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
         * Schedules a single animation frame callback, matching the browser `requestAnimationFrame` API.
         * Backed by GLib.idle_add + the GLArea render signal.
         * Returns 0 (handle — cancel not yet implemented).
         */
        requestAnimationFrame(cb: FrameRequestCallback): number {
            this._frameCallback = cb;
            if (this._idleTag === null) {
                this._idleTag = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._idleTag = null;
                    if (this._renderTag === null) {
                        this._renderTag = this.connect('render', () => {
                            this.disconnect(this._renderTag!);
                            this._renderTag = null;
                            const time = GLib.get_monotonic_time() / 1000;
                            this._frameCallback?.(time);
                            return true;
                        });
                    }
                    this.queue_render();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return 0;
        }

        /**
         * Sets `globalThis.requestAnimationFrame` to use this widget.
         * Call this once after creating the widget and before running WebGL code
         * that relies on the browser `requestAnimationFrame` global.
         */
        installGlobals(): void {
            (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
                this.requestAnimationFrame(cb);
        }
    }
);

// Export the instance type so callers can type-annotate their CanvasWebGLWidget variables
export type CanvasWebGLWidget = InstanceType<typeof CanvasWebGLWidget>;
