/**
 * Re-exports native WebRTC globals for browser builds.
 *
 * `RTCPeerConnection` and the related RTP/media hierarchy are universal
 * in modern browsers (Chrome 28+, Firefox 22+, Safari 11+).
 *
 * The dynamic resolver in `@gjsify/resolve-npm/runtime-aliases.mjs` routes
 * `@gjsify/webrtc` here when `package.json#gjsify.runtimes.browser === "native"`.
 *
 * NOT used on Node — Node has no RTCPeerConnection global.
 */

export const RTCPeerConnection = globalThis.RTCPeerConnection;
export const RTCDataChannel = globalThis.RTCDataChannel;
export const RTCRtpSender = globalThis.RTCRtpSender;
export const RTCRtpReceiver = globalThis.RTCRtpReceiver;
export const RTCRtpTransceiver = globalThis.RTCRtpTransceiver;
export const RTCSessionDescription = globalThis.RTCSessionDescription;
export const RTCIceCandidate = globalThis.RTCIceCandidate;
export const RTCCertificate = globalThis.RTCCertificate;
export const RTCStatsReport = globalThis.RTCStatsReport;
export const RTCDTMFSender = globalThis.RTCDTMFSender;
export const MediaStream = globalThis.MediaStream;
export const MediaStreamTrack = globalThis.MediaStreamTrack;
