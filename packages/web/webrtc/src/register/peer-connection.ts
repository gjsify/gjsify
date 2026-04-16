// Registers: RTCPeerConnection, RTCSessionDescription, RTCIceCandidate,
// RTCPeerConnectionIceEvent.

import { RTCPeerConnection } from '../rtc-peer-connection.js';
import { RTCSessionDescription } from '../rtc-session-description.js';
import { RTCIceCandidate } from '../rtc-ice-candidate.js';
import { RTCPeerConnectionIceEvent } from '../rtc-events.js';

if (typeof (globalThis as any).RTCPeerConnection === 'undefined') {
    (globalThis as any).RTCPeerConnection = RTCPeerConnection;
}
if (typeof (globalThis as any).RTCSessionDescription === 'undefined') {
    (globalThis as any).RTCSessionDescription = RTCSessionDescription;
}
if (typeof (globalThis as any).RTCIceCandidate === 'undefined') {
    (globalThis as any).RTCIceCandidate = RTCIceCandidate;
}
if (typeof (globalThis as any).RTCPeerConnectionIceEvent === 'undefined') {
    (globalThis as any).RTCPeerConnectionIceEvent = RTCPeerConnectionIceEvent;
}
