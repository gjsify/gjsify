// RTCPeerConnection — W3C WebRTC peer connection backed by GStreamer webrtcbin.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCPeerConnection.ts (ISC)
// Adapted from node-gtk to GJS. Phase 1: Data Channel. Phase 2: Media API
// surface (addTransceiver, getSenders/getReceivers/getTransceivers, RTCTrackEvent).

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
import {
    gstToSignalingState,
    gstToConnectionState,
    gstToIceConnectionState,
    gstToIceGatheringState,
    w3cDirectionToGst,
} from './gst-enum-maps.js';
import { DOMException } from '@gjsify/dom-exception';
import { RTCSessionDescription, type RTCSessionDescriptionInit } from './rtc-session-description.js';
import { RTCIceCandidate, type RTCIceCandidateInit } from './rtc-ice-candidate.js';
import { RTCDataChannel } from './rtc-data-channel.js';
import { RTCPeerConnectionIceEvent, RTCDataChannelEvent } from './rtc-events.js';
import { RTCRtpSender, type RTCRtpTransceiverDirection } from './rtc-rtp-sender.js';
import { RTCRtpReceiver } from './rtc-rtp-receiver.js';
import { RTCRtpTransceiver } from './rtc-rtp-transceiver.js';
import { MediaStream } from './media-stream.js';
import { MediaStreamTrack } from './media-stream-track.js';
import { RTCTrackEvent } from './rtc-track-event.js';
import { parseGstStats, filterStatsByTrackId } from './gst-stats-parser.js';
import type { RTCStatsReport } from './rtc-stats-report.js';
import { RTCIceTransport } from './rtc-ice-transport.js';
import { RTCDtlsTransport } from './rtc-dtls-transport.js';
import { RTCSctpTransport } from './rtc-sctp-transport.js';
import { RTCCertificate, generateCertificate, type AlgorithmIdentifier } from './rtc-certificate.js';

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

/**
 * Web-IDL `[EnforceRange] unsigned short` coercion. Coerces via ToNumber,
 * rejects values that can't be represented as an unsigned short (0..65535).
 * Matches Web-IDL §3.2.4.10: reject NaN, ±Infinity, and integers outside
 * the range; "100" → 100; fractional values are truncated.
 *
 * Reference: refs/wpt/webrtc/RTCDataChannelInit-{maxPacketLifeTime,maxRetransmits}-enforce-range.html
 */
function coerceUnsignedShort(name: string, raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        throw new TypeError(`createDataChannel: ${name} must be a finite number, got ${String(raw)}`);
    }
    const truncated = Math.trunc(n);
    if (truncated < 0 || truncated > 65535) {
        throw new TypeError(`createDataChannel: ${name}=${truncated} is outside the [0, 65535] range`);
    }
    return truncated;
}


export interface RTCRtpTransceiverInit {
    direction?: RTCRtpTransceiverDirection;
    streams?: MediaStream[];
    sendEncodings?: Array<{ rid?: string; active?: boolean; maxBitrate?: number; scaleResolutionDownBy?: number }>;
}


let globalCounter = 0;

export class RTCPeerConnection extends EventTarget {
    private _pipeline: Gst.Pipeline;
    private _webrtcbin: Gst.Element;
    private _bridge: WebrtcbinBridgeType;
    private _conf: RTCConfiguration;
    private _closed = false;
    private _iceRestartNeeded = false;
    private _hasNegotiated = false;
    private _dataChannels = new Map<unknown, RTCDataChannel>();
    private _transceivers = new Map<unknown, RTCRtpTransceiver>();
    private _senders: RTCRtpSender[] = [];
    private _receivers: RTCRtpReceiver[] = [];
    private _iceTransport: RTCIceTransport | null = null;
    private _dtlsTransport: RTCDtlsTransport | null = null;
    private _sctpTransport: RTCSctpTransport | null = null;
    readonly canTrickleIceCandidates: boolean = true;

