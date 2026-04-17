// W3C RTCRtpSender for GJS.
//
// Phase 2: API surface wrapping GstWebRTC.WebRTCRTPSender.
// Phase 3: outgoing media pipeline — builds explicit encoder chains
// (source → valve → convert → encode → payloader → webrtcbin sink pad)
// entirely on the main thread. No Vala bridge needed.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCRtpSender.ts (ISC)
// Reference: W3C WebRTC spec § 5.2

import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

import { Gst } from './gst-init.js';
import { getRtpCapabilities } from './rtp-capabilities.js';
import type { RTCStatsReport } from './rtc-stats-report.js';
import type { MediaStreamTrack } from './media-stream-track.js';
import type { MediaStream } from './media-stream.js';

// Standard RTP payload types used in WebRTC SDP
const OPUS_PAYLOAD_TYPE = 111;
const VP8_PAYLOAD_TYPE = 96;

export type RTCRtpTransceiverDirection = 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive' | 'stopped';

export interface RTCRtpCodecCapability {
    mimeType: string;
    clockRate: number;
    channels?: number;
    sdpFmtpLine?: string;
}

export interface RTCRtpHeaderExtensionCapability {
    uri: string;
}

export interface RTCRtpCapabilities {
    codecs: RTCRtpCodecCapability[];
    headerExtensions: RTCRtpHeaderExtensionCapability[];
}

export interface RTCRtpEncodingParameters {
    rid?: string;
    active?: boolean;
    maxBitrate?: number;
    maxFramerate?: number;
    scaleResolutionDownBy?: number;
}

export interface RTCRtpCodecParameters {
    payloadType: number;
    mimeType: string;
    clockRate: number;
    channels?: number;
    sdpFmtpLine?: string;
}

export interface RTCRtpHeaderExtensionParameters {
    uri: string;
    id: number;
    encrypted?: boolean;
}

export interface RTCRtcpParameters {
    cname?: string;
    reducedSize?: boolean;
}

export interface RTCRtpSendParameters {
    transactionId: string;
    encodings: RTCRtpEncodingParameters[];
    codecs: RTCRtpCodecParameters[];
    headerExtensions: RTCRtpHeaderExtensionParameters[];
    rtcp: RTCRtcpParameters;
}

let _txCounter = 0;

export class RTCRtpSender {
    private _gstSender: GstWebRTC.WebRTCRTPSender | null;
    private _track: MediaStreamTrack | null = null;
    private _lastParams: RTCRtpSendParameters | null = null;

    /** @internal GStreamer pipeline references (set by RTCPeerConnection) */
    private _pipeline: any = null;
    private _webrtcbin: any = null;
    private _mlineIndex: number = -1;
    private _elements: any[] = [];
    private _valve: any = null;
    _linked = false;
    /** @internal — stats callback set by RTCPeerConnection */
    _getStatsForTrack: ((track: MediaStreamTrack) => Promise<RTCStatsReport>) | null = null;

    constructor(gstSender: GstWebRTC.WebRTCRTPSender | null, pipeline?: any, webrtcbin?: any) {
        this._gstSender = gstSender;
        this._pipeline = pipeline ?? null;
        this._webrtcbin = webrtcbin ?? null;
    }

    get track(): MediaStreamTrack | null { return this._track; }
    get dtmf(): null { return null; }
    get transport(): null { return null; }

    /** @internal */
    _setTrack(track: MediaStreamTrack | null): void {
        if (track === null && this._linked) {
            this._teardownPipeline();
        }
        this._track = track;
    }

    /** @internal — called by RTCPeerConnection._createTransceiverWrapper */
    _setMlineIndex(index: number): void { this._mlineIndex = index; }

