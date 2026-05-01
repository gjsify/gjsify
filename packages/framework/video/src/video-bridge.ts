// VideoBridge — GTK container that bridges HTMLVideoElement to GStreamer video.
// Gtk.Box → Gtk.Overlay → (Gtk.Picture + optional control bar).
// Controls float over the video (valign=END), start hidden, reveal on mouse
// motion, and auto-hide after 2s of inactivity like browser video players.
//
// Reference: refs/showtime/showtime/play.py (gtk4paintablesink + glsinkbin).
// Pattern follows packages/dom/canvas2d/src/canvas-drawing-area.ts.

import GObject from 'gi://GObject';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import type Gst from 'gi://Gst?version=1.0';
import { attachEventControllers } from '@gjsify/event-bridge';
import { Event } from '@gjsify/dom-events';
import { BridgeEnvironment } from '@gjsify/bridge-types';
import type { BridgeWindowHost } from '@gjsify/bridge-types';

import { HTMLVideoElement } from '@gjsify/dom-elements';
import { buildMediaStreamPipeline, buildUriPipeline } from './pipeline-builder.js';
import { Gst as GstRuntime } from './gst-init.js';

type VideoReadyCallback = (video: globalThis.HTMLVideoElement) => void;

type GstSourceTrack = MediaStreamTrack & {
    _gstSource?: unknown;
    _gstPipeline?: unknown;
    _gstTee?: unknown;
};

const PLAY_ICON = 'media-playback-start-symbolic';
const PAUSE_ICON = 'media-playback-pause-symbolic';
const AUTO_HIDE_SECONDS = 2;
const POSITION_TICK_MS = 200;

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || isNaN(seconds)) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * A `Gtk.Box` subclass that hosts a `Gtk.Picture` for video rendering.
 *
 * - Owns an `HTMLVideoElement` whose DOM API is wired to GStreamer
 * - Renders video via `gtk4paintablesink` → `Gdk.Paintable` → `Gtk.Picture`
 * - Supports `video.srcObject = mediaStream` (getUserMedia / WebRTC)
 * - Supports `video.src = 'file://…'` or HTTP URL (URI playback via playbin)
 * - `onReady(cb)` fires with the HTMLVideoElement when the widget realizes
 * - `showControls(true)` appends a play/pause + seek + time + volume bar
 *
 * ```ts
 * const bridge = new VideoBridge();
 * bridge.showControls(true);
 * bridge.onReady((video) => { video.src = 'https://example.com/video.mp4'; });
 * window.set_child(bridge);
 * ```
 */