    constructor(configuration?: RTCConfiguration) {
        super();
        ensureWebrtcbinAvailable();

        const [major, minor] = Gst.version();
        if (major < 1 || (major === 1 && minor < 20)) {
            throw new DOMException(
                `@gjsify/webrtc requires GStreamer >= 1.20 (you have ${major}.${minor}). webrtcbin is only stable from 1.20 onward.`,
                'NotSupportedError',
            );
        }

        const id = ++globalCounter;
        this._pipeline = new Gst.Pipeline({ name: `gjsify-webrtc-pipeline-${id}` });
        const bin = Gst.ElementFactory.make('webrtcbin', `gjsify-webrtcbin-${id}`);
        if (!bin) {
            throw new Error('Failed to create webrtcbin element');
        }
        this._webrtcbin = bin;
        this._conf = { ...configuration };

        // Validate certificates — expired certs must be rejected
        if (configuration?.certificates) {
            for (const cert of configuration.certificates) {
                if (cert instanceof RTCCertificate && cert.expires <= Date.now()) {
                    throw new DOMException(
                        'RTCPeerConnection: one of the provided certificates has expired',
                        'InvalidAccessError',
                    );
                }
            }
        }

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
        this._bridge.connect('new-transceiver', (_b, gstTrans) =>
            this._handleNewTransceiver(gstTrans));
        this._bridge.connect('pad-added', (_b, pad) =>
            this._handlePadAdded(pad));
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

    get sctp(): RTCSctpTransport | null { return this._sctpTransport; }
    get peerIdentity(): Promise<never> {
        return Promise.reject(new TypeError('peerIdentity assertions are not implemented'));
    }
    get idpErrorInfo(): null { return null; }
    get idpLoginUrl(): null { return null; }

    // ---- Core methods ------------------------------------------------------

    private _rejectIfClosed(method: string): void {
        if (!this._closed) return;
        throw new DOMException(
            `RTCPeerConnection.${method}: connection is closed`,
            'InvalidStateError',
        );
    }

    async createOffer(_options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
        this._rejectIfClosed('createOffer');
        const opts = Gst.Structure.new_empty('offer-options');
        // If restartIce() was called, request fresh ICE credentials
        if (this._iceRestartNeeded) {
            this._setStructureField(opts, 'ice-restart', 'boolean', true);
            this._iceRestartNeeded = false;
        }
        const reply = await withGstPromise((p) => {
            this._webrtcbin.emit('create-offer', opts, p);
        });
        // GJS unboxes `get_value` for boxed types directly to the underlying
        // struct; no GObject.Value wrapper involvement.
        const desc = reply!.get_value('offer') as unknown as GstWebRTC.WebRTCSessionDescription;
        return RTCSessionDescription.fromGstDesc(desc).toJSON();
    }

    async createAnswer(_options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> {
        this._rejectIfClosed('createAnswer');
        const opts = Gst.Structure.new_empty('answer-options');
        const reply = await withGstPromise((p) => {
            this._webrtcbin.emit('create-answer', opts, p);
        });
        const desc = reply!.get_value('answer') as unknown as GstWebRTC.WebRTCSessionDescription;
        return RTCSessionDescription.fromGstDesc(desc).toJSON();
    }

    async setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
        this._rejectIfClosed('setLocalDescription');

        // W3C § 4.4.1.6 — implicit setLocalDescription (perfect negotiation):
        // When called without arguments (or with empty type/sdp), auto-create
        // the appropriate SDP based on the current signaling state.
        if (!description || !description.type || !description.sdp) {
            const state = this.signalingState;
            if (state === 'stable' || state === 'have-local-offer') {
                // Stable → create offer; have-local-offer → rollback + re-offer
                description = await this.createOffer();
            } else if (state === 'have-remote-offer' || state === 'have-remote-pranswer') {
                description = await this.createAnswer();
            } else {
                throw new DOMException(
                    `setLocalDescription: cannot auto-create SDP in signalingState '${state}'`,
                    'InvalidStateError',
                );
            }
        }

        // On first-time setLocalDescription, the pipeline needs to start running.
        this._pipeline.set_state(Gst.State.PLAYING);
        const gstDesc = new RTCSessionDescription(description).toGstDesc();
        await withGstPromise((p) => {
            this._webrtcbin.emit('set-local-description', gstDesc, p);
        });
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        this._rejectIfClosed('setRemoteDescription');
        if (!description || !description.sdp || !description.type) {
            throw new TypeError('setRemoteDescription requires an RTCSessionDescriptionInit with sdp and type');
        }
        this._pipeline.set_state(Gst.State.PLAYING);
        const gstDesc = new RTCSessionDescription(description).toGstDesc();
        await withGstPromise((p) => {
            this._webrtcbin.emit('set-remote-description', gstDesc, p);
        });
        // Track that at least one negotiation has completed (for restartIce)
        if (this.signalingState === 'stable') {
            this._hasNegotiated = true;
        }
    }

    async addIceCandidate(candidate: RTCIceCandidateInit | RTCIceCandidate | null): Promise<void> {
        this._rejectIfClosed('addIceCandidate');
        if (!candidate) return; // end-of-candidates marker — webrtcbin handles implicitly
        const { candidate: cand, sdpMLineIndex } = candidate;
        if (typeof cand !== 'string' || typeof sdpMLineIndex !== 'number') return;
        this._webrtcbin.emit('add-ice-candidate', sdpMLineIndex, cand);
    }

    createDataChannel(label: string, options: RTCDataChannelInit = {}): RTCDataChannel {
        if (this._closed) {
            throw new DOMException(
                'Cannot create a data channel on a closed RTCPeerConnection',
                'InvalidStateError',
            );
        }
        if (typeof label !== 'string') {
            throw new TypeError('createDataChannel: label must be a string');
        }
        if (new TextEncoder().encode(label).byteLength > 65535) {
            throw new TypeError('createDataChannel: label too long (> 65535 bytes)');
        }

        // Web-IDL `[EnforceRange] unsigned short` coercion for the three
        // numeric options. Input is coerced via ToNumber (so "100" → 100)
        // then range-checked against [0, 65535]; any value that can't be
        // represented exactly as an unsigned short throws TypeError. Also
        // handles WPT's `0` edge case (number) vs `undefined` (no value).
        const maxPacketLifeTime = options.maxPacketLifeTime == null
            ? undefined
            : coerceUnsignedShort('maxPacketLifeTime', options.maxPacketLifeTime);
        const maxRetransmits = options.maxRetransmits == null
            ? undefined
            : coerceUnsignedShort('maxRetransmits', options.maxRetransmits);
        const id = options.id == null
            ? undefined
            : coerceUnsignedShort('id', options.id);

        if (maxPacketLifeTime !== undefined && maxRetransmits !== undefined) {
            throw new TypeError('createDataChannel: maxPacketLifeTime and maxRetransmits are mutually exclusive');
        }
        if (options.negotiated === true && id === undefined) {
            throw new TypeError('createDataChannel: negotiated=true requires an id');
        }
        if (id === 65535) {
            // Per RFC 8832 §5.1, id must be < 65535 (65535 is reserved).
            throw new TypeError('createDataChannel: id 65535 is reserved');
        }

        const gstOpts = Gst.Structure.new_empty('data-channel-opts');
        this._setStructureField(gstOpts, 'ordered', 'boolean', options.ordered);
        this._setStructureField(gstOpts, 'max-packet-lifetime', 'int', maxPacketLifeTime);
        this._setStructureField(gstOpts, 'max-retransmits', 'int', maxRetransmits);
        this._setStructureField(gstOpts, 'protocol', 'string', options.protocol);
        this._setStructureField(gstOpts, 'negotiated', 'boolean', options.negotiated);
        this._setStructureField(gstOpts, 'id', 'int', id);

        let native: GstWebRTC.WebRTCDataChannel | null = null;
        try {
            native = this._webrtcbin.emit('create-data-channel', label, gstOpts) as any;
        } catch (err: any) {
            throw new Error(`create-data-channel failed: ${err?.message ?? err}`);
        }
        if (!native) {
            throw new Error('webrtcbin returned null data channel (check id/label/options)');
        }

        // Data channel created → ensure SCTP transport exists
        this._ensureSctpTransport();

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
            for (const s of this._senders) {
                try { s._teardownPipeline(); } catch { /* ignore */ }
            }
            for (const r of this._receivers) {
                try { r._dispose(); } catch { /* ignore */ }
            }
            this._transceivers.clear();
            this._senders.length = 0;
            this._receivers.length = 0;
            // Close transport objects
            if (this._dtlsTransport) this._dtlsTransport._setState('closed');
            if (this._iceTransport) this._iceTransport._setState('closed');
            if (this._sctpTransport) this._sctpTransport._setState('closed');
            try { this._bridge.dispose_bridge(); } catch { /* ignore */ }
            return GLib.SOURCE_REMOVE;
        }, null);
    }

    // ---- Media / Transceiver API (Phase 2) ----------------------------------

    addTransceiver(
        trackOrKind: MediaStreamTrack | string,
        init?: RTCRtpTransceiverInit,
    ): RTCRtpTransceiver {
        this._rejectIfClosed('addTransceiver');

        let kind: 'audio' | 'video';
        if (typeof trackOrKind === 'string') {
            if (trackOrKind !== 'audio' && trackOrKind !== 'video') {
                throw new TypeError(
                    `Failed to execute 'addTransceiver' on 'RTCPeerConnection': The provided value '${trackOrKind}' is not a valid enum value of type MediaStreamTrackKind.`,
                );
            }
            kind = trackOrKind;
        } else if (trackOrKind instanceof MediaStreamTrack) {
            kind = trackOrKind.kind;
        } else {
            throw new TypeError(
                "Failed to execute 'addTransceiver' on 'RTCPeerConnection': parameter 1 is not of type 'MediaStreamTrack' or a valid MediaStreamTrackKind.",
            );
        }

        if (init?.sendEncodings) {
            const rids = new Set<string>();
            for (const enc of init.sendEncodings) {
                if (enc.rid !== undefined) {
                    if (typeof enc.rid !== 'string' || enc.rid.length === 0 || enc.rid.length > 16 || !/^[a-zA-Z0-9]+$/.test(enc.rid)) {
                        throw new TypeError(`Invalid RID value: ${enc.rid}`);
                    }
                    if (rids.has(enc.rid)) {
                        throw new TypeError(`Duplicate RID: ${enc.rid}`);
                    }
                    rids.add(enc.rid);
                }
                if (enc.scaleResolutionDownBy !== undefined && enc.scaleResolutionDownBy < 1.0) {
                    throw new RangeError('scaleResolutionDownBy must be >= 1.0');
                }
            }
        }

        const direction = init?.direction ?? 'sendrecv';
        const validDirections = ['sendrecv', 'sendonly', 'recvonly', 'inactive'];
        if (!validDirections.includes(direction)) {
            throw new TypeError(
                `Failed to execute 'addTransceiver' on 'RTCPeerConnection': The provided value '${direction}' is not a valid enum value of type RTCRtpTransceiverDirection.`,
            );
        }
        const hasGstSource = trackOrKind instanceof MediaStreamTrack && (trackOrKind as any)._gstSource;
        const wantsSend = direction === 'sendrecv' || direction === 'sendonly';

        let gstTrans: any;
        let jsTrans: RTCRtpTransceiver;

        if (hasGstSource && wantsSend) {
            // Path A: Track has a GStreamer source and needs to send.
            // Requesting a sink pad from webrtcbin implicitly creates both
            // the pad AND the transceiver. Using emit('add-transceiver')
            // would create a duplicate with mline=-1.
            const track = trackOrKind as MediaStreamTrack;

            // Build encoder chain, link to webrtcbin via request_pad_simple
            const sender = new RTCRtpSender(null, this._pipeline, this._webrtcbin);
            sender._kind = kind;
            // Allow sender to update our pipeline if it migrates to a VideoBridge pipeline
            sender._onPipelineChanged = (newPipeline) => { this._pipeline = newPipeline; };
            sender._setTrack(track);
            sender._wirePipeline(track);

            // Find the GstTransceiver that request_pad_simple created
            gstTrans = this._findNewGstTransceiver();
            if (!gstTrans) {
                throw new Error('webrtcbin did not create a transceiver for the send pad');
            }

            // Create wrapper with the pre-wired sender
            const gstReceiver = gstTrans.receiver ?? null;
            const receiver = new RTCRtpReceiver(kind, gstReceiver, this._pipeline);

            // Wire stats delegation + transport
            const statsDelegate = (t: MediaStreamTrack) => this.getStats(t);
            sender._getStatsForTrack = statsDelegate;
            receiver._getStatsForTrack = statsDelegate;
            const dtls = this._ensureTransports();
            sender._transport = dtls;
            receiver._transport = dtls;

            jsTrans = new RTCRtpTransceiver(gstTrans, sender, receiver);
            sender._transceiver = jsTrans;
            this._transceivers.set(gstTrans, jsTrans);
            this._senders.push(sender);
            this._receivers.push(receiver);

            // Apply direction
            (gstTrans as any).direction = w3cDirectionToGst(direction);
        } else {
            // Path B: No GStreamer source, or receive-only/inactive.
            // Use emit('add-transceiver') which creates a transceiver without pads.
            const caps = Gst.Caps.from_string(`application/x-rtp,media=${kind}`);
            // webrtcbin doesn't accept NONE for add-transceiver; use SENDRECV
            // and override to inactive after creation.
            const createDirection = direction === 'inactive'
                ? w3cDirectionToGst('sendrecv')
                : w3cDirectionToGst(direction);

            gstTrans = this._webrtcbin.emit('add-transceiver', createDirection, caps) as any;
            if (!gstTrans) {
                throw new Error('webrtcbin did not create a transceiver');
            }

            jsTrans = this._transceivers.get(gstTrans)!;
            if (!jsTrans) {
                jsTrans = this._createTransceiverWrapper(gstTrans);
            }

            (gstTrans as any).direction = w3cDirectionToGst(direction);

            if (trackOrKind instanceof MediaStreamTrack) {
                jsTrans.sender._setTrack(trackOrKind);
            }
        }

        return jsTrans;
    }

    addTrack(track: MediaStreamTrack, ..._streams: MediaStream[]): RTCRtpSender {
        this._rejectIfClosed('addTrack');

        if (!(track instanceof MediaStreamTrack)) {
            throw new TypeError(
                "Failed to execute 'addTrack' on 'RTCPeerConnection': parameter 1 is not a MediaStreamTrack",
            );
        }

        // Check if this track is already assigned to a sender
        const existing = this._senders.find(s => s.track === track);
        if (existing) {
            throw new DOMException(
                'Track already exists in a sender of this connection',
                'InvalidAccessError',
            );
        }

        // Look for a reusable transceiver (matching kind, no track, recvonly/inactive)
        let reusable: RTCRtpTransceiver | undefined;
        for (const t of this._transceivers.values()) {
            if (
                t.sender.track === null &&
                !t.stopped &&
                t.direction !== 'stopped' &&
                t.receiver.track.kind === track.kind
            ) {
                const dir = t.direction;
                if (dir === 'recvonly' || dir === 'inactive') {
                    reusable = t;
                    break;
                }
            }
        }

        if (reusable) {
            // Expand direction to include send
            const dir = reusable.direction;
            reusable.direction = dir === 'recvonly' ? 'sendrecv' : 'sendonly';
            reusable.sender._setTrack(track);
            // Note: _wirePipeline is NOT called here for reusable transceivers.
            // Tracks with GStreamer sources will be handled by addTransceiver Path A
            // if no reusable transceiver exists, or the pipeline will be wired
            // when webrtcbin creates the sink pad during SDP negotiation.
            return reusable.sender;
        }

        // Create a new transceiver — addTransceiver handles both _setTrack
        // and _wirePipeline for tracks with GStreamer sources (Path A).
        const transceiver = this.addTransceiver(track, { direction: 'sendrecv' });
        return transceiver.sender;
    }

    removeTrack(sender: RTCRtpSender): void {
        this._rejectIfClosed('removeTrack');
        if (!this._senders.includes(sender)) {
            throw new DOMException(
                'sender was not created by this connection',
                'InvalidAccessError',
            );
        }
        sender._setTrack(null);
    }

    getSenders(): RTCRtpSender[] { return [...this._senders]; }
    getReceivers(): RTCRtpReceiver[] { return [...this._receivers]; }
    getTransceivers(): RTCRtpTransceiver[] { return [...this._transceivers.values()]; }

    async getStats(selector?: MediaStreamTrack | null): Promise<RTCStatsReport> {
        this._rejectIfClosed('getStats');

        // Validate selector — if a track is given, it must belong to a sender or receiver
        if (selector != null && selector instanceof MediaStreamTrack) {
            const hasSender = this._senders.some(s => s.track === selector);
            const hasReceiver = this._receivers.some(r => r.track === selector);
            if (!hasSender && !hasReceiver) {
                throw new DOMException(
                    'The selector track is not associated with a sender or receiver of this connection',
                    'InvalidAccessError',
                );
            }
        }

        const reply = await withGstPromise((p) => {
            this._webrtcbin.emit('get-stats', null, p);
        });

        const report = parseGstStats(reply);

        // If a track selector was provided, filter to relevant stats
        if (selector != null && selector instanceof MediaStreamTrack) {
            return filterStatsByTrackId(report, selector.id);
        }

        return report;
    }

    // ---- ICE restart / reconfiguration (Phase 4.4) ---------------------------

    restartIce(): void {
        if (this._closed) return; // no-op on closed connections per spec
        this._iceRestartNeeded = true;
        // Only fire negotiationneeded if we've completed at least one negotiation.
        // Before initial negotiation, restartIce has no observable effect.
        if (this._hasNegotiated) {
            // Fire asynchronously per spec (queued as a microtask)
            Promise.resolve().then(() => {
                if (this._closed) return;
                this._handleNegotiationNeeded();
            });
        }
    }

    setConfiguration(configuration: RTCConfiguration): void {
        this._rejectIfClosed('setConfiguration');

        // Per spec: bundlePolicy and rtcpMuxPolicy cannot change after construction
        if (configuration.bundlePolicy && configuration.bundlePolicy !== (this._conf.bundlePolicy ?? 'balanced')) {
            throw new DOMException(
                'setConfiguration: bundlePolicy cannot be changed',
                'InvalidModificationError',
            );
        }
        if (configuration.rtcpMuxPolicy && configuration.rtcpMuxPolicy !== (this._conf.rtcpMuxPolicy ?? 'require')) {
            throw new DOMException(
                'setConfiguration: rtcpMuxPolicy cannot be changed',
                'InvalidModificationError',
            );
        }

        // Apply new ICE servers
        if (configuration.iceServers) {
            this._applyIceServers(configuration.iceServers);
        }
        // Apply new ICE transport policy
        if (configuration.iceTransportPolicy) {
            this._applyIceTransportPolicy(configuration.iceTransportPolicy);
        }

        this._conf = { ...this._conf, ...configuration };
    }
    getIdentityAssertion(): Promise<never> {
        return Promise.reject(new Error('getIdentityAssertion is not implemented'));
    }

    // ---- Transceiver helper -------------------------------------------------

    /** Find a GstWebRTCRTPTransceiver not yet in our map (created by request_pad_simple). */
    private _findNewGstTransceiver(): any {
        for (let i = 0; ; i++) {
            const gt = this._webrtcbin.emit('get-transceiver', i) as any;
            if (!gt) return null;
            if (!this._transceivers.has(gt)) return gt;
        }
    }

    /** Lazily create the shared DTLS and ICE transport instances (max-bundle → one pair). */
    private _ensureTransports(): RTCDtlsTransport {
        if (!this._dtlsTransport) {
            this._iceTransport = new RTCIceTransport();
            this._dtlsTransport = new RTCDtlsTransport(this._iceTransport);
        }
        return this._dtlsTransport;
    }

    /** Create the SCTP transport when a data channel is first negotiated. */
    private _ensureSctpTransport(): void {
        if (this._sctpTransport) return;
        const dtls = this._ensureTransports();
        this._sctpTransport = new RTCSctpTransport(dtls);
    }

    private _createTransceiverWrapper(gstTrans: any): RTCRtpTransceiver {
        let kind: 'audio' | 'video' = 'audio';
        try {
            const gstKind = gstTrans.kind;
            if (gstKind === GstWebRTC.WebRTCKind.VIDEO) kind = 'video';
        } catch { /* default audio */ }

        const gstReceiver = gstTrans.receiver ?? null;
        const gstSender = gstTrans.sender ?? null;

        const receiver = new RTCRtpReceiver(kind, gstReceiver, this._pipeline);
        const sender = new RTCRtpSender(gstSender, this._pipeline, this._webrtcbin);
        sender._kind = kind;
        sender._onPipelineChanged = (newPipeline) => { this._pipeline = newPipeline; };

        // Wire stats delegation so sender.getStats() / receiver.getStats() work
        const statsDelegate = (track: MediaStreamTrack) => this.getStats(track);
        sender._getStatsForTrack = statsDelegate;
        receiver._getStatsForTrack = statsDelegate;

        // Assign shared DTLS transport to sender/receiver
        const dtls = this._ensureTransports();
        sender._transport = dtls;
        receiver._transport = dtls;

        // Pass mline index to sender for sink pad naming
        try {
            const mline = (gstTrans as any).mlineindex;
            if (typeof mline === 'number' && mline >= 0) {
                sender._setMlineIndex(mline);
            }
        } catch { /* ignore */ }

        const transceiver = new RTCRtpTransceiver(gstTrans, sender, receiver);
        sender._transceiver = transceiver;

        this._transceivers.set(gstTrans, transceiver);
        this._senders.push(sender);
        this._receivers.push(receiver);
        return transceiver;
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

    private _handleNewTransceiver(gstTrans: GstWebRTC.WebRTCRTPTransceiver): void {
        if (this._closed) return;
        if (this._transceivers.has(gstTrans)) return;
        this._createTransceiverWrapper(gstTrans);
    }

    private _handlePadAdded(pad: Gst.Pad): void {
        if (this._closed) return;
        // Only process SRC pads (incoming media from remote peer)
        if (pad.direction !== Gst.PadDirection.SRC) return;

        const gstTrans = (pad as any).transceiver;
        if (!gstTrans) return;

        let jsTrans = this._transceivers.get(gstTrans);
        if (!jsTrans) {
            jsTrans = this._createTransceiverWrapper(gstTrans);
        }

        // Phase 2.5: wire incoming media through ReceiverBridge (decodebin → tee)
        jsTrans.receiver._connectToPad(pad);

        const stream = new MediaStream([jsTrans.receiver.track]);
        const ev = new RTCTrackEvent('track', {
            receiver: jsTrans.receiver,
            track: jsTrans.receiver.track,
            streams: [stream],
            transceiver: jsTrans,
        });
        this._ontrack?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleDataChannel(channelBridge: DataChannelBridgeType): void {
        this._ensureSctpTransport();
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
        // Sync transport object states from webrtcbin before dispatching
        if (type === 'connectionstatechange') {
            this._syncDtlsState();
        } else if (type === 'iceconnectionstatechange') {
            this._syncIceState();
        } else if (type === 'icegatheringstatechange') {
            this._syncIceGatheringState();
        }

        const ev = new Event(type);
        switch (type) {
            case 'connectionstatechange':     this._onconnectionstatechange?.call(this, ev); break;
            case 'iceconnectionstatechange':  this._oniceconnectionstatechange?.call(this, ev); break;
            case 'icegatheringstatechange':   this._onicegatheringstatechange?.call(this, ev); break;
            case 'signalingstatechange':      this._onsignalingstatechange?.call(this, ev); break;
        }
        this.dispatchEvent(ev);
    }

    /** Map PC connection state → DTLS transport state. */
    private _syncDtlsState(): void {
        if (!this._dtlsTransport) return;
        const pcState = this.connectionState;
        const dtlsMap: Record<string, 'new' | 'connecting' | 'connected' | 'closed' | 'failed'> = {
            'new': 'new',
            'connecting': 'connecting',
            'connected': 'connected',
            'disconnected': 'connected', // DTLS stays connected even if ICE disconnects
            'failed': 'failed',
            'closed': 'closed',
        };
        this._dtlsTransport._setState(dtlsMap[pcState] ?? 'new');

        // Connected DTLS → SCTP connected
        if (pcState === 'connected' && this._sctpTransport) {
            this._sctpTransport._setState('connected');
        }
    }

    /** Map PC ICE connection state → ICE transport state. */
    private _syncIceState(): void {
        if (!this._iceTransport) return;
        const iceState = this.iceConnectionState;
        this._iceTransport._setState(iceState as any);
    }

    /** Map PC ICE gathering state → ICE transport gathering state. */
    private _syncIceGatheringState(): void {
        if (!this._iceTransport) return;
        const gatheringState = this.iceGatheringState;
        this._iceTransport._setGatheringState(gatheringState as any);
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

    private _ontrack: EventHandler<RTCTrackEvent> = null;
    get ontrack() { return this._ontrack; }
    set ontrack(v: EventHandler<RTCTrackEvent>) { this._ontrack = v; }
    get onicecandidateerror(): EventHandler { return null; }
    set onicecandidateerror(_v: EventHandler) { /* no-op */ }

    // ---- Certificate management (Phase 4.7) --------------------------------

    static generateCertificate(keygenAlgorithm: AlgorithmIdentifier): Promise<RTCCertificate> {
        return generateCertificate(keygenAlgorithm);
    }
}
