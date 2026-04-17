// VideoBridge GTK container for GJS — Gtk.Box wrapping Gtk.Picture + gtk4paintablesink.
// Bridges HTMLVideoElement to GStreamer video rendering via Gdk.Paintable.
//
// Reference: refs/showtime/showtime/play.py (gtk4paintablesink + optional glsinkbin)
// Pattern follows packages/dom/canvas2d/src/canvas-drawing-area.ts (Canvas2DBridge)

import GObject from 'gi://GObject';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { HTMLVideoElement } from '@gjsify/dom-elements';
import { attachEventControllers } from '@gjsify/event-bridge';
import { Event } from '@gjsify/dom-events';
import { BridgeEnvironment } from '@gjsify/bridge-types';
import type { BridgeWindowHost } from '@gjsify/bridge-types';

import { buildMediaStreamPipeline, buildUriPipeline } from './pipeline-builder.js';
import { Gst } from './gst-init.js';

type VideoReadyCallback = (video: globalThis.HTMLVideoElement) => void;

/**
 * A `Gtk.Box` subclass that hosts a `Gtk.Picture` for video rendering:
 * - Creates an `HTMLVideoElement` on construction
 * - Renders video via GStreamer `gtk4paintablesink` → `Gdk.Paintable` → `Gtk.Picture`
 * - Supports `video.srcObject = mediaStream` (from getUserMedia/WebRTC)
 * - Supports `video.src = "file:///..."` (URI playback via playbin)
 * - Fires `onReady()` callbacks with the HTMLVideoElement
 * - `installGlobals()` sets `globalThis.HTMLVideoElement`
 *
 * Usage:
 * ```ts
 * const bridge = new VideoBridge();
 * bridge.installGlobals();
 * bridge.onReady((video) => {
 *     video.srcObject = mediaStream;  // from getUserMedia
 * });
 * window.set_child(bridge);
 * ```
 */
