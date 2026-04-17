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

    get track(): MediaStreamTrack { return this._track; }
    get transport(): null { return null; }

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

    async getStats(): Promise<never> {
        throw new DOMException(
            'RTCRtpReceiver.getStats is not implemented',
            'NotSupportedError',
        );
    }

    static getCapabilities(kind: string): RTCRtpCapabilities | null {
        if (kind === 'audio') {
            return {
                codecs: [
                    { mimeType: 'audio/opus', clockRate: 48000, channels: 2, sdpFmtpLine: 'minptime=10;useinbandfec=1' },
                    { mimeType: 'audio/G722', clockRate: 8000, channels: 1 },
                    { mimeType: 'audio/PCMU', clockRate: 8000, channels: 1 },
                    { mimeType: 'audio/PCMA', clockRate: 8000, channels: 1 },
                    { mimeType: 'audio/telephone-event', clockRate: 8000, channels: 1 },
                    { mimeType: 'audio/red', clockRate: 48000, channels: 2 },
                ],
                headerExtensions: [
                    { uri: 'urn:ietf:params:rtp-hdrext:ssrc-audio-level' },
                    { uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' },
                    { uri: 'urn:ietf:params:rtp-hdrext:sdes:mid' },
                ],
            };
        }
        if (kind === 'video') {
            return {
                codecs: [
                    { mimeType: 'video/VP8', clockRate: 90000 },
                    { mimeType: 'video/rtx', clockRate: 90000 },
                    { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f' },
                    { mimeType: 'video/VP9', clockRate: 90000 },
                    { mimeType: 'video/red', clockRate: 90000 },
                    { mimeType: 'video/ulpfec', clockRate: 90000 },
                ],
                headerExtensions: [
                    { uri: 'urn:ietf:params:rtp-hdrext:toffset' },
                    { uri: 'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time' },
                    { uri: 'urn:3gpp:video-orientation' },
                    { uri: 'urn:ietf:params:rtp-hdrext:sdes:mid' },
                    { uri: 'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id' },
                    { uri: 'urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id' },
                ],
            };
        }
        return null;
    }
}
