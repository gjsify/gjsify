// W3C RTCRtpReceiver for GJS.
//
// Phase 2: API surface wrapping GstWebRTC.WebRTCRTPReceiver. Creates a stub
// MediaStreamTrack (muted, 'live') per receiver. No GStreamer pipeline
// connection — that is Phase 2.5.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCRtpReceiver.ts (ISC)
// Reference: W3C WebRTC spec § 5.3

import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

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

    constructor(kind: 'audio' | 'video', gstReceiver: GstWebRTC.WebRTCRTPReceiver | null) {
        this._gstReceiver = gstReceiver;
        this._track = new MediaStreamTrack({ kind, muted: true });
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
