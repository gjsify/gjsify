// RTCDataChannel — W3C WebRTC data channel backed by GstWebRTC.WebRTCDataChannel.
//
// Reference: refs/node-gst-webrtc/src/webrtc/RTCDataChannel.ts (ISC) +
//            refs/node-datachannel/src/polyfill/RTCDataChannel.ts (MIT)
//
// Extends the native EventTarget. Bridges the six GstWebRTCDataChannel signals
// (on-open / on-close / on-error / on-message-string / on-message-data /
// on-buffered-amount-low) to W3C events, defers dispatch via GLib.idle_add
// onto the main context (GJS blocks JS callbacks from non-main threads, and
// webrtcbin fires these signals from the streaming thread — see STATUS.md).

import GLib from 'gi://GLib?version=2.0';
import type GstWebRTC from 'gi://GstWebRTC?version=1.0';

import { RTCError } from './rtc-error.js';
import { RTCErrorEvent } from './rtc-events.js';

export type RTCDataChannelState = 'connecting' | 'open' | 'closing' | 'closed';
export type BinaryType = 'blob' | 'arraybuffer';

const STATE_MAP: Record<number, RTCDataChannelState> = {
    0: 'connecting',
    1: 'open',
    2: 'closing',
    3: 'closed',
};

type EventHandler<E extends Event = Event> = ((this: RTCDataChannel, ev: E) => any) | null;

// GstWebRTCDataChannel signals fire on the streaming thread. Hop to the
// main GLib context before touching the JS VM.
function deferToMain(fn: () => void): void {
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        try { fn(); } catch (err: any) {
            // eslint-disable-next-line no-console
            console.error?.('[webrtc] data-channel handler error:', err?.message ?? String(err));
        }
        return GLib.SOURCE_REMOVE;
    });
}

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
    // GLib.Bytes iterable → Uint8Array via toArray() or get_data().
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
    private _binaryType: BinaryType = 'arraybuffer';
    private _bufferedAmount = 0;
    private readonly _signalIds: number[] = [];
    private _closed = false;

    // `on<event>` attribute handlers — W3C requires both addEventListener and on*.
    private _onopen: EventHandler = null;
    private _onclose: EventHandler = null;
    private _onerror: EventHandler<RTCErrorEvent> = null;
    private _onmessage: EventHandler<MessageEvent> = null;
    private _onbufferedamountlow: EventHandler = null;
    private _onclosing: EventHandler = null;

    /** @internal */
    constructor(native: GstWebRTC.WebRTCDataChannel) {
        super();
        this._native = native;

        this._signalIds.push(
            native.connect('on-open', () => this._handleOpen()),
            native.connect('on-close', () => this._handleClose()),
            native.connect('on-error', (_c: any, err: GLib.Error) => this._handleError(err)),
            native.connect('on-message-string', (_c: any, str: string | null) => this._handleString(str)),
            native.connect('on-message-data', (_c: any, bytes: GLib.Bytes | null) => this._handleData(bytes)),
            native.connect('on-buffered-amount-low', () => this._handleBufferedAmountLow()),
            native.connect('notify::ready-state', () => this._handleReadyStateChange()),
        );
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
        if (v !== 'arraybuffer' && v !== 'blob') {
            throw new TypeError(`Invalid binaryType: ${String(v)}`);
        }
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

        // Blob support is best-effort — resolve via globalThis.Blob's ArrayBuffer.
        if (typeof (globalThis as any).Blob !== 'undefined' && data instanceof (globalThis as any).Blob) {
            const blob = data as Blob;
            // Synchronous path unavailable — spec allows deferring, we call async.
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
        for (const id of this._signalIds) {
            try { this._native.disconnect(id); } catch { /* ignore */ }
        }
        this._signalIds.length = 0;
    }

    // ---- Signal → event translators ---------------------------------------

    private _handleOpen(): void {
        deferToMain(() => {
            const ev = new Event('open');
            this._onopen?.call(this, ev);
            this.dispatchEvent(ev);
        });
    }

    private _handleClose(): void {
        deferToMain(() => {
            this._closed = true;
            const ev = new Event('close');
            this._onclose?.call(this, ev);
            this.dispatchEvent(ev);
        });
    }

    private _handleError(gerr: GLib.Error): void {
        deferToMain(() => {
            const rtcErr = new RTCError(
                { errorDetail: 'data-channel-failure' },
                gerr?.message ?? 'RTCDataChannel error',
            );
            const ev = new RTCErrorEvent('error', { error: rtcErr });
            this._onerror?.call(this, ev);
            this.dispatchEvent(ev);
        });
    }

    private _handleString(str: string | null): void {
        const data = str ?? '';
        deferToMain(() => {
            const ev = new MessageEvent('message', { data });
            this._onmessage?.call(this, ev);
            this.dispatchEvent(ev);
        });
    }

    private _handleData(bytes: GLib.Bytes | null): void {
        if (!bytes) return;
        const buf = bytesToArrayBuffer(bytes);
        let data: ArrayBuffer | Blob = buf;
        if (this._binaryType === 'blob' && typeof (globalThis as any).Blob !== 'undefined') {
            data = new (globalThis as any).Blob([buf]);
        }
        deferToMain(() => {
            const ev = new MessageEvent('message', { data });
            this._onmessage?.call(this, ev);
            this.dispatchEvent(ev);
        });
    }

    private _handleBufferedAmountLow(): void {
        this._bufferedAmount = Number(this._native.buffered_amount) || 0;
        deferToMain(() => {
            const ev = new Event('bufferedamountlow');
            this._onbufferedamountlow?.call(this, ev);
            this.dispatchEvent(ev);
        });
    }

    private _handleReadyStateChange(): void {
        // 'closing' has no dedicated webrtcbin signal; fire via notify::ready-state.
        if (this.readyState === 'closing') {
            deferToMain(() => {
                const ev = new Event('closing');
                this._onclosing?.call(this, ev);
                this.dispatchEvent(ev);
            });
        }
    }
}
