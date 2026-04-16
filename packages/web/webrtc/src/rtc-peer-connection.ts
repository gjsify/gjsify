// RTCPeerConnection — W3C WebRTC peer connection backed by GStreamer webrtcbin.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCPeerConnection.ts (ISC)
// Adapted from node-gtk to GJS. Scope: Data Channel path end-to-end. Media
// APIs (addTrack, addTransceiver, getStats, etc.) throw NotSupportedError.

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import GstWebRTC from 'gi://GstWebRTC?version=1.0';

import {
    WebrtcbinBridge,
    type WebrtcbinBridge as WebrtcbinBridgeType,
    type DataChannelBridge as DataChannelBridgeType,
} from '@gjsify/webrtc-native';
import { ensureWebrtcbinAvailable, Gst } from './gst-init.js';
import { withGstPromise } from './gst-utils.js';
import { RTCSessionDescription, type RTCSessionDescriptionInit } from './rtc-session-description.js';
import { RTCIceCandidate, type RTCIceCandidateInit } from './rtc-ice-candidate.js';
import { RTCDataChannel } from './rtc-data-channel.js';
import { RTCPeerConnectionIceEvent, RTCDataChannelEvent } from './rtc-events.js';

export type RTCSignalingState =
    | 'stable' | 'closed'
    | 'have-local-offer' | 'have-remote-offer'
    | 'have-local-pranswer' | 'have-remote-pranswer';
export type RTCPeerConnectionState =
    | 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export type RTCIceConnectionState =
    | 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed';
export type RTCIceGatheringState = 'new' | 'gathering' | 'complete';
export type RTCIceTransportPolicy = 'all' | 'relay';
export type RTCBundlePolicy = 'balanced' | 'max-compat' | 'max-bundle';
export type RTCRtcpMuxPolicy = 'require';

export interface RTCIceServer {
    urls: string | string[];
    username?: string;
    credential?: string;
    credentialType?: 'password';
}

export interface RTCConfiguration {
    iceServers?: RTCIceServer[];
    iceTransportPolicy?: RTCIceTransportPolicy;
    bundlePolicy?: RTCBundlePolicy;
    rtcpMuxPolicy?: RTCRtcpMuxPolicy;
    peerIdentity?: string;
    certificates?: unknown[];
    iceCandidatePoolSize?: number;
}

export interface RTCOfferOptions {
    offerToReceiveAudio?: boolean;
    offerToReceiveVideo?: boolean;
    iceRestart?: boolean;
}
export interface RTCAnswerOptions {}

export interface RTCDataChannelInit {
    ordered?: boolean;
    maxPacketLifeTime?: number;
    maxRetransmits?: number;
    protocol?: string;
    negotiated?: boolean;
    id?: number;
    priority?: 'very-low' | 'low' | 'medium' | 'high';
}

type EventHandler<E extends Event = Event> =
    ((this: RTCPeerConnection, ev: E) => any) | null;

function throwNotSupported(method: string): never {
    const DOMExc = (globalThis as any).DOMException;
    const msg = `RTCPeerConnection.${method} is not implemented in @gjsify/webrtc (Data Channel MVP). Tracking: media support lands in a follow-up PR.`;
    if (DOMExc) throw new DOMExc(msg, 'NotSupportedError');
    throw new Error(msg);
}

function gstToSignalingState(v: number): RTCSignalingState {
    switch (v) {
        case GstWebRTC.WebRTCSignalingState.STABLE: return 'stable';
        case GstWebRTC.WebRTCSignalingState.CLOSED: return 'closed';
        case GstWebRTC.WebRTCSignalingState.HAVE_LOCAL_OFFER: return 'have-local-offer';
        case GstWebRTC.WebRTCSignalingState.HAVE_REMOTE_OFFER: return 'have-remote-offer';
        case GstWebRTC.WebRTCSignalingState.HAVE_LOCAL_PRANSWER: return 'have-local-pranswer';
        case GstWebRTC.WebRTCSignalingState.HAVE_REMOTE_PRANSWER: return 'have-remote-pranswer';
        default: return 'stable';
    }
}

