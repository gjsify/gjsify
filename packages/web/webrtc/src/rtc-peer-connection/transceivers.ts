// Transceiver factory for RTCPeerConnection — extracted via the
// `install*Methods(proto)` pattern (same shape as the SDP-negotiation
// split, PR #287, and the canvas2d-core / webgl2 splits PRs #262/#273).
//
// Covers the W3C `RTCPeerConnection.addTransceiver(trackOrKind, init)`
// factory. It contains the two-path logic that distinguishes:
//
//   • Path A — track with a GStreamer source + send direction → request a
//     sink pad from webrtcbin (implicit transceiver creation).
//   • Path B — kind-only / receive-only / inactive → `add-transceiver`
//     action signal (no pad, no implicit RTP source).
//
// The method body is moved verbatim from the pre-split
// `rtc-peer-connection.ts`. It reads/writes the host class's
// `_pipeline`, `_webrtcbin`, `_transceivers`, `_senders`, `_receivers`
// fields and calls the `_findNewGstTransceiver`, `_ensureTransports`,
// `_createTransceiverWrapper`, `_rejectIfClosed`, and `getStats`
// helpers via its `this: RTCPeerConnection` typing — those slots are
// demoted from `private` to package-internal (`_`-prefixed) in the same
// PR. Same convention as the SDP-negotiation split (PR #287).
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCPeerConnection.ts (ISC).

import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

import { Gst } from '../gst-init.js';
import { w3cDirectionToGst } from '../gst-enum-maps.js';
import { MediaStreamTrack } from '../media-stream-track.js';
import { RTCRtpSender } from '../rtc-rtp-sender.js';
import { RTCRtpReceiver } from '../rtc-rtp-receiver.js';
import { RTCRtpTransceiver } from '../rtc-rtp-transceiver.js';
import type { RTCPeerConnection, RTCRtpTransceiverInit } from '../rtc-peer-connection.js';

export interface TransceiverMethods {
    addTransceiver(trackOrKind: MediaStreamTrack | string, init?: RTCRtpTransceiverInit): RTCRtpTransceiver;
}

declare module '../rtc-peer-connection.js' {
    interface RTCPeerConnection extends TransceiverMethods {}
}

