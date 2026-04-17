// RTCDataChannel — W3C WebRTC data channel backed by GstWebRTC.WebRTCDataChannel.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCDataChannel.ts (ISC) +
//            refs/node-datachannel/src/polyfill/RTCDataChannel.ts (MIT)
//
// Uses `@gjsify/webrtc-native`'s DataChannelBridge to marshal the six
// GstWebRTCDataChannel signals (on-open / on-close / on-error /
// on-message-string / on-message-data / on-buffered-amount-low) from the
// GStreamer streaming thread onto the GLib main context. The raw `connect`
// path is unusable because GJS blocks JS callbacks invoked from non-main
// threads — see STATUS.md "WebRTC Status".

import GLib from 'gi://GLib?version=2.0';
import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

import { DataChannelBridge, type DataChannelBridge as DataChannelBridgeType } from '@gjsify/webrtc-native';

import { RTCError } from './rtc-error.js';
import { RTCErrorEvent } from './rtc-events.js';

export type RTCDataChannelState = 'connecting' | 'open' | 'closing' | 'closed';
export type BinaryType = 'blob' | 'arraybuffer';

// NOTE: the GstWebRTCDataChannelState C enum is 1-based (CONNECTING=1 …
// CLOSED=4), but the TypeScript @girs/gstwebrtc-1.0 declaration omits the
// explicit initialiser so the `.d.ts` mis-infers 0-based values. Map
// against the real runtime values.
const STATE_MAP: Record<number, RTCDataChannelState> = {
    1: 'connecting',
    2: 'open',
    3: 'closing',
    4: 'closed',
};

type EventHandler<E extends Event = Event> = ((this: RTCDataChannel, ev: E) => any) | null;

/** Convert a JS typed array / ArrayBuffer to a GLib.Bytes. */
function toGBytes(buffer: ArrayBuffer | ArrayBufferView): GLib.Bytes {
    let view: Uint8Array;
    if (ArrayBuffer.isView(buffer)) {
        view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
        view = new Uint8Array(buffer);
    }
    return new GLib.Bytes(view);
}

