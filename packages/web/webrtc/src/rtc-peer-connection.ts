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
import {
    gstToSignalingState,
    gstToConnectionState,
    gstToIceConnectionState,
    gstToIceGatheringState,
} from './gst-enum-maps.js';
import { asWebRtcBin, asWebRtcSrcPad } from './internal/gst-types.js';
import { DOMException } from '@gjsify/dom-exception';
import { RTCSessionDescription } from './rtc-session-description.js';
import { RTCIceCandidate } from './rtc-ice-candidate.js';
import { RTCDataChannel } from './rtc-data-channel.js';
import { RTCPeerConnectionIceEvent, RTCDataChannelEvent } from './rtc-events.js';
import { RTCRtpSender, type RTCRtpTransceiverDirection } from './rtc-rtp-sender.js';
import { RTCRtpReceiver } from './rtc-rtp-receiver.js';
import { RTCRtpTransceiver } from './rtc-rtp-transceiver.js';
import { MediaStream } from './media-stream.js';
import type { MediaStreamTrack } from './media-stream-track.js';
import { RTCTrackEvent } from './rtc-track-event.js';
import { RTCIceTransport } from './rtc-ice-transport.js';
import { RTCDtlsTransport } from './rtc-dtls-transport.js';
import { RTCSctpTransport } from './rtc-sctp-transport.js';
import { RTCCertificate, generateCertificate, type AlgorithmIdentifier } from './rtc-certificate.js';

export type RTCSignalingState =
    | 'stable'
    | 'closed'
    | 'have-local-offer'
    | 'have-remote-offer'
    | 'have-local-pranswer'
    | 'have-remote-pranswer';
export type RTCPeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export type RTCIceConnectionState =
    | 'new'
    | 'checking'
    | 'connected'
    | 'completed'
    | 'failed'
    | 'disconnected'
    | 'closed';
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

// W3C EventHandlerNonNull (Web IDL § 8.1.5.1) is `(event: Event) => any` — the
// `any` is required so the `on<event>` setter accepts handlers whose return
// type does not matter (per spec, it is ignored). lib.dom mirrors this on
// every `GlobalEventHandlers.on*` field. Keep `any` to match the W3C contract.
// oxlint-disable-next-line typescript/no-explicit-any -- W3C EventHandlerNonNull return type matches lib.dom
type EventHandler<E extends Event = Event> = ((this: RTCPeerConnection, ev: E) => any) | null;

export interface RTCRtpTransceiverInit {
    direction?: RTCRtpTransceiverDirection;
    streams?: MediaStream[];
    sendEncodings?: Array<{ rid?: string; active?: boolean; maxBitrate?: number; scaleResolutionDownBy?: number }>;
}

let globalCounter = 0;

export class RTCPeerConnection extends EventTarget {
    // Fields touched by per-concern split modules (see ./rtc-peer-connection/
    // SDP negotiation, addTransceiver/addTrack, etc.) are package-internal
    // (no `private`, `_`-prefixed) so install*Methods bodies can reach them
    // through their `this: RTCPeerConnection` typing. Same convention as the
    // WebGL2 / canvas2d-core splits.
    _pipeline: Gst.Pipeline;
    _webrtcbin: Gst.Element;
    private _bridge: WebrtcbinBridgeType;
    _conf: RTCConfiguration;
    _closed = false;
    _iceRestartNeeded = false;
    _hasNegotiated = false;
    _dataChannels = new Map<unknown, RTCDataChannel>();
    _transceivers = new Map<unknown, RTCRtpTransceiver>();
    _senders: RTCRtpSender[] = [];
    _receivers: RTCRtpReceiver[] = [];
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
        this._bridge = new WebrtcbinBridge({ bin: this._webrtcbin });
        this._bridge.connect('negotiation-needed', () => this._handleNegotiationNeeded());
        this._bridge.connect('icecandidate', (_b, mlineIndex, candidate) =>
            this._handleIceCandidate(mlineIndex, candidate),
        );
        this._bridge.connect('datachannel', (_b, channelBridge) => this._handleDataChannel(channelBridge));
        this._bridge.connect('new-transceiver', (_b, gstTrans) => this._handleNewTransceiver(gstTrans));
        this._bridge.connect('pad-added', (_b, pad) => this._handlePadAdded(pad));
        this._bridge.connect('connection-state-changed', () => this._dispatchStateChange('connectionstatechange'));
        this._bridge.connect('ice-connection-state-changed', () =>
            this._dispatchStateChange('iceconnectionstatechange'),
        );
        this._bridge.connect('ice-gathering-state-changed', () => this._dispatchStateChange('icegatheringstatechange'));
        this._bridge.connect('signaling-state-changed', () => this._dispatchStateChange('signalingstatechange'));