function gstToConnectionState(v: number): RTCPeerConnectionState {
    switch (v) {
        case GstWebRTC.WebRTCPeerConnectionState.NEW: return 'new';
        case GstWebRTC.WebRTCPeerConnectionState.CONNECTING: return 'connecting';
        case GstWebRTC.WebRTCPeerConnectionState.CONNECTED: return 'connected';
        case GstWebRTC.WebRTCPeerConnectionState.DISCONNECTED: return 'disconnected';
        case GstWebRTC.WebRTCPeerConnectionState.FAILED: return 'failed';
        case GstWebRTC.WebRTCPeerConnectionState.CLOSED: return 'closed';
        default: return 'new';
    }
}

function gstToIceConnectionState(v: number): RTCIceConnectionState {
    switch (v) {
        case GstWebRTC.WebRTCICEConnectionState.NEW: return 'new';
        case GstWebRTC.WebRTCICEConnectionState.CHECKING: return 'checking';
        case GstWebRTC.WebRTCICEConnectionState.CONNECTED: return 'connected';
        case GstWebRTC.WebRTCICEConnectionState.COMPLETED: return 'completed';
        case GstWebRTC.WebRTCICEConnectionState.FAILED: return 'failed';
        case GstWebRTC.WebRTCICEConnectionState.DISCONNECTED: return 'disconnected';
        case GstWebRTC.WebRTCICEConnectionState.CLOSED: return 'closed';
        default: return 'new';
    }
}

function gstToIceGatheringState(v: number): RTCIceGatheringState {
    switch (v) {
        case GstWebRTC.WebRTCICEGatheringState.NEW: return 'new';
        case GstWebRTC.WebRTCICEGatheringState.GATHERING: return 'gathering';
        case GstWebRTC.WebRTCICEGatheringState.COMPLETE: return 'complete';
        default: return 'new';
    }
}

let globalCounter = 0;

export class RTCPeerConnection extends EventTarget {
    private _pipeline: Gst.Pipeline;
    private _webrtcbin: Gst.Element;
    private _bridge: WebrtcbinBridgeType;
    private _conf: RTCConfiguration;
    private _closed = false;
    private _dataChannels = new Map<unknown, RTCDataChannel>();
    readonly canTrickleIceCandidates: boolean = true;

    constructor(configuration?: RTCConfiguration) {
        super();
        ensureWebrtcbinAvailable();

        const [major, minor] = Gst.version();
        if (major < 1 || (major === 1 && minor < 20)) {
            const DOMExc = (globalThis as any).DOMException;
            const msg = `@gjsify/webrtc requires GStreamer >= 1.20 (you have ${major}.${minor}). webrtcbin is only stable from 1.20 onward.`;
            if (DOMExc) throw new DOMExc(msg, 'NotSupportedError');
            throw new Error(msg);
        }

        const id = ++globalCounter;
        this._pipeline = new Gst.Pipeline({ name: `gjsify-webrtc-pipeline-${id}` });
        const bin = Gst.ElementFactory.make('webrtcbin', `gjsify-webrtcbin-${id}`);
        if (!bin) {
            throw new Error('Failed to create webrtcbin element');
        }
        this._webrtcbin = bin;
        this._conf = { ...configuration };

        this._applyIceServers(configuration?.iceServers ?? []);
        this._applyIceTransportPolicy(configuration?.iceTransportPolicy);
        this._applyBundlePolicy(configuration?.bundlePolicy);

        this._pipeline.add(this._webrtcbin);

        // Connect via @gjsify/webrtc-native's WebrtcbinBridge — webrtcbin fires
        // its signals from the streaming thread, GJS would block direct JS
        // callbacks. The bridge hops to the main context on the C side.
        this._bridge = new (WebrtcbinBridge as any)({ bin: this._webrtcbin });
        this._bridge.connect('negotiation-needed', () => this._handleNegotiationNeeded());
        this._bridge.connect('icecandidate', (_b, mlineIndex, candidate) =>
            this._handleIceCandidate(mlineIndex, candidate));
        this._bridge.connect('datachannel', (_b, channelBridge) =>
            this._handleDataChannel(channelBridge));
        this._bridge.connect('connection-state-changed', () =>
            this._dispatchStateChange('connectionstatechange'));
        this._bridge.connect('ice-connection-state-changed', () =>
            this._dispatchStateChange('iceconnectionstatechange'));
        this._bridge.connect('ice-gathering-state-changed', () =>
            this._dispatchStateChange('icegatheringstatechange'));
        this._bridge.connect('signaling-state-changed', () =>
            this._dispatchStateChange('signalingstatechange'));

        // webrtcbin needs PLAYING to exit its `is_closed` state before it accepts
        // createDataChannel/create-offer etc. (see GStreamer webrtcbin source).
        this._pipeline.set_state(Gst.State.PLAYING);
    }

