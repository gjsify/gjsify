// W3C RTCSctpTransport for GJS.
//
// Created when a data channel is negotiated. Wraps the SCTP association
// over the DTLS transport. State transitions from connecting → connected
// when the first data channel opens.
//
// Reference: W3C WebRTC spec § 6.1
// Reference: refs/wpt/webrtc/RTCSctpTransport-constructor.html

import '@gjsify/dom-events/register/event-target';

import type { RTCDtlsTransport } from './rtc-dtls-transport.js';

export type RTCSctpTransportState = 'connecting' | 'connected' | 'closed';

type EventHandler = ((ev: Event) => void) | null;

export class RTCSctpTransport extends EventTarget {
    readonly transport: RTCDtlsTransport;
    private _state: RTCSctpTransportState = 'connecting';
    // SCTP `max-message-size` ceiling that `RTCDataChannel.send`
    // enforces (W3C WebRTC § 5.6.5 step 4). The 262144-byte (256
    // KiB) default mirrors GStreamer webrtcbin's negotiated value
    // when the remote peer omits the `a=max-message-size:N` SDP
    // attribute. {@link _setMaxMessageSize} updates this after
    // SDP parsing; `0` means unlimited per RFC 8841.
    private _maxMessageSize: number = 262144;
    private _maxChannels: number | null = 65535;

    private _onstatechange: EventHandler = null;

    constructor(dtlsTransport: RTCDtlsTransport) {
        super();
        this.transport = dtlsTransport;
    }

    get state(): RTCSctpTransportState {
        return this._state;
    }
    get maxMessageSize(): number {
        return this._maxMessageSize;
    }
    get maxChannels(): number | null {
        return this._maxChannels;
    }

    get onstatechange(): EventHandler {
        return this._onstatechange;
    }
    set onstatechange(v: EventHandler) {
        this._onstatechange = v;
    }

    // ---- Internal setters (called by RTCPeerConnection) ---------------------

    /**
     * @internal — update the `maxMessageSize` ceiling, e.g. from a parsed SDP
     * `a=max-message-size:N` attribute (RFC 8841 § 6.1). A value of `0` means
     * the peer can handle messages of any size — `RTCDataChannel.send`'s
     * enforcement skips the check entirely. Negative or non-finite values are
     * rejected.
     */
    _setMaxMessageSize(v: number): void {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            throw new TypeError(`RTCSctpTransport: invalid max-message-size ${String(v)}`);
        }
        this._maxMessageSize = v;
    }

    /** @internal */
    _setState(state: RTCSctpTransportState): void {
        if (this._state === state) return;
        this._state = state;
        const ev = new Event('statechange');
        this._onstatechange?.call(this, ev);
        this.dispatchEvent(ev);
    }
}
