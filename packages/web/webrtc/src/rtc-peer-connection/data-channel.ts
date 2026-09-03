// Data-channel creation for RTCPeerConnection — extracted via the
// `install*Methods(proto)` pattern (same shape as the SDP-negotiation
// split, PR #287, and the canvas2d-core / webgl2 splits PRs #262/#273).
//
// Covers the W3C `RTCPeerConnection.createDataChannel(label, init)`
// factory plus the Web-IDL `[EnforceRange] unsigned short` coercion
// helper its three numeric options require.
//
// The method body is moved verbatim from the pre-split
// `rtc-peer-connection.ts`. It reads/writes the host class's
// `_closed`, `_dataChannels`, `_webrtcbin` fields and calls the
// `_ensureSctpTransport` / `_setStructureField` helpers via its
// `this: RTCPeerConnection` typing — those slots were already
// demoted from `private` to package-internal (`_`-prefixed) by
// PR #287; this PR demotes `_closed`, `_dataChannels`, and
// `_ensureSctpTransport` to the same convention.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCPeerConnection.ts (ISC).

import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

import { DOMException } from '@gjsify/dom-exception';
import { Gst } from '../gst-init.js';
import { RTCDataChannel } from '../rtc-data-channel.js';
import type { RTCPeerConnection, RTCDataChannelInit } from '../rtc-peer-connection.js';

/**
 * Web-IDL `[EnforceRange] unsigned short` coercion. Coerces via ToNumber,
 * rejects values that can't be represented as an unsigned short (0..65535).
 * Matches Web-IDL §3.2.4.10: reject NaN, ±Infinity, and integers outside
 * the range; "100" → 100; fractional values are truncated.
 *
 * Reference: refs/wpt/webrtc/RTCDataChannelInit-{maxPacketLifeTime,maxRetransmits}-enforce-range.html
 */
function coerceUnsignedShort(name: string, raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        throw new TypeError(`createDataChannel: ${name} must be a finite number, got ${String(raw)}`);
    }
    const truncated = Math.trunc(n);
    if (truncated < 0 || truncated > 65535) {
        throw new TypeError(`createDataChannel: ${name}=${truncated} is outside the [0, 65535] range`);
    }
    return truncated;
}

export interface DataChannelMethods {
    createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel;
}

declare module '../rtc-peer-connection.js' {
    interface RTCPeerConnection extends DataChannelMethods {}
}

const dataChannelMethods: DataChannelMethods & ThisType<RTCPeerConnection> = {
    createDataChannel(this: RTCPeerConnection, label: string, options: RTCDataChannelInit = {}): RTCDataChannel {
        if (this._closed) {
            throw new DOMException('Cannot create a data channel on a closed RTCPeerConnection', 'InvalidStateError');
        }
        if (typeof label !== 'string') {
            throw new TypeError('createDataChannel: label must be a string');
        }
        if (new TextEncoder().encode(label).byteLength > 65535) {
            throw new TypeError('createDataChannel: label too long (> 65535 bytes)');
        }

        // Web-IDL `[EnforceRange] unsigned short` coercion for the three
        // numeric options. Input is coerced via ToNumber (so "100" → 100)
        // then range-checked against [0, 65535]; any value that can't be
        // represented exactly as an unsigned short throws TypeError. Also
        // handles WPT's `0` edge case (number) vs `undefined` (no value).
        const maxPacketLifeTime =
            options.maxPacketLifeTime == null
                ? undefined
                : coerceUnsignedShort('maxPacketLifeTime', options.maxPacketLifeTime);
        const maxRetransmits =
            options.maxRetransmits == null ? undefined : coerceUnsignedShort('maxRetransmits', options.maxRetransmits);
        const id = options.id == null ? undefined : coerceUnsignedShort('id', options.id);

        if (maxPacketLifeTime !== undefined && maxRetransmits !== undefined) {
            throw new TypeError('createDataChannel: maxPacketLifeTime and maxRetransmits are mutually exclusive');
        }
        if (options.negotiated === true && id === undefined) {
            throw new TypeError('createDataChannel: negotiated=true requires an id');
        }
        if (id === 65535) {
            // Per RFC 8832 §5.1, id must be < 65535 (65535 is reserved).
            throw new TypeError('createDataChannel: id 65535 is reserved');
        }

        const gstOpts = Gst.Structure.new_empty('data-channel-opts');
        this._setStructureField(gstOpts, 'ordered', 'boolean', options.ordered);
        this._setStructureField(gstOpts, 'max-packet-lifetime', 'int', maxPacketLifeTime);
        this._setStructureField(gstOpts, 'max-retransmits', 'int', maxRetransmits);
        this._setStructureField(gstOpts, 'protocol', 'string', options.protocol);
        this._setStructureField(gstOpts, 'negotiated', 'boolean', options.negotiated);
        this._setStructureField(gstOpts, 'id', 'int', id);

        let native: GstWebRTC.WebRTCDataChannel | null = null;
        try {
            // webrtcbin's `create-data-channel` is an action signal that returns
            // a `GstWebRTCDataChannel`. The GIR-generated `emit()` overloads
            // declare a `void` return for action signals, but at runtime the
            // value flows back. Cast through `unknown` to acknowledge the gap.
            native = this._webrtcbin.emit(
                'create-data-channel',
                label,
                gstOpts,
            ) as unknown as GstWebRTC.WebRTCDataChannel | null;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`create-data-channel failed: ${msg}`);
        }
        if (!native) {
            throw new Error('webrtcbin returned null data channel (check id/label/options)');
        }

        // Data channel created → ensure SCTP transport exists
        this._ensureSctpTransport();

        // Pass the SCTP transport so RTCDataChannel.send can enforce
        // the W3C max-message-size ceiling per § 5.6.5 step 4.
        const js = new RTCDataChannel(native, this.sctp ?? undefined);
        this._dataChannels.set(native, js);
        js.addEventListener('close', () => {
            this._dataChannels.delete(native);
        });

        // W3C § 6.1 createDataChannel step "update the negotiation-needed
        // flag" (§ 4.7.3) — covers renegotiation, which webrtcbin does not
        // re-emit.
        this._updateNegotiationNeeded();

        return js;
    },
};

/** Install data-channel-creation methods on RTCPeerConnection.prototype. */
export function installDataChannelMethods(proto: object): void {
    Object.assign(proto, dataChannelMethods);
}