    // ---- ICE server / policy config ---------------------------------------

    private _applyIceServers(iceServers: RTCIceServer[]): void {
        let stunSet = false;
        for (const server of iceServers) {
            const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
            if (urls.length === 0) {
                throw new SyntaxError('RTCIceServer.urls must not be empty');
            }
            for (const url of urls) {
                if (typeof url !== 'string' || url.length === 0) {
                    throw new TypeError('RTCIceServer.urls entries must be non-empty strings');
                }
                const colonIdx = url.indexOf(':');
                if (colonIdx < 0) {
                    throw new TypeError(`Invalid ICE server URL "${url}"`);
                }
                const proto = url.slice(0, colonIdx + 1);
                const hostPort = url.slice(colonIdx + 1);

                if (proto === 'stun:' || proto === 'stuns:') {
                    if (stunSet) continue; // webrtcbin supports only one STUN server
                    (this._webrtcbin as any).stun_server = `${proto}//${hostPort}`;
                    stunSet = true;
                } else if (proto === 'turn:' || proto === 'turns:') {
                    if (typeof server.username !== 'string' || typeof server.credential !== 'string') {
                        throw new TypeError(`TURN server credential for ${url} missing`);
                    }
                    const encUser = encodeURIComponent(server.username);
                    const encCred = encodeURIComponent(server.credential);
                    const turnUrl = `${proto}//${encUser}:${encCred}@${hostPort}`;
                    try {
                        this._webrtcbin.emit('add-turn-server', turnUrl);
                    } catch {
                        (this._webrtcbin as any).turn_server = turnUrl;
                    }
                } else {
                    throw new TypeError(`Unsupported ICE server protocol "${proto}"`);
                }
            }
        }
    }

    private _applyIceTransportPolicy(policy?: RTCIceTransportPolicy): void {
        if (!policy) return;
        const gstPolicy = policy === 'relay'
            ? GstWebRTC.WebRTCICETransportPolicy.RELAY
            : GstWebRTC.WebRTCICETransportPolicy.ALL;
        try { (this._webrtcbin as any).ice_transport_policy = gstPolicy; } catch { /* ignore */ }
    }

    private _applyBundlePolicy(policy?: RTCBundlePolicy): void {
        if (!policy) return;
        let gstPolicy: number;
        switch (policy) {
            case 'balanced':   gstPolicy = GstWebRTC.WebRTCBundlePolicy.BALANCED; break;
            case 'max-compat': gstPolicy = GstWebRTC.WebRTCBundlePolicy.MAX_COMPAT; break;
            case 'max-bundle': gstPolicy = GstWebRTC.WebRTCBundlePolicy.MAX_BUNDLE; break;
            default: return;
        }
        try { (this._webrtcbin as any).bundle_policy = gstPolicy; } catch { /* ignore */ }
    }

    // ---- Properties --------------------------------------------------------

    get signalingState(): RTCSignalingState {
        if (this._closed) return 'closed';
        try { return gstToSignalingState((this._webrtcbin as any).signaling_state); }
        catch { return 'stable'; }
    }

    get connectionState(): RTCPeerConnectionState {
        if (this._closed) return 'closed';
        try { return gstToConnectionState((this._webrtcbin as any).connection_state); }
        catch { return 'new'; }
    }

