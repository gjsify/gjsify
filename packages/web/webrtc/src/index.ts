// W3C WebRTC API for GJS — backed by GStreamer webrtcbin.
//
// This module has no side effects. Importing @gjsify/webrtc gives named
// access to the classes but does NOT register globals. Use
// @gjsify/webrtc/register (or a granular subpath) to set globalThis.RTCPeerConnection etc.

export { RTCPeerConnection } from './rtc-peer-connection.js';
export type {
    RTCConfiguration,
    RTCIceServer,
    RTCOfferOptions,
    RTCAnswerOptions,
    RTCDataChannelInit,
    RTCSignalingState,
    RTCPeerConnectionState,
    RTCIceConnectionState,
    RTCIceGatheringState,
    RTCIceTransportPolicy,
    RTCBundlePolicy,
    RTCRtcpMuxPolicy,
} from './rtc-peer-connection.js';

export { RTCDataChannel } from './rtc-data-channel.js';
export type { RTCDataChannelState, BinaryType } from './rtc-data-channel.js';

export { RTCSessionDescription } from './rtc-session-description.js';
export type { RTCSessionDescriptionInit, RTCSdpType } from './rtc-session-description.js';

export { RTCIceCandidate } from './rtc-ice-candidate.js';
export type {
    RTCIceCandidateInit,
    RTCIceComponent,
    RTCIceProtocol,
    RTCIceCandidateType,
    RTCIceTcpCandidateType,
} from './rtc-ice-candidate.js';

export { RTCError } from './rtc-error.js';
export type { RTCErrorInit, RTCErrorDetailType } from './rtc-error.js';

export {
    RTCPeerConnectionIceEvent,
    RTCDataChannelEvent,
    RTCErrorEvent,
} from './rtc-events.js';
export type {
    RTCPeerConnectionIceEventInit,
    RTCDataChannelEventInit,
    RTCErrorEventInit,
} from './rtc-events.js';
