// HTMLAudioElement — format detection + basic playback via GStreamer playbin.
// Used by Excalibur.js for canPlayType() format sniffing.
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLAudioElement

import { ensureGstInit, Gst } from './gst-init.js';
import { stopPipeline, trackPipeline } from './gst-teardown.js';
import type Gst1 from '@girs/gst-1.0';

// GStreamer-supported MIME types (common on GNOME systems)
const SUPPORTED_TYPES = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/webm',
    'audio/flac',
    'audio/x-flac',
    'audio/aac',
    'audio/mp4',
]);

export class HTMLAudioElement {
    src = '';
    volume = 1;
    loop = false;
    paused = true;
    currentTime = 0;
    duration = 0;
    readyState = 0;

    private _pipeline: Gst1.Element | null = null;

    canPlayType(type: string): CanPlayTypeResult {
        // Strip codecs parameter: "audio/ogg; codecs=vorbis" → "audio/ogg"
        const mime = type.split(';')[0].trim().toLowerCase();
        return SUPPORTED_TYPES.has(mime) ? 'maybe' : '';
    }

    play(): Promise<void> {
        if (!this.src) return Promise.resolve();

        ensureGstInit();
        this._cleanup();

        this._pipeline = Gst.ElementFactory.make('playbin', 'player');
        if (!this._pipeline) return Promise.resolve();

        // Registered so a quit while playing still reaches NULL — an element
        // disposed in PLAYING is a GStreamer-CRITICAL per element.
        trackPipeline(this._pipeline);
        this._pipeline.set_property('uri', this.src);
        this._pipeline.set_property('volume', this.volume);
        this._pipeline.set_state(Gst.State.PLAYING);
        this.paused = false;

        return Promise.resolve();
    }

    pause(): void {
        if (this._pipeline) {
            this._pipeline.set_state(Gst.State.PAUSED);
            this.paused = true;
        }
    }

    load(): void {
        this._cleanup();
    }

    addEventListener(_type: string, _listener: ((event: Event) => void) | null): void {}
    removeEventListener(_type: string, _listener: ((event: Event) => void) | null): void {}

    private _cleanup(): void {
        if (this._pipeline) {
            stopPipeline(this._pipeline);
            this._pipeline = null;
        }
    }
}