    get iceConnectionState(): RTCIceConnectionState {
        if (this._closed) return 'closed';
        try { return gstToIceConnectionState((this._webrtcbin as any).ice_connection_state); }
        catch { return 'new'; }
    }

    get iceGatheringState(): RTCIceGatheringState {
        try { return gstToIceGatheringState((this._webrtcbin as any).ice_gathering_state); }
        catch { return 'new'; }
    }

    private _descProp(prop: string): RTCSessionDescription | null {
        try {
            const desc = (this._webrtcbin as any)[prop] as GstWebRTC.WebRTCSessionDescription | null;
            if (!desc) return null;
            return RTCSessionDescription.fromGstDesc(desc);
        } catch { return null; }
    }

    get localDescription(): RTCSessionDescription | null { return this._descProp('local_description'); }
    get remoteDescription(): RTCSessionDescription | null { return this._descProp('remote_description'); }
    get currentLocalDescription(): RTCSessionDescription | null { return this._descProp('current_local_description'); }
    get currentRemoteDescription(): RTCSessionDescription | null { return this._descProp('current_remote_description'); }
    get pendingLocalDescription(): RTCSessionDescription | null { return this._descProp('pending_local_description'); }
    get pendingRemoteDescription(): RTCSessionDescription | null { return this._descProp('pending_remote_description'); }

    get sctp(): null { return null; }
    get peerIdentity(): Promise<never> {
        return Promise.reject(new TypeError('peerIdentity assertions are not implemented'));
    }
    get idpErrorInfo(): null { return null; }
    get idpLoginUrl(): null { return null; }

    // ---- Core methods ------------------------------------------------------

    async createOffer(_options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
        const opts = Gst.Structure.new_empty('offer-options');
        const reply = await withGstPromise((p) => {
            this._webrtcbin.emit('create-offer', opts, p);
        });
        // GJS unboxes `get_value` for boxed types directly to the underlying
        // struct; no GObject.Value wrapper involvement.
        const desc = reply!.get_value('offer') as unknown as GstWebRTC.WebRTCSessionDescription;
        return RTCSessionDescription.fromGstDesc(desc).toJSON();
    }

    async createAnswer(_options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> {
        const opts = Gst.Structure.new_empty('answer-options');
        const reply = await withGstPromise((p) => {
            this._webrtcbin.emit('create-answer', opts, p);
        });
        const desc = reply!.get_value('answer') as unknown as GstWebRTC.WebRTCSessionDescription;
        return RTCSessionDescription.fromGstDesc(desc).toJSON();
    }

    async setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
        if (!description || !description.sdp || !description.type) {
            // Implicit createOffer/createAnswer is not implemented yet — require explicit SDP.
            throw new TypeError('setLocalDescription requires an RTCSessionDescriptionInit with sdp and type');
        }
        // On first-time setLocalDescription, the pipeline needs to start running.
        this._pipeline.set_state(Gst.State.PLAYING);
        const gstDesc = new RTCSessionDescription(description).toGstDesc();
        await withGstPromise((p) => {
            this._webrtcbin.emit('set-local-description', gstDesc, p);
        });
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        if (!description || !description.sdp || !description.type) {
            throw new TypeError('setRemoteDescription requires an RTCSessionDescriptionInit with sdp and type');
        }
        this._pipeline.set_state(Gst.State.PLAYING);
        const gstDesc = new RTCSessionDescription(description).toGstDesc();
        await withGstPromise((p) => {
            this._webrtcbin.emit('set-remote-description', gstDesc, p);
        });
    }

    async addIceCandidate(candidate: RTCIceCandidateInit | RTCIceCandidate | null): Promise<void> {
        if (!candidate) return; // end-of-candidates marker — webrtcbin handles implicitly
        const { candidate: cand, sdpMLineIndex } = candidate;
        if (typeof cand !== 'string' || typeof sdpMLineIndex !== 'number') return;
        this._webrtcbin.emit('add-ice-candidate', sdpMLineIndex, cand);
    }

