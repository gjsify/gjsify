// GStreamer ↔ W3C enum conversions for WebRTC types.
//
// Centralises the bidirectional mapping between GstWebRTC C enums and
// W3C string literals used across RTCPeerConnection and RTCRtpTransceiver.

import GstWebRTC from 'gi://GstWebRTC?version=1.0';

import type {
    RTCSignalingState,
    RTCPeerConnectionState,
    RTCIceConnectionState,
    RTCIceGatheringState,
} from './rtc-peer-connection.js';
import type { RTCRtpTransceiverDirection } from './rtc-rtp-sender.js';

// ---- Signaling state --------------------------------------------------------

const SIGNALING_STATE_MAP: Record<number, RTCSignalingState> = {
    [GstWebRTC.WebRTCSignalingState.STABLE]: 'stable',
    [GstWebRTC.WebRTCSignalingState.CLOSED]: 'closed',
    [GstWebRTC.WebRTCSignalingState.HAVE_LOCAL_OFFER]: 'have-local-offer',
    [GstWebRTC.WebRTCSignalingState.HAVE_REMOTE_OFFER]: 'have-remote-offer',
    [GstWebRTC.WebRTCSignalingState.HAVE_LOCAL_PRANSWER]: 'have-local-pranswer',
    [GstWebRTC.WebRTCSignalingState.HAVE_REMOTE_PRANSWER]: 'have-remote-pranswer',
};

export function gstToSignalingState(v: number): RTCSignalingState {
    return SIGNALING_STATE_MAP[v] ?? 'stable';
}

// ---- Connection state -------------------------------------------------------

const CONNECTION_STATE_MAP: Record<number, RTCPeerConnectionState> = {
    [GstWebRTC.WebRTCPeerConnectionState.NEW]: 'new',
    [GstWebRTC.WebRTCPeerConnectionState.CONNECTING]: 'connecting',
    [GstWebRTC.WebRTCPeerConnectionState.CONNECTED]: 'connected',
    [GstWebRTC.WebRTCPeerConnectionState.DISCONNECTED]: 'disconnected',
    [GstWebRTC.WebRTCPeerConnectionState.FAILED]: 'failed',
    [GstWebRTC.WebRTCPeerConnectionState.CLOSED]: 'closed',
};

export function gstToConnectionState(v: number): RTCPeerConnectionState {
    return CONNECTION_STATE_MAP[v] ?? 'new';
}

// ---- ICE connection state ---------------------------------------------------

const ICE_CONNECTION_STATE_MAP: Record<number, RTCIceConnectionState> = {
    [GstWebRTC.WebRTCICEConnectionState.NEW]: 'new',
    [GstWebRTC.WebRTCICEConnectionState.CHECKING]: 'checking',
    [GstWebRTC.WebRTCICEConnectionState.CONNECTED]: 'connected',
    [GstWebRTC.WebRTCICEConnectionState.COMPLETED]: 'completed',
    [GstWebRTC.WebRTCICEConnectionState.FAILED]: 'failed',
    [GstWebRTC.WebRTCICEConnectionState.DISCONNECTED]: 'disconnected',
    [GstWebRTC.WebRTCICEConnectionState.CLOSED]: 'closed',
};

export function gstToIceConnectionState(v: number): RTCIceConnectionState {
    return ICE_CONNECTION_STATE_MAP[v] ?? 'new';
}

// ---- ICE gathering state ----------------------------------------------------

const ICE_GATHERING_STATE_MAP: Record<number, RTCIceGatheringState> = {
    [GstWebRTC.WebRTCICEGatheringState.NEW]: 'new',
    [GstWebRTC.WebRTCICEGatheringState.GATHERING]: 'gathering',
    [GstWebRTC.WebRTCICEGatheringState.COMPLETE]: 'complete',
};

export function gstToIceGatheringState(v: number): RTCIceGatheringState {
    return ICE_GATHERING_STATE_MAP[v] ?? 'new';
}

// ---- Transceiver direction (bidirectional) ----------------------------------

const DIRECTION_GST_TO_W3C: Record<number, RTCRtpTransceiverDirection> = {
    [GstWebRTC.WebRTCRTPTransceiverDirection.SENDRECV]: 'sendrecv',
    [GstWebRTC.WebRTCRTPTransceiverDirection.SENDONLY]: 'sendonly',
    [GstWebRTC.WebRTCRTPTransceiverDirection.RECVONLY]: 'recvonly',
};

const DIRECTION_W3C_TO_GST: Record<string, number> = {
    sendrecv: GstWebRTC.WebRTCRTPTransceiverDirection.SENDRECV,
    sendonly: GstWebRTC.WebRTCRTPTransceiverDirection.SENDONLY,
    recvonly: GstWebRTC.WebRTCRTPTransceiverDirection.RECVONLY,
    inactive: GstWebRTC.WebRTCRTPTransceiverDirection.NONE,
};

export function gstDirectionToW3C(v: number): RTCRtpTransceiverDirection {
    return DIRECTION_GST_TO_W3C[v] ?? 'inactive';
}

export function w3cDirectionToGst(d: RTCRtpTransceiverDirection): number {
    return DIRECTION_W3C_TO_GST[d] ?? GstWebRTC.WebRTCRTPTransceiverDirection.NONE;
}
