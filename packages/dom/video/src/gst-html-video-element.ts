// GstHTMLVideoElement — HTMLVideoElement subclass wired to a GStreamer pipeline.
// All base classes (HTMLVideoElement → HTMLMediaElement → HTMLElement → Node)
// are plain JavaScript classes with no GObject.registerClass, so subclassing
// works without any GTK registration.
//
// HTMLMediaElement defines paused/currentTime/duration/volume/muted as plain
// class fields. TypeScript forbids overriding a field with an accessor, so we
// use Object.defineProperty in the constructor to replace them with descriptors
// that delegate to GStreamer. play() and pause() are plain methods — those are
// overridden directly.
//
// Harmonisation with WebRTC/MediaStream pipelines:
//   - volume/muted: no-op when no playbin (live streams)
//   - duration:     NaN for live streams (correct HTML behaviour)
//   - currentTime:  query_position works for all pipeline types

import { HTMLVideoElement } from '@gjsify/dom-elements';
import { Event } from '@gjsify/dom-events';
import { Gst } from './gst-init.js';

export class GstHTMLVideoElement extends HTMLVideoElement {
    /** Set by VideoBridge after every pipeline swap. Null when no media is loaded. */
    _pipeline: any | null = null;  // Gst.Pipeline

    constructor() {
        super();

        // Override plain fields from HTMLMediaElement with GStreamer-backed descriptors.
        // We define them on the instance so prototype chain lookups still work.
        const self = this;

        Object.defineProperty(this, 'paused', {
            get(): boolean {
                if (!self._pipeline) return true;
                const [, state] = self._pipeline.get_state(0n);
                return state !== Gst.State.PLAYING;
            },
            set(_v: boolean) { /* driven by play()/pause() */ },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'currentTime', {
            get(): number {
                if (!self._pipeline) return 0;
                const [ok, pos] = self._pipeline.query_position(Gst.Format.TIME);
                return ok ? Number(pos) / 1_000_000_000 : 0;
            },
            set(seconds: number) {
                if (!self._pipeline) return;
                self._pipeline.seek(
                    1.0,
                    Gst.Format.TIME,
                    Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                    Gst.SeekType.SET,
                    BigInt(Math.round(seconds * 1_000_000_000)),
                    Gst.SeekType.NONE,
                    -1n,
                );
            },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'duration', {
            get(): number {
                if (!self._pipeline) return NaN;
                const [ok, dur] = self._pipeline.query_duration(Gst.Format.TIME);
                return ok && Number(dur) > 0 ? Number(dur) / 1_000_000_000 : NaN;
            },
            set(_v: number) { /* read-only in GStreamer */ },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'volume', {
            get(): number {
                return (self._playbin() as any)?.volume ?? 1.0;
            },
            set(v: number) {
                const pb = self._playbin();
                if (pb) (pb as any).volume = Math.max(0, Math.min(1, v));
            },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'muted', {
            get(): boolean {
                return (self._playbin() as any)?.mute ?? false;
            },
            set(v: boolean) {
                const pb = self._playbin();
                if (pb) (pb as any).mute = v;
            },
            configurable: true,
            enumerable: true,
        });
    }

    override async play(): Promise<void> {
        this._pipeline?.set_state(Gst.State.PLAYING);
        this.dispatchEvent(new Event('play'));
        this.dispatchEvent(new Event('playing'));
    }

    override pause(): void {
        this._pipeline?.set_state(Gst.State.PAUSED);
        this.dispatchEvent(new Event('pause'));
    }

    private _playbin(): any | null {
        return this._pipeline?.get_by_name?.('playbin') ?? null;
    }
}
