// ServerHttp2Session — the http2.Http2Session shape for server-side sessions.
//
// Soup multiplexes HTTP/2 streams internally and does not expose the
// underlying nghttp2 session, so for server-side push allocation +
// PUSH_PROMISE frame building we route through the @gjsify/http2-native
// bridge (Vala wrapper around nghttp2). When the typelib isn't loadable,
// `_allocatePushId` falls back to a deterministic in-process counter so
// tests that only need stable ids keep working.
//
// Reference: Node.js lib/internal/http2/core.js (Http2Session).

import { EventEmitter } from 'node:events';
import { loadNativeHttp2 } from '@gjsify/http2-native';
import { constants, getDefaultSettings, type Http2Settings } from '../protocol.js';

export class ServerHttp2Session extends EventEmitter {
    readonly type = constants.NGHTTP2_SESSION_SERVER;
    readonly alpnProtocol: string | undefined = 'h2';
    readonly encrypted: boolean = true;

    private _closed = false;
    private _destroyed = false;
    private _settings: Http2Settings;
    private _canPush = true;
    /** Lazy-initialised native bridge handles. */
    private _frameEncoder: ReturnType<NonNullable<ReturnType<typeof loadNativeHttp2>>['FrameEncoder']['new']> | null = null;
    private _streamIdAllocator: ReturnType<NonNullable<ReturnType<typeof loadNativeHttp2>>['StreamIdAllocator']['new']> | null = null;
    /** Fallback id counter used when the native bridge is unavailable. */
    private _fallbackPushId = 2;

    constructor() {
        super();
        this._settings = getDefaultSettings();
    }

    /** Whether server-push is currently permitted on this session. */
    get canPush(): boolean { return this._canPush; }
    set canPush(v: boolean) { this._canPush = v; }

    /** @internal Allocate the next promised (even) stream id for a push. */
    _allocatePushId(): number {
        const native = loadNativeHttp2();
        if (native) {
            if (!this._streamIdAllocator) {
                this._streamIdAllocator = native.StreamIdAllocator.new();
            }
            return this._streamIdAllocator.next_promised();
        }
        const id = this._fallbackPushId;
        if (id > 0x7fffffff) return 0;
        this._fallbackPushId += 2;
        return id;
    }

    /** @internal Build PUSH_PROMISE frame bytes via the native bridge (or null when unavailable). */
    _buildPushPromise(
        associatedStreamId: number,
        promisedStreamId: number,
        headers: Record<string, string | string[]>,
    ): Uint8Array | null {
        const native = loadNativeHttp2();
        if (!native) return null;
        if (!this._frameEncoder) this._frameEncoder = native.FrameEncoder.new();

        // HPACK encodes a flat names/values pair list. HTTP/2 requires lower
        // case names; we coerce here so callers don't have to remember.
        const names: string[] = [];
        const values: string[] = [];
        for (const [k, v] of Object.entries(headers)) {
            const name = k.toLowerCase();
            if (Array.isArray(v)) {
                for (const item of v) {
                    names.push(name);
                    values.push(String(item));
                }
            } else {
                names.push(name);
                values.push(String(v));
            }
        }

        const block = this._frameEncoder.encode_headers(names, values);
        if (!block) return null;
        const frame = this._frameEncoder.build_push_promise(associatedStreamId, promisedStreamId, block);
        // GLib.Bytes.toArray() yields a Uint8Array snapshot.
        const arr = (frame as unknown as { toArray?: () => Uint8Array }).toArray;
        if (typeof arr === 'function') return arr.call(frame);
        // GJS sometimes returns the bytes as a structured object — use get_data()
        const getData = (frame as unknown as { get_data?: () => Uint8Array | null }).get_data;
        if (typeof getData === 'function') {
            const d = getData.call(frame);
            return d ?? null;
        }
        return null;
    }

    get closed(): boolean { return this._closed; }
    get destroyed(): boolean { return this._destroyed; }
    get pendingSettingsAck(): boolean { return false; }
    get localSettings(): Http2Settings { return { ...this._settings }; }
    get remoteSettings(): Http2Settings { return getDefaultSettings(); }
    get originSet(): string[] { return []; }

    settings(settings: Http2Settings, callback?: () => void): void {
        Object.assign(this._settings, settings);
        if (callback) Promise.resolve().then(callback);
    }

    goaway(code?: number, _lastStreamId?: number, _data?: Uint8Array): void {
        this.emit('goaway', code ?? constants.NGHTTP2_NO_ERROR);
        this.destroy();
    }

    ping(_payload?: Uint8Array, callback?: (err: Error | null, duration: number, payload: Uint8Array) => void): boolean {
        const buf = new Uint8Array(8);
        if (callback) Promise.resolve().then(() => callback(null, 0, buf));
        return true;
    }

    close(callback?: () => void): void {
        if (this._closed) return;
        this._closed = true;
        this.emit('close');
        if (callback) callback();
    }

    destroy(error?: Error, code?: number): void {
        if (this._destroyed) return;
        this._destroyed = true;
        this._closed = true;
        if (error) this.emit('error', error);
        if (code !== undefined) this.emit('goaway', code);
        this.emit('close');
    }

    altsvc(_alt: string, _originOrStream: string | number): void {}
    origin(..._origins: string[]): void {}
    ref(): void {}
    unref(): void {}
}
