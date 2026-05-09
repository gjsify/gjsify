// SPDX-License-Identifier: MIT
// Internal type helpers for @gjsify/webrtc — narrowing the broad
// Gst.Element / Gst.Pad surface to the concrete element shapes our
// implementation reads and writes at runtime.
//
// Background: `@girs/gst-1.0` declares every GStreamer element as the
// base `Gst.Element` class — element-specific GObject properties (e.g.
// `webrtcbin`'s `stun_server`, `signaling_state`, or `vp8enc`'s
// `keyframe_max_dist`) are not exposed in the GIR-generated typings
// because they are registered at element-class init time, not on the
// base class. Rather than reach for `(el as any).foo` at every call
// site, we declare thin interfaces here and narrow once through helper
// casts.
//
// These types are PURE compile-time constructs — no runtime behavior is
// added. Following AGENTS.md Rule 2c, this module lives under
// `src/internal/` and is NOT in `package.json#exports`; it is a private
// implementation helper, not part of the public API surface.
//
// References:
//  - GStreamer webrtcbin element properties:
//      https://gstreamer.freedesktop.org/documentation/webrtc/index.html
//  - vp8enc / opusenc / capsfilter / valve / payloader properties:
//      https://gstreamer.freedesktop.org/documentation/

import type Gst from 'gi://Gst?version=1.0';
import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

/**
 * The `webrtcbin` GStreamer element — declares every GObject property
 * our implementation accesses. The base `Gst.Element` class is preserved
 * so all the inherited methods (`emit`, `get_parent`, `set_state`,
 * `request_pad_simple`, `sync_state_with_parent`, …) keep their proper
 * typings.
 *
 * All properties below correspond to runtime GObject properties on
 * `webrtcbin` (verify with `gst-inspect-1.0 webrtcbin`).
 */
export interface WebRtcBin extends Gst.Element {
    stun_server: string | null;
    turn_server: string | null;
    ice_transport_policy: GstWebRTC.WebRTCICETransportPolicy;
    bundle_policy: GstWebRTC.WebRTCBundlePolicy;
    signaling_state: GstWebRTC.WebRTCSignalingState;
    connection_state: GstWebRTC.WebRTCPeerConnectionState;
    ice_connection_state: GstWebRTC.WebRTCICEConnectionState;
    ice_gathering_state: GstWebRTC.WebRTCICEGatheringState;
    local_description: GstWebRTC.WebRTCSessionDescription | null;
    remote_description: GstWebRTC.WebRTCSessionDescription | null;
    current_local_description: GstWebRTC.WebRTCSessionDescription | null;
    current_remote_description: GstWebRTC.WebRTCSessionDescription | null;
    pending_local_description: GstWebRTC.WebRTCSessionDescription | null;
    pending_remote_description: GstWebRTC.WebRTCSessionDescription | null;
}

/**
 * Narrow a `Gst.Element` returned by `Gst.ElementFactory.make('webrtcbin', …)`
 * to the augmented `WebRtcBin` shape. Pure type-level cast — no runtime
 * validation is performed because every webrtcbin instance has these
 * properties (they are class-installed by GstWebRTCBin).
 */
export const asWebRtcBin = (el: Gst.Element): WebRtcBin => el as WebRtcBin;

/**
 * GStreamer pad augmented with the `transceiver` field that webrtcbin's
 * SRC pads carry. The base `Gst.Pad` typing has no concept of this — it
 * is set at pad-creation time inside webrtcbin and points back to the
 * `GstWebRTCRTPTransceiver` the pad serves.
 */
export interface WebRtcSrcPad extends Gst.Pad {
    transceiver: GstWebRTC.WebRTCRTPTransceiver | null;
}

/** Narrow a webrtcbin SRC `Gst.Pad` to the augmented shape. */
export const asWebRtcSrcPad = (pad: Gst.Pad): WebRtcSrcPad => pad as WebRtcSrcPad;

/**
 * GStreamer element with a settable `drop` GObject property — the
 * `valve` element used to gate media flow when a track is disabled.
 */
export interface ValveElement extends Gst.Element {
    drop: boolean;
}

/** Narrow a `valve` element to the augmented shape. */
export const asValveElement = (el: Gst.Element): ValveElement => el as ValveElement;

/**
 * GStreamer element with a settable `pt` GObject property — RTP payloader
 * elements (`rtpopuspay`, `rtpvp8pay`, …) accept the payload type.
 */
export interface RtpPayloaderElement extends Gst.Element {
    pt: number;
}

/** Narrow an RTP payloader element to the augmented shape. */
export const asRtpPayloaderElement = (el: Gst.Element): RtpPayloaderElement =>
    el as RtpPayloaderElement;

/**
 * GStreamer `capsfilter` element — exposes a settable `caps` property
 * that pins the negotiated caps of a pipeline branch.
 */
export interface CapsFilterElement extends Gst.Element {
    caps: Gst.Caps;
}

/** Narrow a `capsfilter` element to the augmented shape. */
export const asCapsFilterElement = (el: Gst.Element): CapsFilterElement =>
    el as CapsFilterElement;

/**
 * GStreamer `vp8enc` encoder — the small set of properties we tune for
 * realtime WebRTC video encoding.
 */
export interface Vp8EncElement extends Gst.Element {
    deadline: number;
    keyframe_max_dist: number;
}

/** Narrow a `vp8enc` element to the augmented shape. */
export const asVp8EncElement = (el: Gst.Element): Vp8EncElement => el as Vp8EncElement;