    createDataChannel(label: string, options: RTCDataChannelInit = {}): RTCDataChannel {
        if (this._closed) {
            const DOMExc = (globalThis as any).DOMException;
            const msg = 'Cannot create a data channel on a closed RTCPeerConnection';
            if (DOMExc) throw new DOMExc(msg, 'InvalidStateError');
            throw new Error(msg);
        }
        if (typeof label !== 'string') {
            throw new TypeError('createDataChannel: label must be a string');
        }
        if (new TextEncoder().encode(label).byteLength > 65535) {
            throw new TypeError('createDataChannel: label too long (> 65535 bytes)');
        }
        if (options.maxPacketLifeTime != null && options.maxRetransmits != null) {
            throw new TypeError('createDataChannel: maxPacketLifeTime and maxRetransmits are mutually exclusive');
        }
        if (options.negotiated === true && typeof options.id !== 'number') {
            throw new TypeError('createDataChannel: negotiated=true requires an id');
        }
        if (typeof options.id === 'number' && (options.id < 0 || options.id >= 65535)) {
            throw new TypeError('createDataChannel: id out of range');
        }

        const gstOpts = Gst.Structure.new_empty('data-channel-opts');
        this._setStructureField(gstOpts, 'ordered', 'boolean', options.ordered);
        this._setStructureField(gstOpts, 'max-packet-lifetime', 'int', options.maxPacketLifeTime);
        this._setStructureField(gstOpts, 'max-retransmits', 'int', options.maxRetransmits);
        this._setStructureField(gstOpts, 'protocol', 'string', options.protocol);
        this._setStructureField(gstOpts, 'negotiated', 'boolean', options.negotiated);
        this._setStructureField(gstOpts, 'id', 'int', options.id);

        let native: GstWebRTC.WebRTCDataChannel | null = null;
        try {
            native = this._webrtcbin.emit('create-data-channel', label, gstOpts) as any;
        } catch (err: any) {
            throw new Error(`create-data-channel failed: ${err?.message ?? err}`);
        }
        if (!native) {
            throw new Error('webrtcbin returned null data channel (check id/label/options)');
        }

        const js = new RTCDataChannel(native);
        this._dataChannels.set(native, js);
        js.addEventListener('close', () => {
            this._dataChannels.delete(native);
        });
        return js;
    }

    private _setStructureField(
        structure: Gst.Structure,
        name: string,
        type: 'boolean' | 'int' | 'string',
        value: unknown,
    ): void {
        if (value == null) return;
        const gvalue = new GObject.Value();
        if (type === 'boolean') {
            gvalue.init(GObject.TYPE_BOOLEAN);
            gvalue.set_boolean(Boolean(value));
        } else if (type === 'int') {
            gvalue.init(GObject.TYPE_INT);
            gvalue.set_int(Number(value));
        } else if (type === 'string') {
            gvalue.init(GObject.TYPE_STRING);
            gvalue.set_string(String(value));
        }
        structure.set_value(name, gvalue);
        gvalue.unset();
    }

    getConfiguration(): RTCConfiguration { return { ...this._conf }; }

