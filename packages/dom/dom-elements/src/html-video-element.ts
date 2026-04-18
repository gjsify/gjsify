// HTMLVideoElement for GJS — video element with optional GStreamer pipeline wiring.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement
// Reference: refs/happy-dom/packages/happy-dom/src/nodes/html-media-element/HTMLMediaElement.ts
//
// _pipeline (any) is set by VideoBridge after each pipeline swap. GStreamer state
// is queried/controlled via numeric constants so that dom-elements has no static
// dependency on GStreamer. Mirrors the HTMLImageElement/GdkPixbuf pattern.
//
// TypeScript forbids overriding a class field with an accessor. We use
// Object.defineProperty in the constructor to replace HTMLMediaElement's plain
// fields (paused, currentTime, duration, volume, muted) with GStreamer-backed
// descriptors — same technique as GstHTMLVideoElement previously in @gjsify/video.

import { HTMLMediaElement } from './html-media-element.js';
import { Event } from '@gjsify/dom-events';
import * as PropertySymbol from './property-symbol.js';
import { NamespaceURI } from './namespace-uri.js';

// GStreamer state constants — values of Gst.State enum (avoids static gi:// import).
const GST_STATE_PLAYING = 4;
const GST_STATE_PAUSED  = 3;
// GStreamer format/seek constants
const GST_FORMAT_TIME        = 3;
const GST_SEEK_FLAG_FLUSH    = 1;
const GST_SEEK_FLAG_KEY_UNIT = 4;
const GST_SEEK_TYPE_SET      = 1;
const GST_SEEK_TYPE_NONE     = 0;

/**
 * HTML Video Element.
 *
 * Dispatches 'srcobjectchange' when srcObject is set (for bridge containers).
 * Dispatches 'srcchange' when src is set.
 *
 * When a GStreamer pipeline is attached via `_pipeline`, play/pause/seek/volume
 * delegate to it. Without a pipeline the element behaves as a pure DOM stub.
 */
export class HTMLVideoElement extends HTMLMediaElement {
    /** Set by VideoBridge after every pipeline swap. Null when no media is loaded. */
    _pipeline: any | null = null;  // Gst.Pipeline

    private _videoWidth = 0;
    private _videoHeight = 0;
    poster = '';

    constructor() {
        super();
        this[PropertySymbol.tagName] = 'VIDEO';
        this[PropertySymbol.localName] = 'video';
        this[PropertySymbol.namespaceURI] = NamespaceURI.html;

        // Override HTMLMediaElement plain fields with GStreamer-backed descriptors.
        const self = this;

        Object.defineProperty(this, 'paused', {
            get(): boolean {
                if (!self._pipeline) return true;
                const [, state] = self._pipeline.get_state(0n);
                return state !== GST_STATE_PLAYING;
            },
            set(_v: boolean) { /* driven by play()/pause() */ },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'currentTime', {
            get(): number {
                if (!self._pipeline) return 0;
                const [ok, pos] = self._pipeline.query_position(GST_FORMAT_TIME);
                return ok ? Number(pos) / 1_000_000_000 : 0;
            },
            set(seconds: number) {
                if (!self._pipeline) return;
                self._pipeline.seek(
                    1.0,
                    GST_FORMAT_TIME,
                    GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_KEY_UNIT,
                    GST_SEEK_TYPE_SET,
                    BigInt(Math.round(seconds * 1_000_000_000)),
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
                return ok && Number(dur) > 0 ? Number(dur) / 1_000_000_000 : NaN;
            },
            set(_v: number) { /* read-only */ },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'volume', {
            get(): number {
                return self._playbin()?.volume ?? 1.0;
            },
            set(v: number) {
                const pb = self._playbin();
                if (pb) pb.volume = Math.max(0, Math.min(1, v));
            },
            configurable: true,
            enumerable: true,
        });

        Object.defineProperty(this, 'muted', {
            get(): boolean {
                return self._playbin()?.mute ?? false;
            },
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

    private _playbin(): any | null {
        return this._pipeline?.get_by_name?.('playbin') ?? null;
    }
}
