// VideoBridge GTK container for GJS — Gtk.Box wrapping Gtk.Picture + gtk4paintablesink.
// Bridges GstHTMLVideoElement to GStreamer video rendering via Gdk.Paintable.
//
// Reference: refs/showtime/showtime/play.py (gtk4paintablesink + optional glsinkbin)
// Pattern follows packages/dom/canvas2d/src/canvas-drawing-area.ts (Canvas2DBridge)

import GObject from 'gi://GObject';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { attachEventControllers } from '@gjsify/event-bridge';
import { Event } from '@gjsify/dom-events';
import { BridgeEnvironment } from '@gjsify/bridge-types';
import type { BridgeWindowHost } from '@gjsify/bridge-types';

import { buildMediaStreamPipeline, buildUriPipeline } from './pipeline-builder.js';
import { GstHTMLVideoElement } from './gst-html-video-element.js';
import { Gst } from './gst-init.js';

type VideoReadyCallback = (video: globalThis.HTMLVideoElement) => void;

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || isNaN(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * A `Gtk.Box` subclass that hosts a `Gtk.Picture` for video rendering:
 * - Creates a `GstHTMLVideoElement` on construction (DOM API wired to GStreamer)
 * - Renders video via GStreamer `gtk4paintablesink` → `Gdk.Paintable` → `Gtk.Picture`
 * - Supports `video.srcObject = mediaStream` (from getUserMedia/WebRTC)
 * - Supports `video.src = "file:///..."` or HTTP URL (URI playback via playbin)
 * - Fires `onReady()` callbacks with the HTMLVideoElement
 * - `showControls(true)` appends a play/pause + seek + time + volume control bar
 *
 * Usage:
 * ```ts
 * const bridge = new VideoBridge();
 * bridge.showControls(true);
 * bridge.onReady((video) => {
 *     video.src = 'https://example.com/video.mp4';
 * });
 * window.set_child(bridge);
 * ```
 */
export const VideoBridge = GObject.registerClass(
    { GTypeName: 'GjsifyVideoBridge' },
    class VideoBridge extends Gtk.Box {
        _picture: Gtk.Picture;
        _video: GstHTMLVideoElement;
        _pipeline: any | null = null;  // Gst.Pipeline
        _readyCallbacks: VideoReadyCallback[] = [];
        _resizeCallbacks: ((w: number, h: number) => void)[] = [];
        _environment: BridgeEnvironment;
        _timeOrigin: number = GLib.get_monotonic_time();
        _ready = false;

        // Controls
        _controlBar: Gtk.Box | null = null;
        _playBtn: Gtk.Button | null = null;
        _seekAdj: Gtk.Adjustment | null = null;
        _seekScale: Gtk.Scale | null = null;
        _timeLabel: Gtk.Label | null = null;
        _volumeBtn: Gtk.VolumeButton | null = null;
        _positionTimerId: number | null = null;
        _updatingFromTimer = false;
        // Auto-hide: timestamp of last mouse motion; timer compares against it to debounce.
        _lastReveal = 0;
        _autoHide = false;

        constructor(params?: Partial<Gtk.Box.ConstructorProps>) {
            super({
                ...params,
                orientation: Gtk.Orientation.VERTICAL,
            });

            this._picture = new Gtk.Picture();
            this._picture.set_hexpand(true);
            this._picture.set_vexpand(true);
            this.append(this._picture);

            // GstHTMLVideoElement: DOM API (play/pause/currentTime/duration/volume)
            // delegates to the GStreamer pipeline set via _video._pipeline.
            this._video = new GstHTMLVideoElement();

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

            attachEventControllers(this, () => this._video);

            this._video.addEventListener('srcobjectchange', () => this._onSrcObjectChange());
            this._video.addEventListener('srcchange', () => this._onSrcChange());

            this.connect('realize', () => {
                if (this._ready) return;
                this._ready = true;
                for (const cb of this._readyCallbacks) {
                    cb(this._video as unknown as globalThis.HTMLVideoElement);
                }
                this._readyCallbacks = [];
            });

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
            this.connect('map', checkResize);

            this.connect('unrealize', () => {
                this._destroyPipeline();
                this._stopPositionTimer();
            });
        }

        get element(): GstHTMLVideoElement {
            return this._video;
        }

        get videoElement(): GstHTMLVideoElement {
            return this._video;
        }

        get environment(): BridgeEnvironment {
            return this._environment;
        }

        onReady(cb: VideoReadyCallback): void {
            if (this._ready) {
                cb(this._video as unknown as globalThis.HTMLVideoElement);
                return;
            }
            this._readyCallbacks.push(cb);
        }

        onResize(cb: (width: number, height: number) => void): void {
            this._resizeCallbacks.push(cb);
        }

        installGlobals(): void {
            (globalThis as any).HTMLVideoElement = GstHTMLVideoElement;

            const timeOrigin = this._timeOrigin;
            if (typeof (globalThis as any).performance === 'undefined') {
                (globalThis as any).performance = {
                    now: () => (GLib.get_monotonic_time() - timeOrigin) / 1000,
                    timeOrigin: Date.now(),
                };
            }
        }

        /**
         * Show or hide the built-in play/pause + seek + time + volume control bar.
         * Controls auto-hide after 2 seconds of mouse inactivity, like browser video players.
         * Inspired by refs/showtime/showtime/widgets/window.py.
         */
        showControls(show = true): void {
            if (show && !this._controlBar) {
                this._autoHide = true;
                this._controlBar = this._buildControlBar();
                // Start hidden; revealed on first mouse motion.
                this._controlBar.set_visible(false);
                this.append(this._controlBar);
                this._startPositionTimer();
                this._setupAutoHideMotion();
            } else if (!show && this._controlBar) {
                this.remove(this._controlBar);
                this._controlBar = null;
                this._playBtn = null;
                this._seekAdj = null;
                this._seekScale = null;
                this._timeLabel = null;
                this._volumeBtn = null;
                this._autoHide = false;
                this._stopPositionTimer();
            }
        }

        /** @internal Attach EventControllerMotion for auto-hide behavior. */
        _setupAutoHideMotion(): void {
            const motion = new Gtk.EventControllerMotion();
            // Reveal controls on any mouse movement over the bridge widget.
            motion.connect('motion', () => this._revealControls());
            motion.connect('enter', () => this._revealControls());
            this.add_controller(motion);

            // Also add a motion controller to the control bar so hovering it keeps it visible.
            const barMotion = new Gtk.EventControllerMotion();
            barMotion.connect('motion', () => this._revealControls());
            barMotion.connect('enter', () => this._revealControls());
            this._controlBar?.add_controller(barMotion);
        }

        /** @internal Show controls and schedule auto-hide after 2 s. */
        _revealControls(): void {
            if (!this._controlBar) return;
            this._controlBar.set_visible(true);
            const ts = ++this._lastReveal;
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                if (this._lastReveal === ts && this._controlBar) {
                    this._controlBar.set_visible(false);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        /** @internal Build the GTK control bar widgets */
        _buildControlBar(): Gtk.Box {
            const bar = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                margin_start: 6,
                margin_end: 6,
                margin_top: 4,
                margin_bottom: 4,
            });

            // Play/pause button
            this._playBtn = new Gtk.Button({ icon_name: 'media-playback-pause-symbolic' });
            this._playBtn.connect('clicked', () => {
                if (this._video.paused) {
                    this._video.play();
                    this._playBtn?.set_icon_name('media-playback-pause-symbolic');
                } else {
                    this._video.pause();
                    this._playBtn?.set_icon_name('media-playback-start-symbolic');
                }
            });
            bar.append(this._playBtn);

            // Seek scale: upper = duration in seconds (updated once known)
            this._seekAdj = new Gtk.Adjustment({ lower: 0, upper: 1, step_increment: 1, page_increment: 10 });
            this._seekScale = Gtk.Scale.new(Gtk.Orientation.HORIZONTAL, this._seekAdj);
            this._seekScale.set_hexpand(true);
            this._seekScale.set_draw_value(false);

            // change-value fires on user interaction; we guard against timer updates
            this._seekScale.connect('change-value', (_scale: Gtk.Scale, _scroll: Gtk.ScrollType, value: number) => {
                if (!this._updatingFromTimer && isFinite(value)) {
                    this._video.currentTime = value;
                }
                return false;
            });
            bar.append(this._seekScale);

            // Time label
            this._timeLabel = new Gtk.Label({ label: '--:-- / --:--' });
            (this._timeLabel as any).use_markup = false;
            bar.append(this._timeLabel);

            // Volume button (only meaningful for URI/playbin pipelines)
            this._volumeBtn = new Gtk.VolumeButton();
            (this._volumeBtn as any).value = 1.0;
            this._volumeBtn.connect('value-changed', (_btn: Gtk.VolumeButton, value: number) => {
                this._video.volume = value;
            });
            bar.append(this._volumeBtn);

            return bar;
        }

        /** @internal Update seek bar upper bound when a new pipeline is set */
        _syncControlsToNewPipeline(): void {
            if (!this._seekAdj) return;
            // Duration may not be known yet right after pipeline start;
            // the position timer will update it on the next tick.
        }

        /** @internal 200ms timer that updates seek position and time label */
        _startPositionTimer(): void {
            if (this._positionTimerId !== null) return;
            this._positionTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                if (!this._seekAdj || !this._timeLabel) return GLib.SOURCE_REMOVE;

                const cur = this._video.currentTime;
                const dur = this._video.duration;

                if (isFinite(dur) && dur > 0) {
                    // Update seek bar upper bound if duration just became known
                    if (this._seekAdj.upper !== dur) {
                        this._seekAdj.upper = dur;
                    }
                    this._updatingFromTimer = true;
                    this._seekAdj.set_value(cur);
                    this._updatingFromTimer = false;
                }

                this._timeLabel.set_label(`${formatTime(cur)} / ${formatTime(dur)}`);

                // Sync play/pause button icon
                if (this._playBtn) {
                    const icon = this._video.paused
                        ? 'media-playback-start-symbolic'
                        : 'media-playback-pause-symbolic';
                    if ((this._playBtn as any).icon_name !== icon) {
                        this._playBtn.set_icon_name(icon);
                    }
                }

                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopPositionTimer(): void {
            if (this._positionTimerId !== null) {
                GLib.Source.remove(this._positionTimerId);
                this._positionTimerId = null;
            }
        }

        /** @internal Handle srcObject change (MediaStream) */
        _onSrcObjectChange(): void {
            this._destroyPipeline();

            const stream = this._video.srcObject;
            if (!stream) return;

            const videoTracks = stream.getVideoTracks?.() ?? [];
            const track = videoTracks.find((t: any) => t._gstSource != null);
            if (!track?._gstSource) {
                console.warn('VideoBridge: MediaStream has no video track with GStreamer source');
                return;
            }

            try {
                const { pipeline, paintable, tee } = buildMediaStreamPipeline(track._gstSource, track._gstPipeline);
                this._pipeline = pipeline;
                this._video._pipeline = pipeline;
                this._picture.set_paintable(paintable);

                track._gstPipeline = pipeline;
                track._gstTee = tee;

                pipeline.set_state(Gst.State.PLAYING);

                this._video.readyState = 4;
                this._video.dispatchEvent(new Event('loadedmetadata'));
                this._video.dispatchEvent(new Event('canplay'));
                this._video.dispatchEvent(new Event('playing'));
                this._syncControlsToNewPipeline();
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
                this._video._pipeline = pipeline;
                this._picture.set_paintable(paintable);
                pipeline.set_state(Gst.State.PLAYING);

                this._video.readyState = 4;
                this._video.dispatchEvent(new Event('loadedmetadata'));
                this._video.dispatchEvent(new Event('canplay'));
                this._video.dispatchEvent(new Event('playing'));
                this._syncControlsToNewPipeline();
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
                this._video._pipeline = null;
            }
            this._picture.set_paintable(null);
        }
    },
);

export type VideoBridge = InstanceType<typeof VideoBridge>;
