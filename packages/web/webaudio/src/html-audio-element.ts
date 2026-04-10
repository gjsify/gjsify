// HTMLAudioElement — format detection + basic playback via GStreamer playbin.
// Used by Excalibur.js for canPlayType() format sniffing.
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLAudioElement

import { ensureGstInit, Gst } from './gst-init.js';

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

    private _pipeline: any = null;

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

    addEventListener(_type: string, _listener: any): void {}
    removeEventListener(_type: string, _listener: any): void {}

    private _cleanup(): void {
        if (this._pipeline) {
            this._pipeline.set_state(Gst.State.NULL);
            this._pipeline = null;
        }
    }
}
