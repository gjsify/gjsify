// W3C MediaStreamTrack stub for GJS.
//
// Phase 2: lightweight API surface only — no GStreamer pipeline integration.
// The track holds properties (kind, label, enabled, muted, readyState) and
// dispatches events, but does not connect to any GStreamer elements.
// Pipeline plumbing (decodebin, tee, proxysink) is deferred to Phase 2.5.
//
// Reference: refs/node-gst-webrtc/src/media/MediaStreamTrack.ts (ISC)
// Reference: W3C MediaStreamTrack spec

import '@gjsify/dom-events/register/event-target';

import GLib from 'gi://GLib?version=2.0';

export interface MediaStreamTrackInit {
    kind: 'audio' | 'video';
    label?: string;
    id?: string;
    muted?: boolean;
}

export class MediaStreamTrack extends EventTarget {
    readonly id: string;
    readonly kind: 'audio' | 'video';
    readonly label: string;

    private _enabled = true;
    private _muted: boolean;
    private _ended = false;
    private _contentHint = '';

    private _onended: ((ev: Event) => void) | null = null;
    private _onmute: ((ev: Event) => void) | null = null;
    private _onunmute: ((ev: Event) => void) | null = null;

    constructor(init: MediaStreamTrackInit) {
        super();
        this.id = init.id ?? GLib.uuid_string_random();
        this.kind = init.kind;
        this.label = init.label ?? '';
        this._muted = init.muted ?? false;
    }

    get enabled(): boolean { return this._enabled; }
    set enabled(v: boolean) { this._enabled = !!v; }

    get muted(): boolean { return this._muted; }

    get readyState(): 'live' | 'ended' { return this._ended ? 'ended' : 'live'; }

    get contentHint(): string { return this._contentHint; }
    set contentHint(v: string) {
        if (this.kind === 'audio') {
            if (v !== '' && v !== 'speech' && v !== 'speech-recognition' && v !== 'music') return;
        } else {
            if (v !== '' && v !== 'motion' && v !== 'detail' && v !== 'text') return;
        }
        this._contentHint = v;
    }

    get onended(): ((ev: Event) => void) | null { return this._onended; }
    set onended(v: ((ev: Event) => void) | null) { this._onended = v; }
    get onmute(): ((ev: Event) => void) | null { return this._onmute; }
    set onmute(v: ((ev: Event) => void) | null) { this._onmute = v; }
    get onunmute(): ((ev: Event) => void) | null { return this._onunmute; }
    set onunmute(v: ((ev: Event) => void) | null) { this._onunmute = v; }

    clone(): MediaStreamTrack {
        const cloned = new MediaStreamTrack({
            kind: this.kind,
            label: this.label,
            muted: this._muted,
        });
        cloned._enabled = this._enabled;
        return cloned;
    }

    stop(): void {
        if (this._ended) return;
        this._ended = true;
    }

    getCapabilities(): Record<string, unknown> { return {}; }
    getConstraints(): Record<string, unknown> { return {}; }
    getSettings(): Record<string, unknown> { return {}; }

    applyConstraints(_constraints?: unknown): Promise<void> {
        return Promise.reject(new DOMException(
            'applyConstraints is not supported',
            'NotSupportedError',
        ));
    }

    /** @internal — used by RTCRtpReceiver to toggle mute state */
    _setMuted(muted: boolean): void {
        if (this._muted === muted) return;
        this._muted = muted;
        const ev = new Event(muted ? 'mute' : 'unmute');
        if (muted) {
            this._onmute?.call(this, ev);
        } else {
            this._onunmute?.call(this, ev);
        }
        this.dispatchEvent(ev);
    }
}
