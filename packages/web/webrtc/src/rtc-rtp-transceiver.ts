// W3C RTCRtpTransceiver for GJS.
//
// Wraps GstWebRTC.WebRTCRTPTransceiver. Reads mid, direction, currentDirection
// from the native object. direction setter maps back to GStreamer enum.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCRtpTransceiver.ts (ISC)
// Reference: W3C WebRTC spec § 5.4

import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

import { gstDirectionToW3C, w3cDirectionToGst } from './gst-enum-maps.js';
import { RTCRtpSender, type RTCRtpTransceiverDirection, type RTCRtpCodecCapability } from './rtc-rtp-sender.js';
import { RTCRtpReceiver } from './rtc-rtp-receiver.js';

export class RTCRtpTransceiver {
    private _gstTrans: GstWebRTC.WebRTCRTPTransceiver;
    readonly sender: RTCRtpSender;
    readonly receiver: RTCRtpReceiver;
    private _stopped = false;
    private _codecPreferences: RTCRtpCodecCapability[] = [];

    constructor(
        gstTrans: GstWebRTC.WebRTCRTPTransceiver,
        sender: RTCRtpSender,
        receiver: RTCRtpReceiver,
    ) {
        this._gstTrans = gstTrans;
        this.sender = sender;
        this.receiver = receiver;
    }

    get mid(): string | null {
        if (this._stopped) return null;
        const m = (this._gstTrans as any).mid;
        return (m === '' || m == null) ? null : String(m);
    }

    get direction(): RTCRtpTransceiverDirection {
        if (this._stopped) return 'stopped';
        return gstDirectionToW3C((this._gstTrans as any).direction);
    }

    set direction(d: RTCRtpTransceiverDirection) {
        if (this._stopped) {
            throw new DOMException(
                "Cannot set direction on a stopped transceiver",
                'InvalidStateError',
            );
        }
        if (d === 'stopped') {
            throw new TypeError("The provided value 'stopped' is not a valid enum value of type RTCRtpTransceiverDirection.");
        }
        const valid: RTCRtpTransceiverDirection[] = ['sendrecv', 'sendonly', 'recvonly', 'inactive'];
        if (!valid.includes(d)) {
            throw new TypeError(`The provided value '${d}' is not a valid enum value of type RTCRtpTransceiverDirection.`);
        }
        (this._gstTrans as any).direction = w3cDirectionToGst(d);
    }

    get currentDirection(): RTCRtpTransceiverDirection | null {
        if (this._stopped) return null;
        const cd = (this._gstTrans as any).current_direction ?? (this._gstTrans as any).currentDirection;
        if (cd == null) return null;
        const w3c = gstDirectionToW3C(cd);
        return w3c === 'inactive' ? null : w3c;
    }

    get stopped(): boolean {
        return this._stopped;
    }

    stop(): void {
        if (this._stopped) return;
        this._stopped = true;
    }

    setCodecPreferences(codecs: RTCRtpCodecCapability[]): void {
        if (!Array.isArray(codecs)) {
            throw new TypeError('codecs must be an array');
        }
        if (codecs.length === 0) {
            this._codecPreferences = [];
            return;
        }

        const kind = this.receiver.track.kind;
        const recvCaps = RTCRtpReceiver.getCapabilities(kind);
        const sendCaps = RTCRtpSender.getCapabilities(kind);
        if (!recvCaps || !sendCaps) {
            throw new DOMException('No capabilities available', 'InvalidModificationError');
        }

        const allCaps = [...recvCaps.codecs, ...sendCaps.codecs];

        for (const codec of codecs) {
            if (!codec || typeof codec !== 'object') {
                throw new TypeError('Each codec must be an object');
            }
            if (typeof codec.mimeType !== 'string' || typeof codec.clockRate !== 'number') {
                throw new TypeError('codec must have mimeType (string) and clockRate (number)');
            }

            const isResiliency = /\/(rtx|red|ulpfec)$/i.test(codec.mimeType);
            if (isResiliency) continue;

            const match = allCaps.find((c) =>
                c.mimeType.toLowerCase() === codec.mimeType.toLowerCase() &&
                c.clockRate === codec.clockRate &&
                (codec.channels === undefined || c.channels === codec.channels) &&
                (codec.sdpFmtpLine === undefined || c.sdpFmtpLine === codec.sdpFmtpLine)
            );
            if (!match) {
                throw new DOMException(
                    `Codec ${codec.mimeType} ${codec.clockRate} is not in capabilities`,
                    'InvalidModificationError',
                );
            }
        }

        this._codecPreferences = [...codecs];
    }

    /** @internal */
    get _nativeTransceiver(): GstWebRTC.WebRTCRTPTransceiver {
        return this._gstTrans;
    }
}
