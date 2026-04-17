// RTCError extends DOMException per W3C WebRTC spec §7.
//
// Reference: refs/node-datachannel/src/polyfill/RTCError.ts (MIT) +
//            https://www.w3.org/TR/webrtc/#rtcerror-interface
//
// CLAUDE.md Rule 8 exception: the class below extends `DOMException`
// (a global). Seed the global before the class body is evaluated.

import '@gjsify/dom-exception/register';

export type RTCErrorDetailType =
    | 'data-channel-failure'
    | 'dtls-failure'
    | 'fingerprint-failure'
    | 'sctp-failure'
    | 'sdp-syntax-error'
    | 'hardware-encoder-not-available'
    | 'hardware-encoder-error';

export interface RTCErrorInit {
    errorDetail: RTCErrorDetailType;
    sdpLineNumber?: number | null;
    sctpCauseCode?: number | null;
    receivedAlert?: number | null;
    sentAlert?: number | null;
    httpRequestStatusCode?: number | null;
}

export class RTCError extends DOMException {
    readonly errorDetail: RTCErrorDetailType;
    readonly sdpLineNumber: number | null;
    readonly sctpCauseCode: number | null;
    readonly receivedAlert: number | null;
    readonly sentAlert: number | null;
    readonly httpRequestStatusCode: number | null;

    constructor(init: RTCErrorInit, message?: string) {
        super(message ?? init.errorDetail, 'OperationError');
        if (!init || !init.errorDetail) {
            throw new TypeError('RTCError: errorDetail is required');
        }
        this.errorDetail = init.errorDetail;
        this.sdpLineNumber = init.sdpLineNumber ?? null;
        this.sctpCauseCode = init.sctpCauseCode ?? null;
        this.receivedAlert = init.receivedAlert ?? null;
        this.sentAlert = init.sentAlert ?? null;
        this.httpRequestStatusCode = init.httpRequestStatusCode ?? null;
    }
}
