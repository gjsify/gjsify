// W3C RTCRtpSender for GJS.
//
// Phase 2: API surface wrapping GstWebRTC.WebRTCRTPSender. Most methods are
// stubs; getCapabilities() returns a hardcoded set of codecs that GStreamer
// with gst-plugins-bad typically supports.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCRtpSender.ts (ISC)
// Reference: W3C WebRTC spec § 5.2

import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

import type { MediaStreamTrack } from './media-stream-track.js';
import type { MediaStream } from './media-stream.js';

export type RTCRtpTransceiverDirection = 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive' | 'stopped';

export interface RTCRtpCodecCapability {
    mimeType: string;
    clockRate: number;
    channels?: number;
    sdpFmtpLine?: string;
}

export interface RTCRtpHeaderExtensionCapability {
    uri: string;
}

export interface RTCRtpCapabilities {
    codecs: RTCRtpCodecCapability[];
    headerExtensions: RTCRtpHeaderExtensionCapability[];
}

export interface RTCRtpEncodingParameters {
    rid?: string;
    active?: boolean;
    maxBitrate?: number;
    maxFramerate?: number;
    scaleResolutionDownBy?: number;
}

export interface RTCRtpCodecParameters {
    payloadType: number;
    mimeType: string;
    clockRate: number;
    channels?: number;
    sdpFmtpLine?: string;
}

export interface RTCRtpHeaderExtensionParameters {
    uri: string;
    id: number;
    encrypted?: boolean;
}

export interface RTCRtcpParameters {
    cname?: string;
    reducedSize?: boolean;
}

export interface RTCRtpSendParameters {
    transactionId: string;
    encodings: RTCRtpEncodingParameters[];
    codecs: RTCRtpCodecParameters[];
    headerExtensions: RTCRtpHeaderExtensionParameters[];
    rtcp: RTCRtcpParameters;
}

let _txCounter = 0;

export class RTCRtpSender {
    private _gstSender: GstWebRTC.WebRTCRTPSender | null;
    private _track: MediaStreamTrack | null = null;
    private _lastParams: RTCRtpSendParameters | null = null;

    constructor(gstSender: GstWebRTC.WebRTCRTPSender | null) {
        this._gstSender = gstSender;
    }

    get track(): MediaStreamTrack | null { return this._track; }
    get dtmf(): null { return null; }
    get transport(): null { return null; }

    /** @internal */
    _setTrack(track: MediaStreamTrack | null): void { this._track = track; }

    getParameters(): RTCRtpSendParameters {
        if (!this._lastParams) {
            this._lastParams = {
                transactionId: String(++_txCounter),
                encodings: [],
                codecs: [],
                headerExtensions: [],
                rtcp: {},
            };
        }
        return { ...this._lastParams, encodings: [...this._lastParams.encodings] };
    }

    async setParameters(params: RTCRtpSendParameters): Promise<void> {
        if (!this._lastParams) {
            throw new DOMException(
                'getParameters must be called before setParameters',
                'InvalidStateError',
            );
        }
        if (params.transactionId !== this._lastParams.transactionId) {
            throw new DOMException(
                'transactionId mismatch',
                'InvalidModificationError',
            );
        }
        this._lastParams = null;
    }

    async replaceTrack(_track: MediaStreamTrack | null): Promise<void> {
        // Phase 2: no-op
    }

    async getStats(): Promise<never> {
        throw new DOMException(
            'RTCRtpSender.getStats is not implemented',
            'NotSupportedError',
        );
    }

    setStreams(..._streams: MediaStream[]): void {
        // Phase 2: no-op
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