const transceiverMethods: TransceiverMethods & ThisType<RTCPeerConnection> = {
    addTransceiver(
        this: RTCPeerConnection,
        trackOrKind: MediaStreamTrack | string,
        init?: RTCRtpTransceiverInit,
    ): RTCRtpTransceiver {
        this._rejectIfClosed('addTransceiver');

        let kind: 'audio' | 'video';
        if (typeof trackOrKind === 'string') {
            if (trackOrKind !== 'audio' && trackOrKind !== 'video') {
                throw new TypeError(
                    `Failed to execute 'addTransceiver' on 'RTCPeerConnection': The provided value '${trackOrKind}' is not a valid enum value of type MediaStreamTrackKind.`,
                );
            }
            kind = trackOrKind;
        } else if (trackOrKind instanceof MediaStreamTrack) {
            kind = trackOrKind.kind;
        } else {
            throw new TypeError(
                "Failed to execute 'addTransceiver' on 'RTCPeerConnection': parameter 1 is not of type 'MediaStreamTrack' or a valid MediaStreamTrackKind.",
            );
        }

        if (init?.sendEncodings) {
            const rids = new Set<string>();
            for (const enc of init.sendEncodings) {
                if (enc.rid !== undefined) {
                    if (
                        typeof enc.rid !== 'string' ||
                        enc.rid.length === 0 ||
                        enc.rid.length > 16 ||
                        !/^[a-zA-Z0-9]+$/.test(enc.rid)
                    ) {
                        throw new TypeError(`Invalid RID value: ${enc.rid}`);
                    }
                    if (rids.has(enc.rid)) {
                        throw new TypeError(`Duplicate RID: ${enc.rid}`);
                    }
                    rids.add(enc.rid);
                }
                if (enc.scaleResolutionDownBy !== undefined && enc.scaleResolutionDownBy < 1.0) {
                    throw new RangeError('scaleResolutionDownBy must be >= 1.0');
                }
            }
        }

        const direction = init?.direction ?? 'sendrecv';
        const validDirections = ['sendrecv', 'sendonly', 'recvonly', 'inactive'];
        if (!validDirections.includes(direction)) {
            throw new TypeError(
                `Failed to execute 'addTransceiver' on 'RTCPeerConnection': The provided value '${direction}' is not a valid enum value of type RTCRtpTransceiverDirection.`,
            );
        }
        const hasGstSource = trackOrKind instanceof MediaStreamTrack && trackOrKind._gstSource;
        const wantsSend = direction === 'sendrecv' || direction === 'sendonly';

        let gstTrans: GstWebRTC.WebRTCRTPTransceiver;
        let jsTrans: RTCRtpTransceiver;

        if (hasGstSource && wantsSend) {
            // Path A: Track has a GStreamer source and needs to send.
            // Requesting a sink pad from webrtcbin implicitly creates both
            // the pad AND the transceiver. Using emit('add-transceiver')
            // would create a duplicate with mline=-1.
            const track = trackOrKind as MediaStreamTrack;

            // Build encoder chain, link to webrtcbin via request_pad_simple
            const sender = new RTCRtpSender(null, this._pipeline, this._webrtcbin);
            sender._kind = kind;
            // Allow sender to update our pipeline if it migrates to a VideoBridge pipeline
            sender._onPipelineChanged = (newPipeline) => {
                this._pipeline = newPipeline;
            };
            sender._setTrack(track);
            sender._wirePipeline(track);

            // Find the GstTransceiver that request_pad_simple created
            const found = this._findNewGstTransceiver();
            if (!found) {
                throw new Error('webrtcbin did not create a transceiver for the send pad');
            }
            gstTrans = found;

            // Create wrapper with the pre-wired sender
            const gstReceiver = gstTrans.receiver ?? null;
            const receiver = new RTCRtpReceiver(kind, gstReceiver, this._pipeline);

            // Wire stats delegation
            const statsDelegate = (t: MediaStreamTrack) => this.getStats(t);
            sender._getStatsForTrack = statsDelegate;
            receiver._getStatsForTrack = statsDelegate;
            // sender/receiver.transport stays null until a local description
            // is applied (W3C § 4.4.1.5; WPT RTCRtpSender.https.html "null
            // transport initially") — same rule as _createTransceiverWrapper.
            if (this.localDescription) {
                const dtls = this._ensureTransports();
                sender._transport = dtls;
                receiver._transport = dtls;
            }

            jsTrans = new RTCRtpTransceiver(gstTrans, sender, receiver);
            sender._transceiver = jsTrans;
            this._transceivers.set(gstTrans, jsTrans);
            this._senders.push(sender);
            this._receivers.push(receiver);

            // Apply direction
            gstTrans.direction = w3cDirectionToGst(direction);
        } else {
            // Path B: No GStreamer source, or receive-only/inactive.
            // Use emit('add-transceiver') which creates a transceiver without pads.
            const caps = Gst.Caps.from_string(`application/x-rtp,media=${kind}`);
            // webrtcbin doesn't accept NONE for add-transceiver; use SENDRECV
            // and override to inactive after creation.
            const createDirection =
                direction === 'inactive' ? w3cDirectionToGst('sendrecv') : w3cDirectionToGst(direction);

            // `add-transceiver` is an action signal returning the new
            // GstWebRTCRTPTransceiver — see comment on `create-data-channel` above.
            const result = this._webrtcbin.emit(
                'add-transceiver',
                createDirection,
                caps,
            ) as unknown as GstWebRTC.WebRTCRTPTransceiver | null;
            if (!result) {
                throw new Error('webrtcbin did not create a transceiver');
            }
            gstTrans = result;

            jsTrans = this._transceivers.get(gstTrans)!;
            if (!jsTrans) {
                jsTrans = this._createTransceiverWrapper(gstTrans);
            }

            gstTrans.direction = w3cDirectionToGst(direction);

            if (trackOrKind instanceof MediaStreamTrack) {
                jsTrans.sender._setTrack(trackOrKind);
            }
        }

        // W3C § 5.3 addTransceiver step "update the negotiation-needed flag"
        // (§ 4.7.3) — covers renegotiation, which webrtcbin does not re-emit.
        this._updateNegotiationNeeded();

        return jsTrans;
    },
};

/** Install transceiver-factory methods on RTCPeerConnection.prototype. */
export function installTransceiverMethods(proto: object): void {
    Object.assign(proto, transceiverMethods);
}
