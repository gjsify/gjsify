// Registers: RTCDataChannel, RTCDataChannelEvent.

import { RTCDataChannel } from '../rtc-data-channel.js';
import { RTCDataChannelEvent } from '../rtc-events.js';

/** Module-local typed view of the globals this file writes. */
interface _RtcDataChannelGlobals {
    RTCDataChannel?: typeof RTCDataChannel;
    RTCDataChannelEvent?: typeof RTCDataChannelEvent;
}

const g = globalThis as unknown as _RtcDataChannelGlobals;

if (typeof g.RTCDataChannel === 'undefined') {
    g.RTCDataChannel = RTCDataChannel;
}
if (typeof g.RTCDataChannelEvent === 'undefined') {
    g.RTCDataChannelEvent = RTCDataChannelEvent;
}
