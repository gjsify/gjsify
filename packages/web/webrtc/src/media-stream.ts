// W3C MediaStream for GJS.
//
// Pure-JS collection container for MediaStreamTrack instances.
// No GStreamer pipeline integration — that is Phase 2.5.
//
// Reference: refs/node-gst-webrtc/src/media/MediaStream.ts (ISC)
// Reference: W3C MediaStream spec

import '@gjsify/dom-events/register/event-target';

import GLib from 'gi://GLib?version=2.0';

import { MediaStreamTrack } from './media-stream-track.js';

export class MediaStream extends EventTarget {
    readonly id: string;
    private _tracks = new Map<string, MediaStreamTrack>();

    private _onaddtrack: ((ev: Event) => void) | null = null;
    private _onremovetrack: ((ev: Event) => void) | null = null;

    constructor(streamOrTracks?: MediaStream | MediaStreamTrack[]) {
        super();
        this.id = GLib.uuid_string_random();

        if (streamOrTracks instanceof MediaStream) {
            for (const track of streamOrTracks.getTracks()) {
                this._tracks.set(track.id, track.clone());
            }
        } else if (Array.isArray(streamOrTracks)) {
            for (const track of streamOrTracks) {
                this._tracks.set(track.id, track);
            }
        }
    }

    get active(): boolean {
        for (const track of this._tracks.values()) {
            if (track.readyState === 'live') return true;
        }
        return false;
    }

    get onaddtrack(): ((ev: Event) => void) | null { return this._onaddtrack; }
    set onaddtrack(v: ((ev: Event) => void) | null) { this._onaddtrack = v; }
    get onremovetrack(): ((ev: Event) => void) | null { return this._onremovetrack; }
    set onremovetrack(v: ((ev: Event) => void) | null) { this._onremovetrack = v; }

    getTracks(): MediaStreamTrack[] {
        return [...this._tracks.values()];
    }

    getAudioTracks(): MediaStreamTrack[] {
        return this.getTracks().filter((t) => t.kind === 'audio');
    }

    getVideoTracks(): MediaStreamTrack[] {
        return this.getTracks().filter((t) => t.kind === 'video');
    }

    getTrackById(id: string): MediaStreamTrack | null {
        return this._tracks.get(id) ?? null;
    }

    addTrack(track: MediaStreamTrack): void {
        if (this._tracks.has(track.id)) return;
        this._tracks.set(track.id, track);
        const ev = new MediaStreamTrackEvent('addtrack', { track });
        this._onaddtrack?.call(this, ev);
        this.dispatchEvent(ev);
    }

    removeTrack(track: MediaStreamTrack): void {
        if (!this._tracks.delete(track.id)) return;
        const ev = new MediaStreamTrackEvent('removetrack', { track });
        this._onremovetrack?.call(this, ev);
        this.dispatchEvent(ev);
    }

    clone(): MediaStream {
        return new MediaStream(this);
    }
}

export interface MediaStreamTrackEventInit extends EventInit {
    track: MediaStreamTrack;
}

export class MediaStreamTrackEvent extends Event {
    readonly track: MediaStreamTrack;

    constructor(type: string, init: MediaStreamTrackEventInit) {
        super(type, init);
        this.track = init.track;
    }
}
