// SDP-negotiation methods for RTCPeerConnection — extracted via the
// `install*Methods(proto)` pattern (same shape as the canvas2d-core and
// webgl2 splits, PRs #262 and #273).
//
// Covers the W3C `RTCPeerConnection` JSEP entry points:
//   createOffer, createAnswer, setLocalDescription, setRemoteDescription,
//   addIceCandidate
//
// Each method body is moved verbatim from the pre-split
// `rtc-peer-connection.ts`. The methods read/write a handful of internal
// `_`-prefixed fields on the host class (`_webrtcbin`, `_pipeline`,
// `_iceRestartNeeded`, `_hasNegotiated`, plus the `_rejectIfClosed` and
// `_setStructureField` helpers) — those fields were demoted from `private`
// to package-internal in the base class so this module can reach them
// through `this:`-typed accesses. See AGENTS.md "Don't patch — implement at
// the source" + the `install*Methods` notes on the parent split PRs.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCPeerConnection.ts (ISC).

import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

import { DOMException } from '@gjsify/dom-exception';
import { Gst } from '../gst-init.js';
import { withGstPromise } from '../gst-utils.js';
import { rewriteIceCredentials } from '../sdp-params.js';
import { RTCSessionDescription, type RTCSessionDescriptionInit } from '../rtc-session-description.js';
import type { RTCIceCandidate } from '../rtc-ice-candidate.js';
import { type RTCIceCandidateInit } from '../rtc-ice-candidate.js';
import type { RTCPeerConnection, RTCOfferOptions, RTCAnswerOptions } from '../rtc-peer-connection.js';

