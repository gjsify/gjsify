// W3C RTCIceTransport for GJS.
//
// Thin wrapper that reflects webrtcbin's ICE state. The RTCPeerConnection
// updates state/gatheringState via the WebrtcbinBridge signal handlers.
//
// Reference: W3C WebRTC spec § 5.6
// Reference: refs/wpt/webrtc/RTCIceTransport.html

import '@gjsify/dom-events/register/event-target';

import { RTCIceCandidate, type RTCIceCandidateInit } from './rtc-ice-candidate.js';

export type RTCIceRole = 'unknown' | 'controlling' | 'controlled';
export type RTCIceComponent = 'rtp' | 'rtcp';
export type RTCIceTransportState =
    | 'new' | 'checking' | 'connected' | 'completed'
    | 'disconnected' | 'failed' | 'closed';

export interface RTCIceParameters {
    usernameFragment?: string;
    password?: string;
}

export interface RTCIceCandidatePair {
    local: RTCIceCandidate;
    remote: RTCIceCandidate;
}

type EventHandler = ((ev: Event) => void) | null;

export class RTCIceTransport extends EventTarget {
    private _state: RTCIceTransportState = 'new';
    private _gatheringState: RTCIceGatheringState = 'new';
    private _role: RTCIceRole = 'unknown';
    private _component: RTCIceComponent = 'rtp';
    private _localCandidates: RTCIceCandidate[] = [];
    private _remoteCandidates: RTCIceCandidate[] = [];
    private _localParams: RTCIceParameters | null = null;
    private _remoteParams: RTCIceParameters | null = null;

    private _onstatechange: EventHandler = null;
    private _ongatheringstatechange: EventHandler = null;
    private _onselectedcandidatepairchange: EventHandler = null;

    get state(): RTCIceTransportState { return this._state; }
    get gatheringState(): RTCIceGatheringState { return this._gatheringState; }
    get role(): RTCIceRole { return this._role; }
    get component(): RTCIceComponent { return this._component; }

    get onstatechange(): EventHandler { return this._onstatechange; }
    set onstatechange(v: EventHandler) { this._onstatechange = v; }
    get ongatheringstatechange(): EventHandler { return this._ongatheringstatechange; }
    set ongatheringstatechange(v: EventHandler) { this._ongatheringstatechange = v; }
    get onselectedcandidatepairchange(): EventHandler { return this._onselectedcandidatepairchange; }
    set onselectedcandidatepairchange(v: EventHandler) { this._onselectedcandidatepairchange = v; }

    getLocalCandidates(): RTCIceCandidate[] { return [...this._localCandidates]; }
    getRemoteCandidates(): RTCIceCandidate[] { return [...this._remoteCandidates]; }
    getSelectedCandidatePair(): RTCIceCandidatePair | null { return null; }
    getLocalParameters(): RTCIceParameters | null { return this._localParams; }
    getRemoteParameters(): RTCIceParameters | null { return this._remoteParams; }

    // ---- Internal setters (called by RTCPeerConnection) ---------------------

    /** @internal */
    _setState(state: RTCIceTransportState): void {
        if (this._state === state) return;
        this._state = state;
        const ev = new Event('statechange');
        this._onstatechange?.call(this, ev);
        this.dispatchEvent(ev);
    }

    /** @internal */
    _setGatheringState(state: RTCIceGatheringState): void {
        if (this._gatheringState === state) return;
        this._gatheringState = state;
        const ev = new Event('gatheringstatechange');
        this._ongatheringstatechange?.call(this, ev);
        this.dispatchEvent(ev);
    }

    /** @internal */
    _addLocalCandidate(init: RTCIceCandidateInit): void {
        this._localCandidates.push(new RTCIceCandidate(init));
    }

    /** @internal */
    _addRemoteCandidate(init: RTCIceCandidateInit): void {
        this._remoteCandidates.push(new RTCIceCandidate(init));
    }

    /** @internal */
    _setLocalParameters(params: RTCIceParameters): void {
        this._localParams = params;
    }

    /** @internal */
    _setRemoteParameters(params: RTCIceParameters): void {
        this._remoteParams = params;
    }
}

type RTCIceGatheringState = 'new' | 'gathering' | 'complete';
