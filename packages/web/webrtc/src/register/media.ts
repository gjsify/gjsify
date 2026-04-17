// Registers: MediaStream, MediaStreamTrack, RTCTrackEvent.

import { MediaStream } from '../media-stream.js';
import { MediaStreamTrack } from '../media-stream-track.js';
import { RTCTrackEvent } from '../rtc-track-event.js';

if (typeof (globalThis as any).MediaStream === 'undefined') {
    (globalThis as any).MediaStream = MediaStream;
}
if (typeof (globalThis as any).MediaStreamTrack === 'undefined') {
    (globalThis as any).MediaStreamTrack = MediaStreamTrack;
}
if (typeof (globalThis as any).RTCTrackEvent === 'undefined') {
    (globalThis as any).RTCTrackEvent = RTCTrackEvent;
}
