// RTCSessionDescription — W3C WebRTC session description (offer/answer/rollback).
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCSessionDescription.ts (ISC)
// Adapted for GJS using GstSdp + GstWebRTC.

import GstSdp from 'gi://GstSdp?version=1.0';
import GstWebRTC from 'gi://GstWebRTC?version=1.0';

export type RTCSdpType = 'offer' | 'pranswer' | 'answer' | 'rollback';

export interface RTCSessionDescriptionInit {
    type?: RTCSdpType;
    sdp?: string;
}

function sdpTypeToGst(type: RTCSdpType): GstWebRTC.WebRTCSDPType {
    switch (type) {
        case 'offer':    return GstWebRTC.WebRTCSDPType.OFFER;
        case 'pranswer': return GstWebRTC.WebRTCSDPType.PRANSWER;
        case 'answer':   return GstWebRTC.WebRTCSDPType.ANSWER;
        case 'rollback': return GstWebRTC.WebRTCSDPType.ROLLBACK;
    }
}

function sdpTypeFromGst(type: GstWebRTC.WebRTCSDPType): RTCSdpType {
    switch (type) {
        case GstWebRTC.WebRTCSDPType.OFFER:    return 'offer';
        case GstWebRTC.WebRTCSDPType.PRANSWER: return 'pranswer';
        case GstWebRTC.WebRTCSDPType.ANSWER:   return 'answer';
        case GstWebRTC.WebRTCSDPType.ROLLBACK: return 'rollback';
        default: return 'offer';
    }
}

export class RTCSessionDescription {
    readonly type: RTCSdpType;
    readonly sdp: string;

    constructor(init?: RTCSessionDescriptionInit) {
        this.type = (init?.type ?? 'offer') as RTCSdpType;
        this.sdp = init?.sdp ?? '';
    }

    toJSON(): { type: RTCSdpType; sdp: string } {
        return { type: this.type, sdp: this.sdp };
    }

    /** Build a GstWebRTC.WebRTCSessionDescription for use with webrtcbin signals. */
    toGstDesc(): GstWebRTC.WebRTCSessionDescription {
        const [ret, sdp] = GstSdp.SDPMessage.new_from_text(this.sdp);
        if (ret !== GstSdp.SDPResult.OK) {
            throw new Error(`Failed to parse SDP text (GstSDPResult=${ret})`);
        }
        return GstWebRTC.WebRTCSessionDescription.new(sdpTypeToGst(this.type), sdp);
    }

    static fromGstDesc(desc: GstWebRTC.WebRTCSessionDescription): RTCSessionDescription {
        const sdpText = desc.sdp?.as_text?.() ?? '';
        return new RTCSessionDescription({
            type: sdpTypeFromGst(desc.type),
            sdp: sdpText,
        });
    }
}