export const VideoBridge = GObject.registerClass(
    { GTypeName: 'GjsifyVideoBridge' },
    class VideoBridge extends Gtk.Box {
        // GObject.registerClass produces an anonymous class, so TS requires that fields
        // referenced from the InstanceType alias be non-private. Prefixed with `_` as the
        // convention for "implementation detail, not meant for external use".
        _overlay: Gtk.Overlay;
        _picture: Gtk.Picture;
        _video: HTMLVideoElement;
        _environment: BridgeEnvironment;
        _timeOrigin: number = GLib.get_monotonic_time();
        _pipeline: Gst.Pipeline | null = null;
        // Bus associated with _pipeline; stored so `_destroyPipeline` can
        // disconnect the handlers + `remove_signal_watch` before the pipeline
        // is nulled. Without cleanup, changing `video.src` repeatedly
        // accumulates handler connections on each pipeline's bus.
        _pipelineBus: Gst.Bus | null = null;
        _pipelineBusHandlers: number[] = [];
        _readyCallbacks: VideoReadyCallback[] = [];
        _resizeCallbacks: ((w: number, h: number) => void)[] = [];
        _ready = false;

        // Control bar + its per-tick change-detection state (null when
        // showControls(false) or never called). Keeping _lastSeekValue /
        // _lastTimeText on the same object lets them live and die with the
        // controls; no separate reset needed.
        _controls: {
            bar: Gtk.Box;
            playBtn: Gtk.Button;
            seekAdj: Gtk.Adjustment;
            seekScale: Gtk.Scale;
            timeLabel: Gtk.Label;
            volumeBtn: Gtk.VolumeButton;
            lastSeekValue: number;
            lastTimeText: string;
        } | null = null;
        _positionTimerId: number | null = null;
        // change-value on seekScale fires on user interaction only; the guard prevents
        // programmatic set_value from bouncing through the signal on some compositors.
        _updatingFromTimer = false;
        // Auto-hide: a single re-armed GLib source. Mouse motion re-starts the
        // 2s timer by removing and re-adding, so we never pile up pending sources.
        _hideTimerId: number | null = null;

        constructor(params?: Partial<Gtk.Box.ConstructorProps>) {
            super({ ...params, orientation: Gtk.Orientation.VERTICAL });

            this._overlay = new Gtk.Overlay({ hexpand: true, vexpand: true });
            this.append(this._overlay);

            this._picture = new Gtk.Picture({ hexpand: true, vexpand: true });
            this._overlay.set_child(this._picture);

            this._video = new HTMLVideoElement();

            const host: BridgeWindowHost = {
                performanceNow: () => (GLib.get_monotonic_time() - this._timeOrigin) / 1000,
                getWidth: () => this.get_allocated_width(),
                getHeight: () => this.get_allocated_height(),
                getDevicePixelRatio: () => this.get_native()?.get_surface()?.get_scale_factor() ?? 1,
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
                if (width === lastWidth && height === lastHeight) return;
                lastWidth = width;
                lastHeight = height;
                this._video.dispatchEvent(new Event('resize'));
                for (const cb of this._resizeCallbacks) cb(width, height);
            };
            this.connect('notify::width-request', checkResize);
            this.connect('notify::height-request', checkResize);
            this.connect('map', checkResize);

            this.connect('unrealize', () => {
                this._destroyPipeline();
                this._stopPositionTimer();
                this._resizeCallbacks = [];
            });
        }

        get element(): HTMLVideoElement { return this._video; }
        get videoElement(): HTMLVideoElement { return this._video; }
        get environment(): BridgeEnvironment { return this._environment; }

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
            (globalThis as { HTMLVideoElement?: unknown }).HTMLVideoElement = HTMLVideoElement;

            if (typeof (globalThis as { performance?: unknown }).performance === 'undefined') {
                const timeOrigin = this._timeOrigin;
                (globalThis as { performance?: unknown }).performance = {
                    now: () => (GLib.get_monotonic_time() - timeOrigin) / 1000,
                    timeOrigin: Date.now(),
                };
            }
        }

        /**
         * Show or hide the built-in play/pause + seek + time + volume control bar.
         * Controls auto-hide after 2 seconds of mouse inactivity.
         */
        showControls(show = true): void {
            if (show && !this._controls) {
                this._controls = this._buildControlBar();
                const { bar } = this._controls;
                bar.set_halign(Gtk.Align.FILL);
                bar.set_valign(Gtk.Align.END);
                bar.set_visible(false);
                this._overlay.add_overlay(bar);
                this._startPositionTimer();
                this._setupAutoHideMotion(bar);
            } else if (!show && this._controls) {
                this._overlay.remove_overlay(this._controls.bar);
                this._controls = null;
                this._stopPositionTimer();
                if (this._hideTimerId !== null) {
                    GLib.Source.remove(this._hideTimerId);
                    this._hideTimerId = null;
                }
            }
        }

        _setupAutoHideMotion(controlBar: Gtk.Box): void {
            for (const widget of [this, controlBar] as const) {
                const motion = new Gtk.EventControllerMotion();
                motion.connect('motion', () => this._revealControls());
                motion.connect('enter', () => this._revealControls());
                widget.add_controller(motion);
            }
        }

        _revealControls(): void {
            if (!this._controls) return;
            this._controls.bar.set_visible(true);
            if (this._hideTimerId !== null) GLib.Source.remove(this._hideTimerId);
            this._hideTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, AUTO_HIDE_SECONDS, () => {
                this._hideTimerId = null;
                this._controls?.bar.set_visible(false);
                return GLib.SOURCE_REMOVE;
            });
        }

        _buildControlBar(): NonNullable<VideoBridge['_controls']> {
            const bar = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                margin_start: 6,
                margin_end: 6,
                margin_top: 4,
                margin_bottom: 4,
            });
            // OSD class: semi-transparent dark background for legibility over video.
            bar.add_css_class('osd');

            const playBtn = new Gtk.Button({ icon_name: PAUSE_ICON });
            playBtn.connect('clicked', () => {
                if (this._video.paused) {
                    this._video.play();
                    playBtn.set_icon_name(PAUSE_ICON);
                } else {
                    this._video.pause();
                    playBtn.set_icon_name(PLAY_ICON);
                }
            });
            bar.append(playBtn);

            const seekAdj = new Gtk.Adjustment({ lower: 0, upper: 1, step_increment: 1, page_increment: 10 });
            const seekScale = Gtk.Scale.new(Gtk.Orientation.HORIZONTAL, seekAdj);
            seekScale.set_hexpand(true);
            seekScale.set_draw_value(false);
            seekScale.connect('change-value', (_scale, _scroll, value) => {
                if (!this._updatingFromTimer && isFinite(value)) {
                    this._video.currentTime = value;
                }
                return false;
            });
            bar.append(seekScale);

            const timeLabel = new Gtk.Label({ label: '--:-- / --:--', use_markup: false });
            bar.append(timeLabel);

            const volumeBtn = new Gtk.VolumeButton({ value: 1.0 });
            volumeBtn.connect('value-changed', (_btn, value) => { this._video.volume = value; });
            bar.append(volumeBtn);

            return { bar, playBtn, seekAdj, seekScale, timeLabel, volumeBtn, lastSeekValue: NaN, lastTimeText: '' };
        }

        _startPositionTimer(): void {
            if (this._positionTimerId !== null) return;
            this._positionTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POSITION_TICK_MS, () => {
                const controls = this._controls;
                if (!controls) return GLib.SOURCE_REMOVE;

                const cur = this._video.currentTime;
                const dur = this._video.duration;

                if (isFinite(dur) && dur > 0) {
                    if (controls.seekAdj.upper !== dur) controls.seekAdj.upper = dur;
                    if (cur !== controls.lastSeekValue) {
                        this._updatingFromTimer = true;
                        controls.seekAdj.set_value(cur);
                        this._updatingFromTimer = false;
                        controls.lastSeekValue = cur;
                    }
                }

                const text = `${formatTime(cur)} / ${formatTime(dur)}`;
                if (text !== controls.lastTimeText) {
                    controls.timeLabel.set_label(text);
                    controls.lastTimeText = text;
                }

                const icon = this._video.paused ? PLAY_ICON : PAUSE_ICON;
                if (controls.playBtn.get_icon_name() !== icon) controls.playBtn.set_icon_name(icon);

                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopPositionTimer(): void {
            if (this._positionTimerId !== null) {
                GLib.Source.remove(this._positionTimerId);
                this._positionTimerId = null;
            }
        }

        _onSrcObjectChange(): void {
            this._destroyPipeline();

            const stream = this._video.srcObject;
            if (!stream) return;

            const tracks = stream.getVideoTracks?.() as GstSourceTrack[] | undefined ?? [];
            const track = tracks.find((t) => t._gstSource != null);
            if (!track?._gstSource) {
                console.warn('VideoBridge: MediaStream has no video track with GStreamer source');
                return;
            }

            try {
                const { pipeline, paintable, tee } = buildMediaStreamPipeline(track._gstSource, track._gstPipeline);
                this._attachPipeline(pipeline, paintable);
                track._gstPipeline = pipeline;
                track._gstTee = tee;
            } catch (err) {
                console.error('VideoBridge: Failed to build MediaStream pipeline:', err);
            }
        }

        _onSrcChange(): void {
            this._destroyPipeline();
            if (!this._video.src) return;

            try {
                const { pipeline, paintable } = buildUriPipeline(this._video.src);
                this._attachPipeline(pipeline, paintable);
            } catch (err) {
                console.error('VideoBridge: Failed to build URI pipeline:', err);
            }
        }

        _attachPipeline(pipeline: Gst.Pipeline, paintable: Parameters<Gtk.Picture['set_paintable']>[0]): void {
            this._pipeline = pipeline;
            this._video._pipeline = pipeline;
            this._picture.set_paintable(paintable);

            // Bus watch surfaces pipeline errors and warnings (missing decoder,
            // http source failure, missing plugin, etc.). Without this, playbin
            // can fail to preroll and sit silently in READY forever. Handler
            // ids + bus are stashed on the instance so `_destroyPipeline` can
            // disconnect them — otherwise each pipeline swap (new video.src)
            // leaks a set of signal handlers on the freed bus.
            const bus = pipeline.get_bus();
            if (bus) {
                bus.add_signal_watch();
                this._pipelineBus = bus;
                this._pipelineBusHandlers = [
                    bus.connect('message::error', (_b, msg) => {
                        const [err, debug] = msg.parse_error();
                        console.error(`VideoBridge pipeline error: ${err?.message ?? 'unknown'} (${debug ?? ''})`);
                        this._video.dispatchEvent(new Event('error'));
                    }),
                    bus.connect('message::warning', (_b, msg) => {
                        const [err, debug] = msg.parse_warning();
                        console.warn(`VideoBridge pipeline warning: ${err?.message ?? 'unknown'} (${debug ?? ''})`);
                    }),
                ];
            }

            const ret = pipeline.set_state(GstRuntime.State.PLAYING);
            if (ret === GstRuntime.StateChangeReturn.FAILURE) {
                console.error('VideoBridge: pipeline state change to PLAYING failed');
            }
            this._video.readyState = 4;
            this._video.dispatchEvent(new Event('loadedmetadata'));
            this._video.dispatchEvent(new Event('canplay'));
            this._video.dispatchEvent(new Event('playing'));
        }

        _destroyPipeline(): void {
            if (this._pipelineBus) {
                for (const id of this._pipelineBusHandlers) {
                    try { this._pipelineBus.disconnect(id); } catch { /* ignore */ }
                }
                try { this._pipelineBus.remove_signal_watch(); } catch { /* ignore */ }
                this._pipelineBus = null;
                this._pipelineBusHandlers = [];
            }
            if (this._pipeline) {
                try { this._pipeline.set_state(GstRuntime.State.NULL); } catch { /* ignore */ }
                this._pipeline = null;
                this._video._pipeline = null;
            }
            this._picture.set_paintable(null);
        }
    },
);

export type VideoBridge = InstanceType<typeof VideoBridge>;
