// Registers: RTCPeerConnection, RTCSessionDescription, RTCIceCandidate,
// RTCPeerConnectionIceEvent.

import { RTCPeerConnection } from '../rtc-peer-connection.js';
import { RTCSessionDescription } from '../rtc-session-description.js';
import { RTCIceCandidate } from '../rtc-ice-candidate.js';
import { RTCPeerConnectionIceEvent } from '../rtc-events.js';

/** Module-local typed view of the globals this file writes. */
interface _RtcPeerGlobals {
    RTCPeerConnection?: unknown;
    RTCSessionDescription?: unknown;
    RTCIceCandidate?: unknown;
    RTCPeerConnectionIceEvent?: unknown;
}

const g = globalThis as unknown as _RtcPeerGlobals;

if (typeof g.RTCPeerConnection === 'undefined') {
    g.RTCPeerConnection = RTCPeerConnection;
}
if (typeof g.RTCSessionDescription === 'undefined') {
    g.RTCSessionDescription = RTCSessionDescription;
}
if (typeof g.RTCIceCandidate === 'undefined') {
    g.RTCIceCandidate = RTCIceCandidate;
}
if (typeof g.RTCPeerConnectionIceEvent === 'undefined') {
    g.RTCPeerConnectionIceEvent = RTCPeerConnectionIceEvent;
}