    /** @internal — build the outgoing encoder chain and link to webrtcbin */
    _wirePipeline(track: MediaStreamTrack): void {
        if (this._linked || !this._pipeline || !this._webrtcbin) return;
        const source = (track as any)._gstSource;
        if (!source) return; // No GStreamer backing — nothing to wire

        // Move source from its getUserMedia pipeline into the PC pipeline
        const oldPipeline = (track as any)._gstPipeline;
        if (oldPipeline && oldPipeline !== this._pipeline) {
            source.set_state(Gst.State.NULL);
            oldPipeline.remove(source);
            (track as any)._gstPipeline = this._pipeline;
        }

        this._pipeline.add(source);

        // Valve element for Track.enabled control
        const valve = Gst.ElementFactory.make('valve', null)!;
        (valve as any).drop = !track.enabled;
        this._valve = valve;
        this._pipeline.add(valve);

        const elements: any[] = [valve];
        let lastElement: any;

        if (track.kind === 'audio') {
            const convert = Gst.ElementFactory.make('audioconvert', null)!;
            const resample = Gst.ElementFactory.make('audioresample', null)!;
            const encoder = Gst.ElementFactory.make('opusenc', null)!;
            const payloader = Gst.ElementFactory.make('rtpopuspay', null)!;
            (payloader as any).pt = OPUS_PAYLOAD_TYPE;

            // capsfilter tells webrtcbin the RTP caps immediately so createOffer
            // can generate the m=audio line without waiting for data to flow.
            const capsfilter = Gst.ElementFactory.make('capsfilter', null)!;
            (capsfilter as any).caps = Gst.Caps.from_string(
                `application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000,payload=${OPUS_PAYLOAD_TYPE}`,
            );

            elements.push(convert, resample, encoder, payloader, capsfilter);
            for (const el of elements) this._pipeline.add(el);

            source.link(valve);
            valve.link(convert);
            convert.link(resample);
            resample.link(encoder);
            encoder.link(payloader);
            payloader.link(capsfilter);
            lastElement = capsfilter;
        } else {
            // Video
            const convert = Gst.ElementFactory.make('videoconvert', null)!;
            const scale = Gst.ElementFactory.make('videoscale', null)!;
            const encoder = Gst.ElementFactory.make('vp8enc', null)!;
            (encoder as any).deadline = 1; // Realtime encoding
            (encoder as any).keyframe_max_dist = 60;
            const payloader = Gst.ElementFactory.make('rtpvp8pay', null)!;
            (payloader as any).pt = VP8_PAYLOAD_TYPE;

            const capsfilter = Gst.ElementFactory.make('capsfilter', null)!;
            (capsfilter as any).caps = Gst.Caps.from_string(
                `application/x-rtp,media=video,encoding-name=VP8,clock-rate=90000,payload=${VP8_PAYLOAD_TYPE}`,
            );

            elements.push(convert, scale, encoder, payloader, capsfilter);
            for (const el of elements) this._pipeline.add(el);

            source.link(valve);
            valve.link(convert);
            convert.link(scale);
            scale.link(encoder);
            encoder.link(payloader);
            payloader.link(capsfilter);
            lastElement = capsfilter;
        }

        // Link payloader output to webrtcbin sink pad.
        // Use the mline index if assigned (>= 0), otherwise request next available.
        const padName = this._mlineIndex >= 0 ? `sink_${this._mlineIndex}` : 'sink_%u';
        const sinkPad = this._webrtcbin.request_pad_simple
            ? this._webrtcbin.request_pad_simple(padName)
            : this._webrtcbin.get_request_pad(padName);
        if (sinkPad) {
            const srcPad = lastElement.get_static_pad('src');
            srcPad.link(sinkPad);
        }

        // Sync states — elements added to a PLAYING pipeline
        for (const el of [source, ...elements]) {
            el.sync_state_with_parent();
        }

        this._elements = [source, ...elements];
        this._linked = true;

        // Wire Track.enabled → valve.drop
        track._setEnableCallback((enabled: boolean) => {
            if (this._valve) (this._valve as any).drop = !enabled;
        });
    }

    /** @internal — tear down the encoder chain on close/removeTrack */
    _teardownPipeline(): void {
        if (!this._linked) return;
        // Disconnect enable callback from the track
        if (this._track) {
            this._track._setEnableCallback(null);
        }
        for (const el of [...this._elements].reverse()) {
            try {
                el.set_state(Gst.State.NULL);
                this._pipeline?.remove(el);
            } catch { /* ignore cleanup errors */ }
        }
        this._elements = [];
        this._valve = null;
        this._linked = false;
    }

    getParameters(): RTCRtpSendParameters {
        if (!this._lastParams) {
            this._lastParams = {
                transactionId: String(++_txCounter),
                encodings: [],
                codecs: [],
                headerExtensions: [],
                rtcp: {},
            };
        }
        return { ...this._lastParams, encodings: [...this._lastParams.encodings] };
    }

    async setParameters(params: RTCRtpSendParameters): Promise<void> {
        if (!this._lastParams) {
            throw new DOMException(
                'getParameters must be called before setParameters',
                'InvalidStateError',
            );
        }
        if (params.transactionId !== this._lastParams.transactionId) {
            throw new DOMException(
                'transactionId mismatch',
                'InvalidModificationError',
            );
        }
        this._lastParams = null;
    }

    async replaceTrack(track: MediaStreamTrack | null): Promise<void> {
        if (track === null) {
            this._teardownPipeline();
            this._track = null;
            return;
        }
        if (this._track !== null && track.kind !== this._track.kind) {
            throw new TypeError('Cannot replace track with different kind');
        }
        if (this._linked && (track as any)._gstSource) {
            // Atomic source swap: old source → new source, keep rest of chain
            const oldSource = this._elements[0];
            const newSource = (track as any)._gstSource;

            // Move new source from its pipeline
            const oldPipeline = (track as any)._gstPipeline;
            if (oldPipeline && oldPipeline !== this._pipeline) {
                newSource.set_state(Gst.State.NULL);
                oldPipeline.remove(newSource);
                (track as any)._gstPipeline = this._pipeline;
            }

            // Swap: unlink old, link new
            oldSource.set_state(Gst.State.NULL);
            oldSource.unlink(this._valve);
            this._pipeline.remove(oldSource);

            this._pipeline.add(newSource);
            newSource.link(this._valve);
            newSource.sync_state_with_parent();

            this._elements[0] = newSource;
        } else if ((track as any)._gstSource) {
            this._wirePipeline(track);
        }

        // Disconnect old track's enable callback, wire new one
        if (this._track) this._track._setEnableCallback(null);
        this._track = track;
        if (this._linked) {
            track._setEnableCallback((enabled: boolean) => {
                if (this._valve) (this._valve as any).drop = !enabled;
            });
        }
    }

    async getStats(): Promise<RTCStatsReport> {
        if (this._getStatsForTrack && this._track) {
            return this._getStatsForTrack(this._track);
        }
        // Fallback: return empty report if no PC or no track
        const { RTCStatsReport: Report } = await import('./rtc-stats-report.js');
        return new Report();
    }

    setStreams(..._streams: MediaStream[]): void {
        // Phase 3: no-op — webrtcbin manages msid in SDP automatically
    }

    static getCapabilities(kind: string): RTCRtpCapabilities | null {
        return getRtpCapabilities(kind);
    }
}
