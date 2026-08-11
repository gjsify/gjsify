// Http2ServerResponse + ServerHttp2Stream + Http2NativeBackend.
//
// These three concepts are kept in one module because they share a tight
// cycle: Response.pushStream creates ServerHttp2Stream → constructor stores
// the parent response; Response.createPushResponse → calls pushStream and
// extracts the child's response. Splitting them across files would need
// type-only imports both ways and dead-class hooks, with no readability
// gain. The method bodies live in per-concern siblings under
// `./response/` and are wired into the prototypes below via the same
// `install*Methods(proto)` pattern as the webgl2-rendering-context split
// (PR #309) — typed `*Methods` interface declaration-merged into the
// class plus an `install<Group>Methods(proto)` function that copies the
// implementations onto the prototype.
//
//   ./response/headers.ts            header management + writeHead + respond + setTimeout
//   ./response/stream-io.ts          _write / _final / _startStreaming / end
//   ./response/respond-with-file.ts  respondWithFD / respondWithFile + helpers
//   ./response/push.ts               pushStream / createPushResponse + ServerHttp2Stream.pushStream

import type Soup from '@girs/soup-3.0';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { constants } from '../protocol.js';
import type { ServerHttp2Session } from './session.js';
import type { StatCheck } from './response/respond-with-file.js';

/**
 * Per-stream backend that routes writes through `SessionBridge.submit_*`
 * instead of into a Soup message. Set on responses produced by the native
 * dispatcher (Phase 1+). When `_nativeBackend` is non-null,
 * `Http2ServerResponse` ignores its `_soupMsg` field (also null in that
 * case) and dispatches every operation through this object.
 *
 * Pushed streams reuse the same connection — `pushPromise()` returns a
 * sibling backend for the freshly-allocated promised stream id.
 */
export interface Http2NativeBackend {
    streamId: number;
    submitResponse(
        statusCode: number,
        statusMessage: string,
        headers: Map<string, string | string[]>,
        endStream: boolean,
    ): void;
    submitData(chunk: Buffer, endStream: boolean): void;
    reset(errorCode: number): void;
    /** Allocate a pushed stream-id; returns a child backend or null on error. */
    pushPromise(headers: Record<string, string | number | string[]>): Http2NativeBackend | null;
}

export class Http2ServerResponse extends Writable {
    statusCode = 200;
    statusMessage = '';
    headersSent = false;
    finished = false;
    sendDate = true;

    /** @internal — sibling response/*.ts modules access this directly. */
    _soupMsg: Soup.ServerMessage | null;
    /** @internal */
    _nativeBackend: Http2NativeBackend | null;
    /** @internal */
    _headers: Map<string, string | string[]> = new Map();
    /** @internal */
    _streaming = false;
    /** @internal */
    _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    /** @internal */
    _stream: ServerHttp2Stream | null = null;
    /** @internal Detached responses (PUSH_PROMISE children) buffer their output. */
    _detachedBody: Buffer[] | null = null;

    get stream(): ServerHttp2Stream | null {
        return this._stream;
    }
    get socket(): null {
        return null;
    }
    /** Whether this response is detached from a Soup connection (push streams). */
    get isDetached(): boolean {
        return this._soupMsg === null && this._nativeBackend === null;
    }
    /** Buffered body bytes for detached (push) responses — null on regular responses. */
    get detachedBody(): Buffer | null {
        return this._detachedBody ? Buffer.concat(this._detachedBody) : null;
    }
    /** Whether this response routes through the native HTTP/2 dispatcher. */
    get isNative(): boolean {
        return this._nativeBackend !== null;
    }
    /** @internal — used by `ServerHttp2Stream.pushStream()` to allocate a pushed child backend. */
    get nativeBackend(): Http2NativeBackend | null {
        return this._nativeBackend;
    }

    // Called by Http2Server after stream is created
    _setStream(stream: ServerHttp2Stream): void {
        this._stream = stream;
    }

    /** @internal Used by the native dispatcher to attach its submit backend. */
    _setNativeBackend(backend: Http2NativeBackend): void {
        this._nativeBackend = backend;
    }

    constructor(soupMsg: Soup.ServerMessage | null, nativeBackend: Http2NativeBackend | null = null) {
        super();
        this._soupMsg = soupMsg;
        this._nativeBackend = nativeBackend;
        if (soupMsg === null && nativeBackend === null) this._detachedBody = [];
    }
}

// Facade over Http2ServerResponse exposing the session/stream API.
// Delegates all writes to the underlying response object.

export class ServerHttp2Stream extends EventEmitter {
    readonly id: number;
    readonly pushAllowed: boolean;
    readonly sentHeaders: Record<string, string | string[]> = {};

    /** @internal — sibling response/*.ts modules access this directly. */
    _res: Http2ServerResponse;
    /** @internal */
    _session: ServerHttp2Session | null;
    /** @internal */
    _isPushedStream: boolean;
    /** @internal Children pushed off this request stream (parent → array). */
    _pushedChildren: ServerHttp2Stream[] = [];
    /** @internal Cached PUSH_PROMISE frame bytes for inspection in tests. */
    _pushPromiseFrame: Uint8Array | null = null;
    /** @internal Push request headers (`:method`, `:path`, …). */
    _pushRequestHeaders: Record<string, string | string[]> | null = null;

