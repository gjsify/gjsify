// W3C RTCSctpTransport for GJS.
//
// Created when a data channel is negotiated. Wraps the SCTP association
// over the DTLS transport. State transitions from connecting → connected
// when the first data channel opens.
//
// Reference: W3C WebRTC spec § 6.1
// Reference: refs/wpt/webrtc/RTCSctpTransport-constructor.html

import '@gjsify/dom-events/register/event-target';

import { RTCDtlsTransport } from './rtc-dtls-transport.js';

export type RTCSctpTransportState = 'connecting' | 'connected' | 'closed';

type EventHandler = ((ev: Event) => void) | null;

export class RTCSctpTransport extends EventTarget {
    readonly transport: RTCDtlsTransport;
    private _state: RTCSctpTransportState = 'connecting';
    private _maxMessageSize: number = 262144; // 256 KB default per SCTP
    private _maxChannels: number | null = 65535;

    private _onstatechange: EventHandler = null;

    constructor(dtlsTransport: RTCDtlsTransport) {
        super();
        this.transport = dtlsTransport;
    }

    get state(): RTCSctpTransportState { return this._state; }
    get maxMessageSize(): number { return this._maxMessageSize; }
    get maxChannels(): number | null { return this._maxChannels; }

    get onstatechange(): EventHandler { return this._onstatechange; }
    set onstatechange(v: EventHandler) { this._onstatechange = v; }

    // ---- Internal setters (called by RTCPeerConnection) ---------------------

    /** @internal */
    _setState(state: RTCSctpTransportState): void {
        if (this._state === state) return;
        this._state = state;
        const ev = new Event('statechange');
        this._onstatechange?.call(this, ev);
        this.dispatchEvent(ev);
    }
}
