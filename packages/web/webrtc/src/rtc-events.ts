// W3C WebRTC event classes.
//
// Reference: refs/node-gst-webrtc/src/webrtc/events.ts (ISC) +
//            https://www.w3.org/TR/webrtc/#rtcpeerconnectioniceevent-interface
//            https://www.w3.org/TR/webrtc/#rtcdatachannelevent-interface
//            https://www.w3.org/TR/webrtc/#rtcerrorevent-interface
//
// CLAUDE.md Rule 8 exception: the class declarations below extend the
// global `Event` constructor, which runs at module load. Seed the global
// before the class bodies are evaluated.

import '@gjsify/dom-events/register/event-target';

import type { RTCIceCandidate } from './rtc-ice-candidate.js';
import type { RTCDataChannel } from './rtc-data-channel.js';
import type { RTCError } from './rtc-error.js';

export interface RTCPeerConnectionIceEventInit extends EventInit {
    candidate?: RTCIceCandidate | null;
    url?: string | null;
}

export class RTCPeerConnectionIceEvent extends Event {
    readonly candidate: RTCIceCandidate | null;
    readonly url: string | null;

    constructor(type: string, init: RTCPeerConnectionIceEventInit = {}) {
        super(type, init);
        this.candidate = init.candidate ?? null;
        this.url = init.url ?? null;
    }
}

export interface RTCDataChannelEventInit extends EventInit {
    channel: RTCDataChannel;
}

export class RTCDataChannelEvent extends Event {
    readonly channel: RTCDataChannel;

    constructor(type: string, init: RTCDataChannelEventInit) {
        super(type, init);
        if (!init || !init.channel) {
            throw new TypeError('RTCDataChannelEvent requires a `channel` member');
        }
        this.channel = init.channel;
    }
}

export interface RTCErrorEventInit extends EventInit {
    error: RTCError;
}

export class RTCErrorEvent extends Event {
    readonly error: RTCError;

    constructor(type: string, init: RTCErrorEventInit) {
        super(type, init);
        if (!init || !init.error) {
            throw new TypeError('RTCErrorEvent requires an `error` member');
        }
        this.error = init.error;
    }
}
