// HTMLVideoElement for GJS — video element with optional GStreamer pipeline wiring.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement
//
// The attached pipeline is set by VideoBridge after each swap. Types come from
// a type-only Gst import so dom-elements has no runtime dependency on GStreamer
// (mirrors the HTMLImageElement / GdkPixbuf split). Numeric enum values are
// still used at runtime because pulling the Gst module eagerly would break the
// "dom-elements works without gst-init" contract.

import type Gst from '@girs/gst-1.0';
import { HTMLMediaElement } from './html-media-element.js';
import { Event } from '@gjsify/dom-events';
import * as PropertySymbol from './property-symbol.js';
import { NamespaceURI } from './namespace-uri.js';
import { secondsToGstTime, gstTimeToSeconds } from './gst-time.js';

// Gst.State / Gst.Format / Gst.SeekFlags / Gst.SeekType numeric values, hardcoded
// to avoid a runtime `gi://Gst` import. Cross-checked against the GStreamer GIR.
const GST_STATE_PLAYING = 4;
const GST_STATE_PAUSED  = 3;
const GST_FORMAT_TIME        = 3;
const GST_SEEK_FLAG_FLUSH    = 1;
const GST_SEEK_FLAG_KEY_UNIT = 4;
const GST_SEEK_TYPE_SET      = 1;
const GST_SEEK_TYPE_NONE     = 0;

type Playbin = Gst.Element & { volume?: number; mute?: boolean };

/**
 * HTML Video Element.
 *
 * Dispatches 'srcobjectchange' when srcObject is set and 'srcchange' when src is set —
 * bridge containers listen for these to wire up / tear down their pipelines.
 *
 * When a GStreamer pipeline is attached via `_pipeline`, play/pause/seek/volume
 * delegate to it. Without a pipeline the element behaves as a pure DOM stub.
 */
export class HTMLVideoElement extends HTMLMediaElement {
    /** Set by VideoBridge after every pipeline swap. Null when no media is loaded. */
    _pipeline: Gst.Pipeline | null = null;

    private _videoWidth = 0;
    private _videoHeight = 0;
    poster = '';

    constructor() {
        super();
        this[PropertySymbol.tagName] = 'VIDEO';
        this[PropertySymbol.localName] = 'video';
        this[PropertySymbol.namespaceURI] = NamespaceURI.html;

        // HTMLMediaElement defines paused/currentTime/duration/volume/muted as plain
        // fields. TypeScript forbids overriding a field with an accessor in the
        // subclass, so we install GStreamer-backed descriptors via defineProperty.
        const self = this;

        Object.defineProperty(this, 'paused', {
            get(): boolean {
                if (!self._pipeline) return true;
                const [, state] = self._pipeline.get_state(0n);
                return state !== GST_STATE_PLAYING;
            },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'currentTime', {
            get(): number {
                if (!self._pipeline) return 0;
                const [ok, pos] = self._pipeline.query_position(GST_FORMAT_TIME);
                return ok ? gstTimeToSeconds(pos) : 0;
            },
            set(seconds: number) {
                self._pipeline?.seek(
                    1.0,
                    GST_FORMAT_TIME,
                    GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_KEY_UNIT,
                    GST_SEEK_TYPE_SET,
                    secondsToGstTime(seconds),
                    GST_SEEK_TYPE_NONE,
                    -1n,
                );
            },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'duration', {
            get(): number {
                if (!self._pipeline) return NaN;
                const [ok, dur] = self._pipeline.query_duration(GST_FORMAT_TIME);
                return ok && Number(dur) > 0 ? gstTimeToSeconds(dur) : NaN;
            },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'volume', {
            get(): number { return self._playbin()?.volume ?? 1.0; },
            set(v: number) {
                const pb = self._playbin();
                if (pb) pb.volume = Math.max(0, Math.min(1, v));
            },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'muted', {
            get(): boolean { return self._playbin()?.mute ?? false; },
            set(v: boolean) {
                const pb = self._playbin();
                if (pb) pb.mute = v;
            },
            configurable: true,
            enumerable: true,
        });
    }

    override async play(): Promise<void> {
        this._pipeline?.set_state(GST_STATE_PLAYING);
        this.dispatchEvent(new Event('play'));
        this.dispatchEvent(new Event('playing'));
    }

    override pause(): void {
        this._pipeline?.set_state(GST_STATE_PAUSED);
        this.dispatchEvent(new Event('pause'));
    }

    /** Intrinsic width of the video (set by bridge when media metadata loads). */
    get videoWidth(): number { return this._videoWidth; }
    set videoWidth(value: number) { this._videoWidth = value; }

    /** Intrinsic height of the video (set by bridge when media metadata loads). */
    get videoHeight(): number { return this._videoHeight; }
    set videoHeight(value: number) { this._videoHeight = value; }

    get [Symbol.toStringTag](): string { return 'HTMLVideoElement'; }

    private _playbin(): Playbin | null {
        return (this._pipeline?.get_by_name('playbin') as Playbin | null) ?? null;
    }
}
