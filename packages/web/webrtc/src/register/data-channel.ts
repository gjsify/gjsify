// Registers: RTCDataChannel, RTCDataChannelEvent.

import { RTCDataChannel } from '../rtc-data-channel.js';
import { RTCDataChannelEvent } from '../rtc-events.js';

if (typeof (globalThis as any).RTCDataChannel === 'undefined') {
    (globalThis as any).RTCDataChannel = RTCDataChannel;
}
if (typeof (globalThis as any).RTCDataChannelEvent === 'undefined') {
    (globalThis as any).RTCDataChannelEvent = RTCDataChannelEvent;
}
