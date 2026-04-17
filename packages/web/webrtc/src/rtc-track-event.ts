// W3C RTCTrackEvent for GJS.
//
// Ported from refs/wpt/webrtc/RTCTrackEvent-constructor.html (W3C, BSD-3-Clause)
// Reference: W3C WebRTC spec § 5.7

import '@gjsify/dom-events/register/event-target';

import type { RTCRtpReceiver } from './rtc-rtp-receiver.js';
import type { RTCRtpTransceiver } from './rtc-rtp-transceiver.js';
import type { MediaStreamTrack } from './media-stream-track.js';
import type { MediaStream } from './media-stream.js';

export interface RTCTrackEventInit extends EventInit {
    receiver: RTCRtpReceiver;
    track: MediaStreamTrack;
    streams?: MediaStream[];
    transceiver: RTCRtpTransceiver;
}

export class RTCTrackEvent extends Event {
    readonly receiver: RTCRtpReceiver;
    readonly track: MediaStreamTrack;
    readonly streams: ReadonlyArray<MediaStream>;
    readonly transceiver: RTCRtpTransceiver;

    constructor(type: string, init: RTCTrackEventInit) {
        super(type, init);
        if (!init || typeof init !== 'object') {
            throw new TypeError('RTCTrackEventInit is required');
        }
        if (!('receiver' in init)) {
            throw new TypeError("Failed to construct 'RTCTrackEvent': required member receiver is not provided.");
        }
        if (!('track' in init)) {
            throw new TypeError("Failed to construct 'RTCTrackEvent': required member track is not provided.");
        }
        if (!('transceiver' in init)) {
            throw new TypeError("Failed to construct 'RTCTrackEvent': required member transceiver is not provided.");
        }
        this.receiver = init.receiver;
        this.track = init.track;
        this.streams = Object.freeze(init.streams ? [...init.streams] : []);
        this.transceiver = init.transceiver;
    }
}
