// Registers: RTCError, RTCErrorEvent.

import { RTCError } from '../rtc-error.js';
import { RTCErrorEvent } from '../rtc-events.js';

/** Module-local typed view of the globals this file writes. */
interface _RtcErrorGlobals {
    RTCError?: typeof RTCError;
    RTCErrorEvent?: typeof RTCErrorEvent;
}

const g = globalThis as unknown as _RtcErrorGlobals;

if (typeof g.RTCError === 'undefined') {
    g.RTCError = RTCError;
}
if (typeof g.RTCErrorEvent === 'undefined') {
    g.RTCErrorEvent = RTCErrorEvent;
}