        // webrtcbin needs PLAYING to exit its `is_closed` state before it accepts
        // createDataChannel/create-offer etc. (see GStreamer webrtcbin source).
        this._pipeline.set_state(Gst.State.PLAYING);
    }

    // ---- ICE server / policy config ---------------------------------------

    _applyIceServers(iceServers: RTCIceServer[]): void {
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
                    asWebRtcBin(this._webrtcbin).stun_server = `${proto}//${hostPort}`;
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
                        asWebRtcBin(this._webrtcbin).turn_server = turnUrl;
                    }
                } else {
                    throw new TypeError(`Unsupported ICE server protocol "${proto}"`);
                }
            }
        }
    }

    _applyIceTransportPolicy(policy?: RTCIceTransportPolicy): void {
        if (!policy) return;
        const gstPolicy =
            policy === 'relay' ? GstWebRTC.WebRTCICETransportPolicy.RELAY : GstWebRTC.WebRTCICETransportPolicy.ALL;
        try {
            asWebRtcBin(this._webrtcbin).ice_transport_policy = gstPolicy;
        } catch {
            /* ignore */
        }
    }

    private _applyBundlePolicy(policy?: RTCBundlePolicy): void {
        if (!policy) return;
        let gstPolicy: GstWebRTC.WebRTCBundlePolicy;
        switch (policy) {
            case 'balanced':
                gstPolicy = GstWebRTC.WebRTCBundlePolicy.BALANCED;
                break;
            case 'max-compat':
                gstPolicy = GstWebRTC.WebRTCBundlePolicy.MAX_COMPAT;
                break;
            case 'max-bundle':
                gstPolicy = GstWebRTC.WebRTCBundlePolicy.MAX_BUNDLE;
                break;
            default:
                return;
        }
        try {
            asWebRtcBin(this._webrtcbin).bundle_policy = gstPolicy;
        } catch {
            /* ignore */
        }
    }

    // ---- Properties --------------------------------------------------------

    get signalingState(): RTCSignalingState {
        if (this._closed) return 'closed';
        try {
            return gstToSignalingState(asWebRtcBin(this._webrtcbin).signaling_state);
        } catch {
            return 'stable';
        }
    }

    get connectionState(): RTCPeerConnectionState {
        if (this._closed) return 'closed';
        try {
            return gstToConnectionState(asWebRtcBin(this._webrtcbin).connection_state);
        } catch {
            return 'new';
        }
    }

    get iceConnectionState(): RTCIceConnectionState {
        if (this._closed) return 'closed';
        try {
            return gstToIceConnectionState(asWebRtcBin(this._webrtcbin).ice_connection_state);
        } catch {
            return 'new';
        }
    }

    get iceGatheringState(): RTCIceGatheringState {
        try {
            return gstToIceGatheringState(asWebRtcBin(this._webrtcbin).ice_gathering_state);
        } catch {
            return 'new';
        }
    }

    private _descProp(
        prop:
            | 'local_description'
            | 'remote_description'
            | 'current_local_description'
            | 'current_remote_description'
            | 'pending_local_description'
            | 'pending_remote_description',
    ): RTCSessionDescription | null {
        try {
            const desc = asWebRtcBin(this._webrtcbin)[prop];
            if (!desc) return null;
            return RTCSessionDescription.fromGstDesc(desc);
        } catch {
            return null;
        }
    }

    get localDescription(): RTCSessionDescription | null {
        return this._descProp('local_description');
    }
    get remoteDescription(): RTCSessionDescription | null {
        return this._descProp('remote_description');
    }
    get currentLocalDescription(): RTCSessionDescription | null {
        return this._descProp('current_local_description');
    }
    get currentRemoteDescription(): RTCSessionDescription | null {
        return this._descProp('current_remote_description');
    }
    get pendingLocalDescription(): RTCSessionDescription | null {
        return this._descProp('pending_local_description');
    }
    get pendingRemoteDescription(): RTCSessionDescription | null {
        return this._descProp('pending_remote_description');
    }

    get sctp(): RTCSctpTransport | null {
        return this._sctpTransport;
    }
    get peerIdentity(): Promise<never> {
        return Promise.reject(new TypeError('peerIdentity assertions are not implemented'));
    }
    get idpErrorInfo(): null {
        return null;
    }
    get idpLoginUrl(): null {
        return null;
    }

    // ---- Core methods ------------------------------------------------------

    // SDP-negotiation methods (createOffer, createAnswer, setLocalDescription,
    // setRemoteDescription, addIceCandidate) are installed on the prototype
    // from ./rtc-peer-connection/sdp-negotiation.ts at the bottom of this
    // file.

    _rejectIfClosed(method: string): void {
        if (!this._closed) return;
        throw new DOMException(`RTCPeerConnection.${method}: connection is closed`, 'InvalidStateError');
    }

    _setStructureField(
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

    close(): void {
        if (this._closed) return;
        this._closed = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                this._pipeline.set_state(Gst.State.NULL);
            } catch {
                /* ignore */
            }
            for (const ch of this._dataChannels.values()) {
                try {
                    ch._disconnectSignals();
                } catch {
                    /* ignore */
                }
            }
            this._dataChannels.clear();
            for (const s of this._senders) {
                try {
                    s._teardownPipeline();
                } catch {
                    /* ignore */
                }
            }
            for (const r of this._receivers) {
                try {
                    r._dispose();
                } catch {
                    /* ignore */
                }
            }
            this._transceivers.clear();
            this._senders.length = 0;
            this._receivers.length = 0;
            // Close transport objects
            if (this._dtlsTransport) this._dtlsTransport._setState('closed');
            if (this._iceTransport) this._iceTransport._setState('closed');
            if (this._sctpTransport) this._sctpTransport._setState('closed');
            try {
                this._bridge.dispose_bridge();
            } catch {
                /* ignore */
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---- Media / Transceiver API (Phase 2) ----------------------------------

    // `addTransceiver` is installed on the prototype from
    // ./rtc-peer-connection/transceivers.ts at the bottom of this file.
    //
    // `addTrack`, `removeTrack`, `getSenders`, `getReceivers`,
    // `getTransceivers` are installed on the prototype from
    // ./rtc-peer-connection/tracks.ts at the bottom of this file.
    //
    // `getStats`, `restartIce`, `setConfiguration`, `getConfiguration`
    // are installed on the prototype from
    // ./rtc-peer-connection/stats-and-config.ts at the bottom of this
    // file.

    getIdentityAssertion(): Promise<never> {
        return Promise.reject(new Error('getIdentityAssertion is not implemented'));
    }

    // ---- Transceiver helper -------------------------------------------------

    /** Find a GstWebRTCRTPTransceiver not yet in our map (created by request_pad_simple). */
    _findNewGstTransceiver(): GstWebRTC.WebRTCRTPTransceiver | null {
        for (let i = 0; ; i++) {
            // `get-transceiver` is an action signal — return value flows back at
            // runtime even though the GIR `emit()` overload is typed `void`.
            const gt = this._webrtcbin.emit('get-transceiver', i) as unknown as GstWebRTC.WebRTCRTPTransceiver | null;
            if (!gt) return null;
            if (!this._transceivers.has(gt)) return gt;
        }
    }

    /** Lazily create the shared DTLS and ICE transport instances (max-bundle → one pair). */
    _ensureTransports(): RTCDtlsTransport {
        if (!this._dtlsTransport) {
            this._iceTransport = new RTCIceTransport();
            this._dtlsTransport = new RTCDtlsTransport(this._iceTransport);
        }
        return this._dtlsTransport;
    }

    /** Create the SCTP transport when a data channel is first negotiated. */
    _ensureSctpTransport(): void {
        if (this._sctpTransport) return;
        const dtls = this._ensureTransports();
        this._sctpTransport = new RTCSctpTransport(dtls);
    }

    /**
     * @internal — attach the shared DTLS transport to every sender/receiver.
     * Called when a LOCAL description is applied: per W3C § 4.4.1.5 (set
     * session description → "create the DTLS transports") and the WPT
     * canonical refs/wpt/webrtc/RTCRtpSender.https.html, `sender.transport` /
     * `receiver.transport` is null until setLocalDescription ("null transport
     * initially", "a transport after sLD(offer)") and stays null on the peer
     * that only applied a REMOTE offer ("null transport after sRD(offer)").
     */
    _assignTransports(): void {
        const dtls = this._ensureTransports();
        for (const s of this._senders) s._transport = dtls;
        for (const r of this._receivers) r._transport = dtls;
    }

    /**
     * @internal — detach the transports again when the initial offer is
     * rolled back (WPT RTCRtpSender.https.html: "null transport after
     * rollback of sLD(offer)"). The caller only invokes this while no
     * negotiation has completed — after a completed offer/answer the
     * transports survive a renegotiation rollback.
     */
    _clearTransports(): void {
        for (const s of this._senders) s._transport = null;
        for (const r of this._receivers) r._transport = null;
    }

    _createTransceiverWrapper(gstTrans: GstWebRTC.WebRTCRTPTransceiver): RTCRtpTransceiver {
        let kind: 'audio' | 'video' = 'audio';
        try {
            const gstKind = gstTrans.kind;
            if (gstKind === GstWebRTC.WebRTCKind.VIDEO) kind = 'video';
        } catch {
            /* default audio */
        }

        const gstReceiver = gstTrans.receiver ?? null;
        const gstSender = gstTrans.sender ?? null;

        const receiver = new RTCRtpReceiver(kind, gstReceiver, this._pipeline);
        const sender = new RTCRtpSender(gstSender, this._pipeline, this._webrtcbin);
        sender._kind = kind;
        sender._onPipelineChanged = (newPipeline) => {
            this._pipeline = newPipeline;
        };

        // Wire stats delegation so sender.getStats() / receiver.getStats() work
        const statsDelegate = (track: MediaStreamTrack) => this.getStats(track);
        sender._getStatsForTrack = statsDelegate;
        receiver._getStatsForTrack = statsDelegate;

        // sender/receiver.transport stays null until a local description is
        // applied (W3C § 4.4.1.5; WPT RTCRtpSender.https.html "null transport
        // initially"). A transceiver created AFTER that point — e.g. by a
        // remote offer arriving once our own description is in place — picks
        // the shared transport up immediately.
        if (this.localDescription) {
            const dtls = this._ensureTransports();
            sender._transport = dtls;
            receiver._transport = dtls;
        }

        // Pass mline index to sender for sink pad naming
        try {
            const mline = gstTrans.mlineindex;
            if (typeof mline === 'number' && mline >= 0) {
                sender._setMlineIndex(mline);
            }
        } catch {
            /* ignore */
        }

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

    _handleNegotiationNeeded(): void {
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

        const gstTrans = asWebRtcSrcPad(pad).transceiver;
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
            // Pass the SCTP transport so RTCDataChannel.send can
            // enforce the W3C max-message-size ceiling.
            js = new RTCDataChannel(channelBridge, this._sctpTransport ?? undefined);
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
            case 'connectionstatechange':
                this._onconnectionstatechange?.call(this, ev);
                break;
            case 'iceconnectionstatechange':
                this._oniceconnectionstatechange?.call(this, ev);
                break;
            case 'icegatheringstatechange':
                this._onicegatheringstatechange?.call(this, ev);
                break;
            case 'signalingstatechange':
                this._onsignalingstatechange?.call(this, ev);
                break;
        }
        this.dispatchEvent(ev);
    }

    /** Map PC connection state → DTLS transport state. */
    private _syncDtlsState(): void {
        if (!this._dtlsTransport) return;
        const pcState = this.connectionState;
        const dtlsMap: Record<string, 'new' | 'connecting' | 'connected' | 'closed' | 'failed'> = {
            new: 'new',
            connecting: 'connecting',
            connected: 'connected',
            disconnected: 'connected', // DTLS stays connected even if ICE disconnects
            failed: 'failed',
            closed: 'closed',
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
        // RTCIceConnectionState ≡ RTCIceTransportState (same string union).
        this._iceTransport._setState(iceState);
    }

    /** Map PC ICE gathering state → ICE transport gathering state. */
    private _syncIceGatheringState(): void {
        if (!this._iceTransport) return;
        const gatheringState = this.iceGatheringState;
        this._iceTransport._setGatheringState(gatheringState);
    }

    // ---- on<event> attribute handlers --------------------------------------

    private _onconnectionstatechange: EventHandler = null;
    private _ondatachannel: EventHandler<RTCDataChannelEvent> = null;
    private _onicecandidate: EventHandler<RTCPeerConnectionIceEvent> = null;
    private _oniceconnectionstatechange: EventHandler = null;
    private _onicegatheringstatechange: EventHandler = null;
    private _onnegotiationneeded: EventHandler = null;
    private _onsignalingstatechange: EventHandler = null;

    get onconnectionstatechange() {
        return this._onconnectionstatechange;
    }
    set onconnectionstatechange(v: EventHandler) {
        this._onconnectionstatechange = v;
    }
    get ondatachannel() {
        return this._ondatachannel;
    }
    set ondatachannel(v: EventHandler<RTCDataChannelEvent>) {
        this._ondatachannel = v;
    }
    get onicecandidate() {
        return this._onicecandidate;
    }
    set onicecandidate(v: EventHandler<RTCPeerConnectionIceEvent>) {
        this._onicecandidate = v;
    }
    get oniceconnectionstatechange() {
        return this._oniceconnectionstatechange;
    }
    set oniceconnectionstatechange(v: EventHandler) {
        this._oniceconnectionstatechange = v;
    }
    get onicegatheringstatechange() {
        return this._onicegatheringstatechange;
    }
    set onicegatheringstatechange(v: EventHandler) {
        this._onicegatheringstatechange = v;
    }
    get onnegotiationneeded() {
        return this._onnegotiationneeded;
    }
    set onnegotiationneeded(v: EventHandler) {
        this._onnegotiationneeded = v;
    }
    get onsignalingstatechange() {
        return this._onsignalingstatechange;
    }
    set onsignalingstatechange(v: EventHandler) {
        this._onsignalingstatechange = v;
    }

    private _ontrack: EventHandler<RTCTrackEvent> = null;
    get ontrack() {
        return this._ontrack;
    }
    set ontrack(v: EventHandler<RTCTrackEvent>) {
        this._ontrack = v;
    }
    get onicecandidateerror(): EventHandler {
        return null;
    }
    set onicecandidateerror(_v: EventHandler) {
        /* no-op */
    }

    // ---- Certificate management (Phase 4.7) --------------------------------

    static generateCertificate(keygenAlgorithm: AlgorithmIdentifier): Promise<RTCCertificate> {
        return generateCertificate(keygenAlgorithm);
    }
}

// Wire focused method groups into RTCPeerConnection.prototype, same pattern
// as the WebGL2 / canvas2d-core splits (PRs #273, #262). The side-effect
// imports are kept separate from the named imports so tsc preserves them
// in the emitted `.d.ts` — downstream consumers need the `declare module`
// augmentations loaded to see the extracted methods on the published type.
import './rtc-peer-connection/sdp-negotiation.js';
import './rtc-peer-connection/data-channel.js';
import './rtc-peer-connection/transceivers.js';
import './rtc-peer-connection/tracks.js';
import './rtc-peer-connection/stats-and-config.js';
import { installSdpNegotiationMethods } from './rtc-peer-connection/sdp-negotiation.js';
import { installDataChannelMethods } from './rtc-peer-connection/data-channel.js';
import { installTransceiverMethods } from './rtc-peer-connection/transceivers.js';
import { installTrackMethods } from './rtc-peer-connection/tracks.js';
import { installStatsAndConfigMethods } from './rtc-peer-connection/stats-and-config.js';
installSdpNegotiationMethods(RTCPeerConnection.prototype);
installDataChannelMethods(RTCPeerConnection.prototype);
installTransceiverMethods(RTCPeerConnection.prototype);
installTrackMethods(RTCPeerConnection.prototype);
installStatsAndConfigMethods(RTCPeerConnection.prototype);