export interface SdpNegotiationMethods {
    createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
    createAnswer(options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit>;
    setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void>;
    setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
    addIceCandidate(candidate: RTCIceCandidateInit | RTCIceCandidate | null): Promise<void>;
}

declare module '../rtc-peer-connection.js' {
    interface RTCPeerConnection extends SdpNegotiationMethods {}
}

const sdpNegotiationMethods: SdpNegotiationMethods & ThisType<RTCPeerConnection> = {
    async createOffer(this: RTCPeerConnection, _options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
        this._rejectIfClosed('createOffer');
        const opts = Gst.Structure.new_empty('offer-options');
        // If restartIce() was called, request fresh ICE credentials
        const iceRestart = this._iceRestartNeeded;
        if (iceRestart) {
            this._setStructureField(opts, 'ice-restart', 'boolean', true);
            this._iceRestartNeeded = false;
        }
        const reply = await withGstPromise((p) => {
            this._webrtcbin.emit('create-offer', opts, p);
        });
        // GJS unboxes `get_value` for boxed types directly to the underlying
        // struct; no GObject.Value wrapper involvement.
        const desc = reply!.get_value('offer') as unknown as GstWebRTC.WebRTCSessionDescription;
        const json = RTCSessionDescription.fromGstDesc(desc).toJSON();
        if (iceRestart) {
            // webrtcbin (≤ 1.28) ignores the `ice-restart` offer option
            // (measured: identical ufrag either way), so the JSEP restart
            // primitive — fresh ufrag/pwd in the offer (RFC 9429 § 3.5.1) —
            // is applied here; setLocalDescription pushes the rewritten
            // credentials into webrtcbin's ICE agent (measured: ICE
            // connectivity completes with munged credentials).
            json.sdp = rewriteIceCredentials(json.sdp);
        }
        return json;
    },

    async createAnswer(this: RTCPeerConnection, _options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> {
        this._rejectIfClosed('createAnswer');
        const opts = Gst.Structure.new_empty('answer-options');
        const reply = await withGstPromise((p) => {
            this._webrtcbin.emit('create-answer', opts, p);
        });
        const desc = reply!.get_value('answer') as unknown as GstWebRTC.WebRTCSessionDescription;
        return RTCSessionDescription.fromGstDesc(desc).toJSON();
    },

    async setLocalDescription(this: RTCPeerConnection, description?: RTCSessionDescriptionInit): Promise<void> {
        this._rejectIfClosed('setLocalDescription');

        // W3C § 4.4.2 — implicit setLocalDescription (perfect negotiation):
        // ONLY a missing description/type auto-creates the appropriate SDP
        // from the current signaling state. A description whose `type` is
        // present must never be routed here — in particular 'rollback', whose
        // `sdp` is empty BY DESIGN (§ 4.4.1.5 ignores it), and which a
        // `!description.sdp` test used to misroute into createOffer().
        if (!description || !description.type) {
            const state = this.signalingState;
            if (state === 'stable' || state === 'have-local-offer') {
                // Stable → create offer; have-local-offer → re-offer
                description = await this.createOffer();
            } else if (state === 'have-remote-offer' || state === 'have-remote-pranswer') {
                description = await this.createAnswer();
            } else {
                throw new DOMException(
                    `setLocalDescription: cannot auto-create SDP in signalingState '${state}'`,
                    'InvalidStateError',
                );
            }
        }

        if (description.type === 'rollback') {
            // W3C § 4.4.1.5: type 'rollback' is invalid in 'stable',
            // 'have-local-pranswer' and 'have-remote-pranswer' →
            // InvalidStateError. The only state with a pending LOCAL
            // description to roll back is 'have-local-offer'.
            const state = this.signalingState;
            if (state !== 'have-local-offer') {
                throw new DOMException(
                    `setLocalDescription: cannot rollback in signalingState '${state}'`,
                    'InvalidStateError',
                );
            }
            const hadCompletedNegotiation = this.currentLocalDescription !== null;
            // webrtcbin supports ROLLBACK natively (verified on GStreamer
            // 1.28: HAVE_LOCAL_OFFER → STABLE, pending description cleared,
            // promise replied) — no pipeline state bump needed.
            const gstDesc = new RTCSessionDescription(description).toGstDesc();
            await withGstPromise((p) => {
                this._webrtcbin.emit('set-local-description', gstDesc, p);
            });
            // Rolling back the INITIAL offer detaches the never-connected
            // transports again (WPT RTCRtpSender.https.html "null transport
            // after rollback of sLD(offer)"); after a completed offer/answer
            // the live transports survive a renegotiation rollback.
            if (!hadCompletedNegotiation) this._clearTransports();
            return;
        }

        // On first-time setLocalDescription, the pipeline needs to start running.
        this._pipeline.set_state(Gst.State.PLAYING);
        const gstDesc = new RTCSessionDescription(description).toGstDesc();
        await withGstPromise((p) => {
            this._webrtcbin.emit('set-local-description', gstDesc, p);
        });

        // Applying a local description creates the transports — W3C § 4.4.1.5,
        // WPT RTCRtpSender.https.html "should have a transport after sLD(offer)".
        this._assignTransports();
    },

    async setRemoteDescription(this: RTCPeerConnection, description: RTCSessionDescriptionInit): Promise<void> {
        this._rejectIfClosed('setRemoteDescription');
        if (!description || !description.sdp || !description.type) {
            throw new TypeError('setRemoteDescription requires an RTCSessionDescriptionInit with sdp and type');
        }
        this._pipeline.set_state(Gst.State.PLAYING);
        const gstDesc = new RTCSessionDescription(description).toGstDesc();
        await withGstPromise((p) => {
            this._webrtcbin.emit('set-remote-description', gstDesc, p);
        });
        // Track that at least one negotiation has completed (for restartIce)
        if (this.signalingState === 'stable') {
            this._hasNegotiated = true;
        }
    },

    async addIceCandidate(
        this: RTCPeerConnection,
        candidate: RTCIceCandidateInit | RTCIceCandidate | null,
    ): Promise<void> {
        this._rejectIfClosed('addIceCandidate');
        if (!candidate) return; // end-of-candidates marker — webrtcbin handles implicitly
        const { candidate: cand, sdpMLineIndex } = candidate;
        if (typeof cand !== 'string' || typeof sdpMLineIndex !== 'number') return;
        this._webrtcbin.emit('add-ice-candidate', sdpMLineIndex, cand);
    },
};

/** Install SDP-negotiation methods on RTCPeerConnection.prototype. */
export function installSdpNegotiationMethods(proto: object): void {
    Object.assign(proto, sdpNegotiationMethods);
}