export const VideoBridge = GObject.registerClass(
    { GTypeName: 'GjsifyVideoBridge' },
    class VideoBridge extends Gtk.Box {
        _picture: Gtk.Picture;
        _video: HTMLVideoElement;
        _pipeline: any | null = null;  // Gst.Pipeline
        _readyCallbacks: VideoReadyCallback[] = [];
        _resizeCallbacks: ((w: number, h: number) => void)[] = [];
        _environment: BridgeEnvironment;
        _timeOrigin: number = GLib.get_monotonic_time();
        _ready = false;

        constructor(params?: Partial<Gtk.Box.ConstructorProps>) {
            super({
                ...params,
                orientation: Gtk.Orientation.VERTICAL,
            });

            this._picture = new Gtk.Picture();
            this._picture.set_hexpand(true);
            this._picture.set_vexpand(true);
            this.append(this._picture);

            // Create the DOM element
            this._video = new HTMLVideoElement();

            // Set up the bridge environment
            const host: BridgeWindowHost = {
                performanceNow: () => (GLib.get_monotonic_time() - this._timeOrigin) / 1000,
                getWidth: () => this.get_allocated_width(),
                getHeight: () => this.get_allocated_height(),
                getDevicePixelRatio: () => {
                    const display = this.get_display();
                    const surface = this.get_native()?.get_surface();
                    if (surface) return surface.get_scale_factor();
                    if (display) return (display as any).get_scale?.() ?? 1;
                    return 1;
                },
            };
            this._environment = new BridgeEnvironment(host);
            this._environment.document.body.appendChild(this._video);

            // Bridge GTK events → DOM events on the video element
            attachEventControllers(this, () => this._video);

            // Listen for srcObject / src changes on the HTMLVideoElement
            this._video.addEventListener('srcobjectchange', () => this._onSrcObjectChange());
            this._video.addEventListener('srcchange', () => this._onSrcChange());

            // Fire ready callbacks once the widget is realized
            this.connect('realize', () => {
                if (this._ready) return;
                this._ready = true;
                for (const cb of this._readyCallbacks) {
                    cb(this._video as unknown as globalThis.HTMLVideoElement);
                }
                this._readyCallbacks = [];
            });

            // Handle resize — Gtk.Box has no 'resize' signal (unlike DrawingArea/GLArea).
            // Use notify on allocation width/height instead.
            let lastWidth = 0;
            let lastHeight = 0;
            const checkResize = () => {
                const width = this.get_allocated_width();
                const height = this.get_allocated_height();
                if (width !== lastWidth || height !== lastHeight) {
                    lastWidth = width;
                    lastHeight = height;
                    this._video.dispatchEvent(new Event('resize'));
                    for (const cb of this._resizeCallbacks) {
                        cb(width, height);
                    }
                }
            };
            this.connect('notify::width-request', checkResize);
            this.connect('notify::height-request', checkResize);
            // Also check after the widget is mapped and sized
            this.connect('map', checkResize);

            // Cleanup on unrealize
            this.connect('unrealize', () => {
                this._destroyPipeline();
            });
        }

        /** The HTMLVideoElement backing this bridge. */
        get element(): HTMLVideoElement {
            return this._video;
        }

        /** Alias for element — matches browser naming. */
        get videoElement(): HTMLVideoElement {
            return this._video;
        }

        /** The isolated browser environment for this bridge. */
        get environment(): BridgeEnvironment {
            return this._environment;
        }

        /**
         * Register a callback to be invoked once the video element is ready.
         * If already ready, the callback fires synchronously.
         */
        onReady(cb: VideoReadyCallback): void {
            if (this._ready) {
                cb(this._video as unknown as globalThis.HTMLVideoElement);
                return;
            }
            this._readyCallbacks.push(cb);
        }

        /** Register a callback invoked whenever the widget is resized. */
        onResize(cb: (width: number, height: number) => void): void {
            this._resizeCallbacks.push(cb);
        }

        /** Sets browser globals for video support. */
        installGlobals(): void {
            (globalThis as any).HTMLVideoElement = HTMLVideoElement;

            const timeOrigin = this._timeOrigin;
            if (typeof (globalThis as any).performance === 'undefined') {
                (globalThis as any).performance = {
                    now: () => (GLib.get_monotonic_time() - timeOrigin) / 1000,
                    timeOrigin: Date.now(),
                };
            }
        }

        /** @internal Handle srcObject change (MediaStream) */
        _onSrcObjectChange(): void {
            this._destroyPipeline();

            const stream = this._video.srcObject;
            if (!stream) return;

            // Find the first video track with a GStreamer source
            const videoTracks = stream.getVideoTracks?.() ?? [];
            const track = videoTracks.find((t: any) => t._gstSource != null);
            if (!track?._gstSource) {
                console.warn('VideoBridge: MediaStream has no video track with GStreamer source');
                return;
            }

            try {
                const { pipeline, paintable } = buildMediaStreamPipeline(track._gstSource, track._gstPipeline);
                this._pipeline = pipeline;
                this._picture.set_paintable(paintable);
                pipeline.set_state(Gst.State.PLAYING);

                this._video.readyState = 4; // HAVE_ENOUGH_DATA
                this._video.paused = false;
                this._video.dispatchEvent(new Event('loadedmetadata'));
                this._video.dispatchEvent(new Event('canplay'));
                this._video.dispatchEvent(new Event('playing'));
            } catch (err) {
                console.error('VideoBridge: Failed to build MediaStream pipeline:', err);
            }
        }

        /** @internal Handle src change (URI) */
        _onSrcChange(): void {
            this._destroyPipeline();

            const src = this._video.src;
            if (!src) return;

            try {
                const { pipeline, paintable } = buildUriPipeline(src);
                this._pipeline = pipeline;
                this._picture.set_paintable(paintable);
                pipeline.set_state(Gst.State.PLAYING);

                this._video.readyState = 4;
                this._video.paused = false;
                this._video.dispatchEvent(new Event('loadedmetadata'));
                this._video.dispatchEvent(new Event('canplay'));
                this._video.dispatchEvent(new Event('playing'));
            } catch (err) {
                console.error('VideoBridge: Failed to build URI pipeline:', err);
            }
        }

        /** @internal Tear down the GStreamer pipeline */
        _destroyPipeline(): void {
            if (this._pipeline) {
                try {
                    this._pipeline.set_state(Gst.State.NULL);
                } catch { /* ignore */ }
                this._pipeline = null;
            }
            this._picture.set_paintable(null);
        }
    },
);

export type VideoBridge = InstanceType<typeof VideoBridge>;
