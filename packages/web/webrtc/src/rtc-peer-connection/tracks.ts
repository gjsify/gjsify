// Track / sender / receiver management for RTCPeerConnection — extracted
// via the `install*Methods(proto)` pattern (same shape as the
// SDP-negotiation split, PR #287, and the canvas2d-core / webgl2 splits
// PRs #262/#273).
//
// Covers the W3C `RTCPeerConnection` track-mutating methods plus the
// read-only sender/receiver/transceiver accessors:
//
//   addTrack, removeTrack, getSenders, getReceivers, getTransceivers
//
// The accessors are trivially small (return a `[…array]` copy) but they
// keep the conceptual grouping intact — moving them together with their
// mutating siblings makes the host class read straight ("track API
// surface lives in tracks.ts") without forcing the next reader to ping
// back and forth between two files for the same feature.
//
// Method bodies are moved verbatim from the pre-split
// `rtc-peer-connection.ts`. They read/write the host class's
// `_senders`, `_receivers`, `_transceivers` fields and call the
// `_rejectIfClosed` helper via their `this: RTCPeerConnection` typing.
// Those slots are demoted from `private` to package-internal
// (`_`-prefixed) by this PR — same convention as the SDP-negotiation
// split (PR #287).
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCPeerConnection.ts (ISC).

import { DOMException } from '@gjsify/dom-exception';
import { MediaStreamTrack } from '../media-stream-track.js';
import type { MediaStream } from '../media-stream.js';
import type { RTCRtpSender } from '../rtc-rtp-sender.js';
import type { RTCRtpReceiver } from '../rtc-rtp-receiver.js';
import type { RTCRtpTransceiver } from '../rtc-rtp-transceiver.js';
import type { RTCPeerConnection } from '../rtc-peer-connection.js';

export interface TrackMethods {
    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender;
    removeTrack(sender: RTCRtpSender): void;
    getSenders(): RTCRtpSender[];
    getReceivers(): RTCRtpReceiver[];
    getTransceivers(): RTCRtpTransceiver[];
}

declare module '../rtc-peer-connection.js' {
    interface RTCPeerConnection extends TrackMethods {}
}

const trackMethods: TrackMethods & ThisType<RTCPeerConnection> = {
    addTrack(this: RTCPeerConnection, track: MediaStreamTrack, ..._streams: MediaStream[]): RTCRtpSender {
        this._rejectIfClosed('addTrack');

        if (!(track instanceof MediaStreamTrack)) {
            throw new TypeError(
                "Failed to execute 'addTrack' on 'RTCPeerConnection': parameter 1 is not a MediaStreamTrack",
            );
        }

        // Check if this track is already assigned to a sender
        const existing = this._senders.find((s) => s.track === track);
        if (existing) {
            throw new DOMException('Track already exists in a sender of this connection', 'InvalidAccessError');
        }

        // Look for a reusable transceiver (matching kind, no track, recvonly/inactive)
        let reusable: RTCRtpTransceiver | undefined;
        for (const t of this._transceivers.values()) {
            if (
                t.sender.track === null &&
                !t.stopped &&
                t.direction !== 'stopped' &&
                t.receiver.track.kind === track.kind
            ) {
                const dir = t.direction;
                if (dir === 'recvonly' || dir === 'inactive') {
                    reusable = t;
                    break;
                }
            }
        }

        if (reusable) {
            // Expand direction to include send
            const dir = reusable.direction;
            reusable.direction = dir === 'recvonly' ? 'sendrecv' : 'sendonly';
            reusable.sender._setTrack(track);
            // Note: _wirePipeline is NOT called here for reusable transceivers.
            // Tracks with GStreamer sources will be handled by addTransceiver Path A
            // if no reusable transceiver exists, or the pipeline will be wired
            // when webrtcbin creates the sink pad during SDP negotiation.
            //
            // W3C § 5.1 addTrack step 12 — "update the negotiation-needed
            // flag" (§ 4.7.3). The new-transceiver path below inherits the
            // same call from addTransceiver.
            this._updateNegotiationNeeded();
            return reusable.sender;
        }

        // Create a new transceiver — addTransceiver handles both _setTrack
        // and _wirePipeline for tracks with GStreamer sources (Path A).
        const transceiver = this.addTransceiver(track, { direction: 'sendrecv' });
        return transceiver.sender;
    },

    removeTrack(this: RTCPeerConnection, sender: RTCRtpSender): void {
        this._rejectIfClosed('removeTrack');
        if (!this._senders.includes(sender)) {
            throw new DOMException('sender was not created by this connection', 'InvalidAccessError');
        }
        sender._setTrack(null);
    },

    getSenders(this: RTCPeerConnection): RTCRtpSender[] {
        return [...this._senders];
    },
    getReceivers(this: RTCPeerConnection): RTCRtpReceiver[] {
        return [...this._receivers];
    },
    getTransceivers(this: RTCPeerConnection): RTCRtpTransceiver[] {
        return [...this._transceivers.values()];
    },
};

/** Install track-management methods on RTCPeerConnection.prototype. */
export function installTrackMethods(proto: object): void {
    Object.assign(proto, trackMethods);
}
