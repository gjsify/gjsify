// W3C RTCRtpReceiver for GJS.
//
// Wraps GstWebRTC.WebRTCRTPReceiver. Phase 2.5: incoming media pipeline
// is managed by ReceiverBridge (Vala) which handles decodebin's
// streaming-thread signals natively and emits media-flowing on the
// main thread when decoded media replaces the muted source.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCRtpReceiver.ts (ISC)
// Reference: W3C WebRTC spec § 5.3

import type GstWebRTC from 'gi://GstWebRTC?version=1.0';
import type Gst from 'gi://Gst?version=1.0';

import {
    ReceiverBridge,
    type ReceiverBridge as ReceiverBridgeType,
} from '@gjsify/webrtc-native';

import { MediaStreamTrack } from './media-stream-track.js';
import { getRtpCapabilities } from './rtp-capabilities.js';
import type { RTCStatsReport } from './rtc-stats-report.js';
import type { RTCDtlsTransport } from './rtc-dtls-transport.js';
import type { RTCRtpCapabilities, RTCRtpCodecParameters, RTCRtpHeaderExtensionParameters, RTCRtcpParameters } from './rtc-rtp-sender.js';

export interface RTCRtpReceiveParameters {
    codecs: RTCRtpCodecParameters[];
    headerExtensions: RTCRtpHeaderExtensionParameters[];
    rtcp: RTCRtcpParameters;
}

export interface RTCRtpContributingSource {
    timestamp: number;
    source: number;
    audioLevel?: number;
    rtpTimestamp: number;
}

export interface RTCRtpSynchronizationSource extends RTCRtpContributingSource {
    voiceActivityFlag?: boolean;
}

const MAX_JITTER_BUFFER_TARGET = 4000;

export class RTCRtpReceiver {
    private _gstReceiver: GstWebRTC.WebRTCRTPReceiver | null;
    private _track: MediaStreamTrack;
    private _jitterBufferTarget: number | null = null;
    private _pipeline: any = null;
    private _receiverBridge: ReceiverBridgeType | null = null;
    /** @internal — stats callback set by RTCPeerConnection */
    _getStatsForTrack: ((track: MediaStreamTrack) => Promise<RTCStatsReport>) | null = null;

    constructor(kind: 'audio' | 'video', gstReceiver: GstWebRTC.WebRTCRTPReceiver | null, pipeline?: any) {
        this._gstReceiver = gstReceiver;
        this._pipeline = pipeline ?? null;
        this._track = new MediaStreamTrack({ kind, muted: true });
    }

    /** @internal — called from RTCPeerConnection._handlePadAdded */
    _connectToPad(pad: Gst.Pad): void {
        if (!this._pipeline || this._receiverBridge) return;
        this._receiverBridge = new (ReceiverBridge as any)({
            pipeline: this._pipeline,
            kind: this._track.kind,
        });
        this._receiverBridge!.connect_to_pad(pad);
        this._receiverBridge!.connect('media-flowing', () => {
            this._track._setMuted(false);
        });
    }

    /** @internal — called from RTCPeerConnection.close() */
    _dispose(): void {
        try { this._receiverBridge?.dispose_bridge(); } catch { /* ignore */ }
        this._receiverBridge = null;
    }

    /** @internal — set by RTCPeerConnection */
    _transport: RTCDtlsTransport | null = null;

    get track(): MediaStreamTrack { return this._track; }
    get transport(): RTCDtlsTransport | null { return this._transport; }

    get jitterBufferTarget(): number | null { return this._jitterBufferTarget; }
    set jitterBufferTarget(v: number | null) {
        if (v === null) {
            this._jitterBufferTarget = null;
            return;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
            throw new RangeError(`Failed to set jitterBufferTarget: ${v} is negative or not finite`);
        }
        if (n > MAX_JITTER_BUFFER_TARGET) {
            throw new RangeError(`Failed to set jitterBufferTarget: ${v} exceeds maximum of ${MAX_JITTER_BUFFER_TARGET}`);
        }
        this._jitterBufferTarget = n;
    }

    getParameters(): RTCRtpReceiveParameters {
        return {
            codecs: [],
            headerExtensions: [],
            rtcp: {},
        };
    }

    getContributingSources(): RTCRtpContributingSource[] { return []; }
    getSynchronizationSources(): RTCRtpSynchronizationSource[] { return []; }

    async getStats(): Promise<RTCStatsReport> {
        if (this._getStatsForTrack && this._track) {
            return this._getStatsForTrack(this._track);
        }
        const { RTCStatsReport: Report } = await import('./rtc-stats-report.js');
        return new Report();
    }

    static getCapabilities(kind: string): RTCRtpCapabilities | null {
        return getRtpCapabilities(kind);
    }
}
