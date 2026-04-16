// Registers: RTCError, RTCErrorEvent.

import { RTCError } from '../rtc-error.js';
import { RTCErrorEvent } from '../rtc-events.js';

if (typeof (globalThis as any).RTCError === 'undefined') {
    (globalThis as any).RTCError = RTCError;
}
if (typeof (globalThis as any).RTCErrorEvent === 'undefined') {
    (globalThis as any).RTCErrorEvent = RTCErrorEvent;
}
