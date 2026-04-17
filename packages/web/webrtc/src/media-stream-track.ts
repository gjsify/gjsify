// W3C MediaStreamTrack for GJS.
//
// Phase 2: lightweight API surface with event dispatch.
// Phase 3: optional GStreamer source integration — tracks created by
// getUserMedia carry a GStreamer source element reference that the
// RTCRtpSender wires into the webrtcbin pipeline.
//
// Reference: refs/node-gst-webrtc/src/media/MediaStreamTrack.ts (ISC)
// Reference: W3C MediaStreamTrack spec

import '@gjsify/dom-events/register/event-target';

import GLib from 'gi://GLib?version=2.0';

/** @internal GStreamer backing for tracks created by getUserMedia */
export interface MediaStreamTrackGstInit {
    source: any;       // Gst.Element
    pipeline: any;     // Gst.Pipeline
}

export interface MediaStreamTrackInit {
    kind: 'audio' | 'video';
    label?: string;
    id?: string;
    muted?: boolean;
    /** @internal */
    _gst?: MediaStreamTrackGstInit;
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

    /** @internal GStreamer source element (e.g. pulsesrc, audiotestsrc) */
    _gstSource: any = null;
    /** @internal Pipeline the source was originally created in */
    _gstPipeline: any = null;
    /** @internal Callback set by RTCRtpSender to control valve drop property */
    private _enableCallback: ((enabled: boolean) => void) | null = null;

    constructor(init: MediaStreamTrackInit) {
        super();
        this.id = init.id ?? GLib.uuid_string_random();
        this.kind = init.kind;
        this.label = init.label ?? '';
        this._muted = init.muted ?? false;

        if (init._gst) {
            this._gstSource = init._gst.source;
            this._gstPipeline = init._gst.pipeline;
        }
    }

    get enabled(): boolean { return this._enabled; }
    set enabled(v: boolean) {
        const val = !!v;
        if (this._enabled === val) return;
        this._enabled = val;
        this._enableCallback?.(val);
    }

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

        // Clean up GStreamer source and pipeline if present
        if (this._gstSource || this._gstPipeline) {
            try {
                // Set pipeline to NULL first (this stops all children)
                this._gstPipeline?.set_state(4 /* Gst.State.NULL */);
            } catch { /* ignore */ }
            try {
                this._gstSource?.set_state(4 /* Gst.State.NULL */);
            } catch { /* ignore */ }
            this._gstSource = null;
            this._gstPipeline = null;
        }

        const ev = new Event('ended');
        this._onended?.call(this, ev);
        this.dispatchEvent(ev);
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

    /** @internal — called by RTCRtpSender to wire valve control */
    _setEnableCallback(cb: ((enabled: boolean) => void) | null): void {
        this._enableCallback = cb;
    }
}