    close(): void {
        if (this._closed) return;
        this._closed = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try { this._pipeline.set_state(Gst.State.NULL); } catch { /* ignore */ }
            for (const ch of this._dataChannels.values()) {
                try { ch._disconnectSignals(); } catch { /* ignore */ }
            }
            this._dataChannels.clear();
            try { this._bridge.dispose_bridge(); } catch { /* ignore */ }
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---- Not implemented (Phase 2 / 3) ------------------------------------

    addTrack(_track: unknown, ..._streams: unknown[]): never { throwNotSupported('addTrack'); }
    removeTrack(_sender: unknown): never { throwNotSupported('removeTrack'); }
    addTransceiver(_trackOrKind: unknown, _init?: unknown): never { throwNotSupported('addTransceiver'); }
    getSenders(): unknown[] { return []; }
    getReceivers(): unknown[] { return []; }
    getTransceivers(): unknown[] { return []; }
    getStats(_selector?: unknown): Promise<never> {
        return Promise.reject((() => {
            const DOMExc = (globalThis as any).DOMException;
            const msg = 'RTCPeerConnection.getStats is not implemented in @gjsify/webrtc';
            return DOMExc ? new DOMExc(msg, 'NotSupportedError') : new Error(msg);
        })());
    }
    restartIce(): never { throwNotSupported('restartIce'); }
    setConfiguration(_configuration: RTCConfiguration): never { throwNotSupported('setConfiguration'); }
    getIdentityAssertion(): Promise<never> {
        return Promise.reject(new Error('getIdentityAssertion is not implemented'));
    }

    // ---- Signal handlers ---------------------------------------------------
    // The WebrtcbinBridge (webrtc-native) has already marshalled these from
    // the GStreamer streaming thread onto the GLib main context, so we can
    // synchronously dispatch from here.

    private _handleNegotiationNeeded(): void {
        const ev = new Event('negotiationneeded');
        this._onnegotiationneeded?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleIceCandidate(sdpMLineIndex: number, candidate: string): void {
        const cand = new RTCIceCandidate({ candidate, sdpMLineIndex });
        const ev = new RTCPeerConnectionIceEvent('icecandidate', { candidate: cand });
        this._onicecandidate?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleDataChannel(channelBridge: DataChannelBridgeType): void {
        const native = channelBridge.channel as unknown as GstWebRTC.WebRTCDataChannel;
        let js = this._dataChannels.get(native);
        if (!js) {
            js = new RTCDataChannel(channelBridge);
            this._dataChannels.set(native, js);
            js.addEventListener('close', () => {
                this._dataChannels.delete(native);
            });
        }
        const ev = new RTCDataChannelEvent('datachannel', { channel: js });
        this._ondatachannel?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _dispatchStateChange(type: string): void {
        const ev = new Event(type);
        switch (type) {
            case 'connectionstatechange':     this._onconnectionstatechange?.call(this, ev); break;
            case 'iceconnectionstatechange':  this._oniceconnectionstatechange?.call(this, ev); break;
            case 'icegatheringstatechange':   this._onicegatheringstatechange?.call(this, ev); break;
            case 'signalingstatechange':      this._onsignalingstatechange?.call(this, ev); break;
        }
        this.dispatchEvent(ev);
    }

    // ---- on<event> attribute handlers --------------------------------------

    private _onconnectionstatechange: EventHandler = null;
    private _ondatachannel: EventHandler<RTCDataChannelEvent> = null;
    private _onicecandidate: EventHandler<RTCPeerConnectionIceEvent> = null;
    private _oniceconnectionstatechange: EventHandler = null;
    private _onicegatheringstatechange: EventHandler = null;
    private _onnegotiationneeded: EventHandler = null;
    private _onsignalingstatechange: EventHandler = null;

    get onconnectionstatechange() { return this._onconnectionstatechange; }
    set onconnectionstatechange(v: EventHandler) { this._onconnectionstatechange = v; }
    get ondatachannel() { return this._ondatachannel; }
    set ondatachannel(v: EventHandler<RTCDataChannelEvent>) { this._ondatachannel = v; }
    get onicecandidate() { return this._onicecandidate; }
    set onicecandidate(v: EventHandler<RTCPeerConnectionIceEvent>) { this._onicecandidate = v; }
    get oniceconnectionstatechange() { return this._oniceconnectionstatechange; }
    set oniceconnectionstatechange(v: EventHandler) { this._oniceconnectionstatechange = v; }
    get onicegatheringstatechange() { return this._onicegatheringstatechange; }
    set onicegatheringstatechange(v: EventHandler) { this._onicegatheringstatechange = v; }
    get onnegotiationneeded() { return this._onnegotiationneeded; }
    set onnegotiationneeded(v: EventHandler) { this._onnegotiationneeded = v; }
    get onsignalingstatechange() { return this._onsignalingstatechange; }
    set onsignalingstatechange(v: EventHandler) { this._onsignalingstatechange = v; }

    get ontrack(): EventHandler { return null; } // track events never fire in Phase 1
    set ontrack(_v: EventHandler) { /* no-op, see STATUS.md */ }
    get onicecandidateerror(): EventHandler { return null; }
    set onicecandidateerror(_v: EventHandler) { /* no-op */ }
}
