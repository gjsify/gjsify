// Registers: MediaStream, MediaStreamTrack, RTCTrackEvent.

import { MediaStream } from '../media-stream.js';
import { MediaStreamTrack } from '../media-stream-track.js';
import { RTCTrackEvent } from '../rtc-track-event.js';

/** Module-local typed view of the globals this file writes. */
interface _RtcMediaGlobals {
    MediaStream?: unknown;
    MediaStreamTrack?: unknown;
    RTCTrackEvent?: unknown;
}

const g = globalThis as unknown as _RtcMediaGlobals;

if (typeof g.MediaStream === 'undefined') {
    g.MediaStream = MediaStream;
}
if (typeof g.MediaStreamTrack === 'undefined') {
    g.MediaStreamTrack = MediaStreamTrack;
}
if (typeof g.RTCTrackEvent === 'undefined') {
    g.RTCTrackEvent = RTCTrackEvent;
}