/** Convert a GLib.Bytes payload to an ArrayBuffer. */
function bytesToArrayBuffer(bytes: GLib.Bytes): ArrayBuffer {
    const arr = (bytes as any).toArray?.();
    if (arr instanceof Uint8Array) {
        return (arr.buffer as ArrayBuffer).slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
    }
    const data = (bytes as any).get_data?.();
    if (data instanceof Uint8Array) {
        return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    return new ArrayBuffer(0);
}

export class RTCDataChannel extends EventTarget {
    private readonly _native: GstWebRTC.WebRTCDataChannel;
    private readonly _bridge: DataChannelBridgeType;
    private _binaryType: BinaryType = 'arraybuffer';
    private _bufferedAmount = 0;
    private _closed = false;

    // `on<event>` attribute handlers — W3C requires both addEventListener and on*.
    private _onopen: EventHandler = null;
    private _onclose: EventHandler = null;
    private _onerror: EventHandler<RTCErrorEvent> = null;
    private _onmessage: EventHandler<MessageEvent> = null;
    private _onbufferedamountlow: EventHandler = null;
    private _onclosing: EventHandler = null;

    /**
     * @internal
     * Accepts either a raw GstWebRTCDataChannel (for locally-created channels)
     * or a pre-made DataChannelBridge (for remotely-originated channels that
     * the WebrtcbinBridge already wrapped on the streaming thread to avoid
     * missing early messages).
     */
    constructor(source: GstWebRTC.WebRTCDataChannel | DataChannelBridgeType) {
        super();
        if ((source as DataChannelBridgeType).channel !== undefined && (source as any).dispose_bridge) {
            this._bridge = source as DataChannelBridgeType;
            this._native = this._bridge.channel as unknown as GstWebRTC.WebRTCDataChannel;
        } else {
            this._native = source as GstWebRTC.WebRTCDataChannel;
            this._bridge = new (DataChannelBridge as any)({ channel: this._native });
        }

        this._bridge.connect('opened', () => this._handleOpen());
        this._bridge.connect('closed', () => this._handleClose());
        this._bridge.connect('error-occurred', (_b, message) => this._handleError(message));
        this._bridge.connect('message-string', (_b, data) => this._handleString(data));
        this._bridge.connect('message-data', (_b, data) => this._handleData(data));
        this._bridge.connect('buffered-amount-low', () => this._handleBufferedAmountLow());
        this._bridge.connect('ready-state-changed', () => this._handleReadyStateChange());
    }

    // ---- Properties --------------------------------------------------------

    get label(): string { return this._native.label; }
    get ordered(): boolean { return this._native.ordered; }
    get protocol(): string { return this._native.protocol; }
    get negotiated(): boolean { return this._native.negotiated; }
    get id(): number | null { return this._native.id >= 0 ? this._native.id : null; }

    get maxPacketLifeTime(): number | null {
        const v = this._native.max_packet_lifetime;
        return v >= 0 ? v : null;
    }

    get maxRetransmits(): number | null {
        const v = this._native.max_retransmits;
        return v >= 0 ? v : null;
    }

    get readyState(): RTCDataChannelState {
        if (this._closed) return 'closed';
        return STATE_MAP[this._native.ready_state as number] ?? 'connecting';
    }

    get bufferedAmount(): number {
        try {
            return Number(this._native.buffered_amount) || this._bufferedAmount;
        } catch {
            return this._bufferedAmount;
        }
    }

    get bufferedAmountLowThreshold(): number {
        return Number(this._native.buffered_amount_low_threshold) || 0;
    }
    set bufferedAmountLowThreshold(v: number) {
        this._native.buffered_amount_low_threshold = v;
    }

    get binaryType(): BinaryType { return this._binaryType; }
    set binaryType(v: BinaryType) {
        // W3C §6.2 (and WPT RTCDataChannel-binaryType tests): invalid
        // values must be silently ignored — keep the previous value.
        // See: refs/wpt/webrtc/RTCDataChannel-binaryType.window.js
        if (v !== 'arraybuffer' && v !== 'blob') return;
        if (v === 'blob' && typeof (globalThis as any).Blob === 'undefined') {
            const DOMExc = (globalThis as any).DOMException;
            const msg = `binaryType 'blob' requires globalThis.Blob. Import '@gjsify/buffer/register' to provide it.`;
            throw DOMExc ? new DOMExc(msg, 'NotSupportedError') : new Error(msg);
        }
        this._binaryType = v;
    }

    // ---- on<event> attribute accessors -------------------------------------

    get onopen() { return this._onopen; }
    set onopen(h: EventHandler) { this._onopen = h; }
    get onclose() { return this._onclose; }
    set onclose(h: EventHandler) { this._onclose = h; }
    get onclosing() { return this._onclosing; }
    set onclosing(h: EventHandler) { this._onclosing = h; }
    get onerror() { return this._onerror; }
    set onerror(h: EventHandler<RTCErrorEvent>) { this._onerror = h; }
    get onmessage() { return this._onmessage; }
    set onmessage(h: EventHandler<MessageEvent>) { this._onmessage = h; }
    get onbufferedamountlow() { return this._onbufferedamountlow; }
    set onbufferedamountlow(h: EventHandler) { this._onbufferedamountlow = h; }

    // ---- Methods -----------------------------------------------------------

    send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
        const state = this.readyState;
        if (state !== 'open') {
            const DOMExc = (globalThis as any).DOMException;
            const msg = `RTCDataChannel.send: readyState is '${state}', expected 'open'`;
            throw DOMExc ? new DOMExc(msg, 'InvalidStateError') : new Error(msg);
        }

        if (typeof data === 'string') {
            this._native.send_string(data);
            this._bufferedAmount += new TextEncoder().encode(data).byteLength;
            return;
        }

        if (typeof (globalThis as any).Blob !== 'undefined' && data instanceof (globalThis as any).Blob) {
            const blob = data as Blob;
            blob.arrayBuffer().then((buf) => {
                try {
                    this._native.send_data(toGBytes(buf));
                    this._bufferedAmount += buf.byteLength;
                } catch {
                    /* channel may have closed mid-flight */
                }
            });
            return;
        }

        if (ArrayBuffer.isView(data)) {
            const bytes = toGBytes(data);
            this._native.send_data(bytes);
            this._bufferedAmount += data.byteLength;
            return;
        }
        if (data instanceof ArrayBuffer) {
            const bytes = toGBytes(data);
            this._native.send_data(bytes);
            this._bufferedAmount += data.byteLength;
            return;
        }

        throw new TypeError('RTCDataChannel.send: unsupported data type');
    }

    close(): void {
        if (this._closed) return;
        try { this._native.close(); } catch { /* ignore */ }
        this._disconnectSignals();
        this._closed = true;
    }

    /** @internal */
    _disconnectSignals(): void {
        try { this._bridge.dispose_bridge(); } catch { /* ignore */ }
    }

    // ---- Signal → event translators ---------------------------------------
    // Already running on the main context (DataChannelBridge did the hop).

    private _handleOpen(): void {
        const ev = new Event('open');
        this._onopen?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleClose(): void {
        this._closed = true;
        const ev = new Event('close');
        this._onclose?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleError(message: string): void {
        const rtcErr = new RTCError(
            { errorDetail: 'data-channel-failure' },
            message || 'RTCDataChannel error',
        );
        const ev = new RTCErrorEvent('error', { error: rtcErr });
        this._onerror?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleString(data: string): void {
        const ev = new MessageEvent('message', { data });
        this._onmessage?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleData(bytes: GLib.Bytes): void {
        if (!bytes) return;
        const buf = bytesToArrayBuffer(bytes);
        let data: ArrayBuffer | Blob = buf;
        if (this._binaryType === 'blob' && typeof (globalThis as any).Blob !== 'undefined') {
            data = new (globalThis as any).Blob([buf]);
        }
        const ev = new MessageEvent('message', { data });
        this._onmessage?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleBufferedAmountLow(): void {
        this._bufferedAmount = Number(this._native.buffered_amount) || 0;
        const ev = new Event('bufferedamountlow');
        this._onbufferedamountlow?.call(this, ev);
        this.dispatchEvent(ev);
    }

    private _handleReadyStateChange(): void {
        if (this.readyState === 'closing') {
            const ev = new Event('closing');
            this._onclosing?.call(this, ev);
            this.dispatchEvent(ev);
        }
    }
}