    get session(): ServerHttp2Session | null {
        return this._session;
    }
    get headersSent(): boolean {
        return this._res.headersSent;
    }
    get closed(): boolean {
        return this._res.writableEnded;
    }
    get destroyed(): boolean {
        return this._res.destroyed;
    }
    get pending(): boolean {
        return false;
    }
    get state(): number {
        return this.closed ? constants.NGHTTP2_STREAM_STATE_CLOSED : constants.NGHTTP2_STREAM_STATE_OPEN;
    }

    /** Bytes of the PUSH_PROMISE frame this stream was reserved with (push streams only). */
    get pushPromiseFrame(): Uint8Array | null {
        return this._pushPromiseFrame;
    }
    /** Request headers the push was promised with (push streams only). */
    get pushRequestHeaders(): Record<string, string | string[]> | null {
        return this._pushRequestHeaders;
    }
    /** Push streams created from this stream. */
    get pushedChildren(): ReadonlyArray<ServerHttp2Stream> {
        return this._pushedChildren;
    }

    constructor(
        res: Http2ServerResponse,
        session: ServerHttp2Session | null = null,
        options: { isPushedStream?: boolean; streamId?: number } = {},
    ) {
        super();
        this._res = res;
        this._session = session;
        this._isPushedStream = options.isPushedStream === true;
        // Client-initiated streams keep the legacy id of 1 (Soup compat layer
        // multiplexing is opaque). Pushed streams get an even id from the
        // bridge allocator owned by the session.
        this.id = options.streamId ?? 1;
        // pushAllowed is set on REQUEST streams, indicating whether the peer
        // allows server pushes (SETTINGS_ENABLE_PUSH). Pushed streams never
        // allow further nesting (Node throws ERR_HTTP2_NESTED_PUSH).
        this.pushAllowed = !this._isPushedStream && session?.canPush !== false;

        res.on('finish', () => this.emit('close'));
        res.on('error', (err: Error) => this.emit('error', err));
    }

    // Session API: send response headers
    respond(headers: Record<string, string | string[] | number>, options?: { endStream?: boolean }): void {
        this._res.respond(headers, options);
    }

    // Writable-like interface delegating to response. `Parameters<>` lifts
    // the underlying Writable's overload tuple so the delegation passes
    // through without `as any` while still tolerating the relaxed
    // chunk-type the public surface accepts.
    write(
        chunk: Parameters<Http2ServerResponse['write']>[0],
        encoding?: BufferEncoding | (() => void),
        callback?: () => void,
    ): boolean {
        return this._res.write(chunk, encoding as BufferEncoding, callback);
    }

    end(
        chunk?: Parameters<Http2ServerResponse['end']>[0],
        encoding?: BufferEncoding | (() => void),
        callback?: () => void,
    ): this {
        this._res.end(chunk, encoding as BufferEncoding, callback);
        return this;
    }

    destroy(error?: Error): this {
        this._res.destroy(error);
        return this;
    }

    close(code?: number, callback?: () => void): void {
        if (callback) this.once('close', callback);
        // Native path: emit RST_STREAM with the supplied error code. The
        // bridge owns the wire I/O; flushing happens inside submit_rst_stream.
        const backend = this._res.nativeBackend;
        if (backend) {
            // NativeStreamBackend.reset() has no throw path — submit_rst_stream
            // reports failure via its return code and the flush handles write
            // errors internally.
            backend.reset(code ?? constants.NGHTTP2_NO_ERROR);
        }
        this._res.end();
    }

    priority(_options: { exclusive?: boolean; parent?: number; weight?: number; silent?: boolean }): void {}

    setTimeout(msecs: number, callback?: () => void): this {
        this._res.setTimeout(msecs, callback);
        return this;
    }

    sendTrailers(_headers: Record<string, string | string[]>): void {}
    additionalHeaders(_headers: Record<string, string | string[]>): void {}

    /** See {@link Http2ServerResponse.respondWithFD}. */
    respondWithFD(
        fd: number | { fd: number },
        headers?: Record<string, string | string[] | number>,
        options?: { offset?: number; length?: number; statCheck?: StatCheck },
    ): void {
        this._res.respondWithFD(fd, headers, options);
    }

    /** See {@link Http2ServerResponse.respondWithFile}. */
    respondWithFile(
        path: string,
        headers?: Record<string, string | string[] | number>,
        options?: {
            offset?: number;
            length?: number;
            statCheck?: StatCheck;
            onError?: (err: Error) => void;
        },
    ): void {
        this._res.respondWithFile(path, headers, options);
    }
}

// Wire focused method groups into the two class prototypes, same pattern as
// the webgl2-rendering-context split (PR #309). Each module declares a
// `*Methods` interface merged into the class via `declare module './response.js'`
// and exposes an `install<Group>Methods(proto)` function that copies its
// `ThisType<>`-bound method object onto the prototype. The side-effect import
// is kept separate from the named import so tsc preserves the augmentation in
// the emitted `.d.ts` (downstream consumers see the methods on the public type).
import './response/headers.js';
import { installHeaderMethods } from './response/headers.js';
import './response/stream-io.js';
import { installStreamIoMethods } from './response/stream-io.js';
import './response/respond-with-file.js';
import { installRespondWithFileMethods } from './response/respond-with-file.js';
import './response/push.js';
import { installPushMethods } from './response/push.js';

installHeaderMethods(Http2ServerResponse.prototype);
installStreamIoMethods(Http2ServerResponse.prototype);
installRespondWithFileMethods(Http2ServerResponse.prototype);
installPushMethods(Http2ServerResponse.prototype, ServerHttp2Stream.prototype);
