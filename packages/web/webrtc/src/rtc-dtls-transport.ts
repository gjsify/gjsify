// W3C RTCDtlsTransport for GJS.
//
// Thin wrapper reflecting the DTLS state of a webrtcbin transport.
// State is updated by RTCPeerConnection via the WebrtcbinBridge.
//
// Reference: W3C WebRTC spec § 5.5
// Reference: refs/wpt/webrtc/RTCDtlsTransport-state.html

import '@gjsify/dom-events/register/event-target';

import { RTCIceTransport } from './rtc-ice-transport.js';

export type RTCDtlsTransportState = 'new' | 'connecting' | 'connected' | 'closed' | 'failed';

type EventHandler = ((ev: Event) => void) | null;

export class RTCDtlsTransport extends EventTarget {
    readonly iceTransport: RTCIceTransport;
    private _state: RTCDtlsTransportState = 'new';

    private _onstatechange: EventHandler = null;
    private _onerror: EventHandler = null;

    constructor(iceTransport: RTCIceTransport) {
        super();
        this.iceTransport = iceTransport;
    }

    get state(): RTCDtlsTransportState { return this._state; }

    get onstatechange(): EventHandler { return this._onstatechange; }
    set onstatechange(v: EventHandler) { this._onstatechange = v; }
    get onerror(): EventHandler { return this._onerror; }
    set onerror(v: EventHandler) { this._onerror = v; }

    getRemoteCertificates(): ArrayBuffer[] { return []; }

    // ---- Internal setters (called by RTCPeerConnection) ---------------------

    /** @internal */
    _setState(state: RTCDtlsTransportState): void {
        if (this._state === state) return;
        this._state = state;
        const ev = new Event('statechange');
        this._onstatechange?.call(this, ev);
        this.dispatchEvent(ev);
    }
}
