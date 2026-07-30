// Shared RTP codec capabilities for RTCRtpSender and RTCRtpReceiver.
//
// Both classes expose identical getCapabilities(kind) static methods per
// W3C WebRTC spec §§ 5.2 and 5.3. This module deduplicates the data.

import type { RTCRtpCapabilities } from './rtc-rtp-sender.js';

const AUDIO_CAPABILITIES: RTCRtpCapabilities = {
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

const VIDEO_CAPABILITIES: RTCRtpCapabilities = {
    codecs: [
        { mimeType: 'video/VP8', clockRate: 90000 },
        { mimeType: 'video/rtx', clockRate: 90000 },
        {
            mimeType: 'video/H264',
            clockRate: 90000,
            sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
        },
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

/** Shared implementation for RTCRtpSender.getCapabilities / RTCRtpReceiver.getCapabilities. */
export function getRtpCapabilities(kind: string): RTCRtpCapabilities | null {
    if (kind === 'audio') return AUDIO_CAPABILITIES;
    if (kind === 'video') return VIDEO_CAPABILITIES;
    return null;
}

// Standard RTP payload types used in WebRTC SDP — shared between the Path-A
// encoder chain (opusenc→rtpopuspay / vp8enc→rtpvp8pay in rtc-rtp-sender.ts)
// and the Path-B kind-only transceiver caps below.
export const OPUS_PAYLOAD_TYPE = 111;
export const VP8_PAYLOAD_TYPE = 96;

/**
 * Full RTP caps for a kind-only (Path-B) `add-transceiver`. webrtcbin needs
 * `encoding-name`/`clock-rate`/`payload` to build an m-section for the
 * transceiver — `application/x-rtp,media=audio` alone yields an offer with
 * NO m-line at all (measured on GStreamer 1.28: create-offer returned only
 * the session-level `v=/o=/s=/t=` + `a=ice-options:trickle`). Mirrors the
 * caps the Path-A encoder chain advertises via its capsfilter.
 */
export function defaultRtpCapsString(kind: 'audio' | 'video'): string {
    return kind === 'audio'
        ? `application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000,payload=${OPUS_PAYLOAD_TYPE}`
        : `application/x-rtp,media=video,encoding-name=VP8,clock-rate=90000,payload=${VP8_PAYLOAD_TYPE}`;
}
