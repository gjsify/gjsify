// Http2ServerResponse + ServerHttp2Stream + Http2NativeBackend.
//
// These three concepts are kept in one module because they share a tight
// cycle: Response.pushStream creates ServerHttp2Stream → constructor stores
// the parent response; Response.createPushResponse → calls pushStream and
// extracts the child's response. Splitting them across files would need
// type-only imports both ways and dead-class hooks, with no readability
// gain. Single file = ~700 LoC, still well below the per-file ceiling the
// monorepo's other classes (canvas-rendering-context-2d, http2-native
// SessionBridge.vala) live at.
//
// The `_respondFromFD` / `_makeDetachedSoupMessage` / `_fdPath` helpers
// live here too because they're only ever called from Response methods
// (`respondWithFD` / `respondWithFile` / `pushStream`).

import Soup from '@girs/soup-3.0';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { read as fsRead, statSync, openSync, closeSync } from 'node:fs';
import { constants } from '../protocol.js';
import type { ServerHttp2Session } from './session.js';

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
    submitResponse(statusCode: number, statusMessage: string, headers: Map<string, string | string[]>, endStream: boolean): void;
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

    private _soupMsg: Soup.ServerMessage | null;
    private _nativeBackend: Http2NativeBackend | null;
    private _headers: Map<string, string | string[]> = new Map();
    private _streaming = false;
    private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    private _stream: ServerHttp2Stream | null = null;
    /** Detached responses (PUSH_PROMISE children) buffer their output. */
    private _detachedBody: Buffer[] | null = null;

    get stream(): ServerHttp2Stream | null { return this._stream; }
    get socket(): null { return null; }
    /** Whether this response is detached from a Soup connection (push streams). */
    get isDetached(): boolean { return this._soupMsg === null && this._nativeBackend === null; }
    /** Buffered body bytes for detached (push) responses — null on regular responses. */
    get detachedBody(): Buffer | null {
        return this._detachedBody ? Buffer.concat(this._detachedBody) : null;
    }
    /** Whether this response routes through the native HTTP/2 dispatcher. */
    get isNative(): boolean { return this._nativeBackend !== null; }
    /** @internal — used by `ServerHttp2Stream.pushStream()` to allocate a pushed child backend. */
    get nativeBackend(): Http2NativeBackend | null { return this._nativeBackend; }

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

    setHeader(name: string, value: string | number | string[]): this {
        this._headers.set(name.toLowerCase(), typeof value === 'number' ? String(value) : value);
        return this;
    }

    getHeader(name: string): string | string[] | undefined {
        return this._headers.get(name.toLowerCase());
    }

    removeHeader(name: string): void {
        this._headers.delete(name.toLowerCase());
    }

    hasHeader(name: string): boolean {
        return this._headers.has(name.toLowerCase());
    }

    getHeaderNames(): string[] {
        return Array.from(this._headers.keys());
    }

    getHeaders(): Record<string, string | string[]> {
        const result: Record<string, string | string[]> = {};
        for (const [key, value] of this._headers) {
            result[key] = value;
        }
        return result;
    }

    appendHeader(name: string, value: string | string[]): this {
        const lower = name.toLowerCase();
        const existing = this._headers.get(lower);
        if (existing === undefined) {
            this._headers.set(lower, value);
        } else if (Array.isArray(existing)) {
            Array.isArray(value) ? existing.push(...value) : existing.push(value);
        } else {
            this._headers.set(lower, Array.isArray(value) ? [existing as string, ...value] : [existing as string, value]);
        }
        return this;
    }

    flushHeaders(): void {
        if (!this.headersSent) this.headersSent = true;
    }

    writeHead(statusCode: number, statusMessage?: string | Record<string, string | string[]>, headers?: Record<string, string | string[]>): this {
        this.statusCode = statusCode;
        if (typeof statusMessage === 'object') {
            headers = statusMessage;
            statusMessage = undefined;
        }
        if (typeof statusMessage === 'string') this.statusMessage = statusMessage;
        if (headers) {
            for (const [key, value] of Object.entries(headers)) {
                this.setHeader(key, value);
            }
        }
        return this;
    }

    // http2 session-API alias — extracts :status from headers map
    respond(headers: Record<string, string | string[] | number>, options?: { endStream?: boolean }): void {
        const status = Number(headers[':status'] ?? 200);
        const rest: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(headers)) {
            if (k === ':status') continue;
            rest[k] = typeof v === 'number' ? String(v) : v;
        }
        this.writeHead(status, rest);
        if (options?.endStream) this.end();
    }

    writeContinue(callback?: () => void): void {
        if (callback) Promise.resolve().then(callback);
    }

    writeEarlyHints(_hints: Record<string, string | string[]>, callback?: () => void): void {
        if (callback) Promise.resolve().then(callback);
    }

    addTrailers(_headers: Record<string, string>): void {}

    setTimeout(msecs: number, callback?: () => void): this {
        if (this._timeoutTimer) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = null;
        }
        if (callback) this.once('timeout', callback);
        if (msecs > 0) {
            this._timeoutTimer = setTimeout(() => {
                this._timeoutTimer = null;
                this.emit('timeout');
            }, msecs);
        }
        return this;
    }

    private _startStreaming(): void {
        if (this._streaming) return;
        this._streaming = true;
        this.headersSent = true;

        if (this._timeoutTimer) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = null;
        }

        if (this._nativeBackend) {
            // Native dispatcher: submit response headers; END_STREAM goes with the
            // first DATA frame in _write or _final.
            this._nativeBackend.submitResponse(this.statusCode, this.statusMessage, this._headers, false);
            return;
        }

        if (!this._soupMsg) return; // detached push response — no Soup wire

        this._soupMsg.set_status(this.statusCode, this.statusMessage || null);
        const responseHeaders = this._soupMsg.get_response_headers();

        if (this._headers.has('content-length')) {
            responseHeaders.set_encoding(Soup.Encoding.CONTENT_LENGTH);
        } else {
            responseHeaders.set_encoding(Soup.Encoding.CHUNKED);
        }

        for (const [key, value] of this._headers) {
            if (Array.isArray(value)) {
                for (const v of value) responseHeaders.append(key, v);
            } else {
                responseHeaders.replace(key, value as string);
            }
        }
    }

    _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
        this._startStreaming();
        if (this._nativeBackend) {
            this._nativeBackend.submitData(buf, false);
        } else if (this._soupMsg) {
            const responseBody = this._soupMsg.get_response_body();
            responseBody.append(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
            this._soupMsg.unpause();
        } else if (this._detachedBody) {
            this._detachedBody.push(buf);
        }
        callback();
    }

    _final(callback: (error?: Error | null) => void): void {
        if (this._streaming) {
            if (this._nativeBackend) {
                this._nativeBackend.submitData(Buffer.alloc(0), true);
            } else if (this._soupMsg) {
                const responseBody = this._soupMsg.get_response_body();
                responseBody.complete();
                this._soupMsg.unpause();
            }
        } else {
            this._sendBatchResponse();
        }
        this.finished = true;
        callback();
    }

    private _sendBatchResponse(): void {
        if (this.headersSent) return;
        this.headersSent = true;

        if (this._timeoutTimer) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = null;
        }

        if (this._nativeBackend) {
            // No body — submit headers with END_STREAM.
            this._nativeBackend.submitResponse(this.statusCode, this.statusMessage, this._headers, true);
            return;
        }

        if (!this._soupMsg) return;

        this._soupMsg.set_status(this.statusCode, this.statusMessage || null);
        const responseHeaders = this._soupMsg.get_response_headers();

        for (const [key, value] of this._headers) {
            if (Array.isArray(value)) {
                for (const v of value) responseHeaders.append(key, v);
            } else {
                responseHeaders.replace(key, value as string);
            }
        }

        const contentType = (this._headers.get('content-type') as string) || 'text/plain';
        this._soupMsg.set_response(contentType, Soup.MemoryUse.COPY, new Uint8Array(0));
    }

    end(chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void): this {
        if (typeof chunk === 'function') {
            callback = chunk as () => void;
            chunk = undefined;
        } else if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }
        if (chunk != null) {
            this.write(chunk as string | Buffer, encoding as BufferEncoding);
        }
        super.end(callback);
        return this;
    }

    /**
     * respondWithFD — stream the contents of an open file descriptor as the
     * response body. Headers are sent once `statCheck()` (if provided) has
     * had a chance to mutate them; payload is read in 64 KiB chunks via
     * `fs.read()` and dispatched through the existing Soup chunked-write path.
     *
     * Reference: Node.js doc/api/http2.md § respondWithFD()
     */
    respondWithFD(
        fd: number | { fd: number },
        headers?: Record<string, string | string[] | number>,
        options?: { offset?: number; length?: number; statCheck?: (stat: any, headers: any, statOptions: any) => void },
    ): void {
        _respondFromFD(this, fd, headers, options ?? {}, /* closeFd */ false);
    }

    /**
     * respondWithFile — stream a regular file by path. Opens the file with
     * fs.openSync, runs the optional `statCheck()` callback so the user can
     * mutate headers based on stat results (last-modified, size, etag, …),
     * then delegates to the same FD-streaming path as `respondWithFD()`.
     *
     * Reference: Node.js doc/api/http2.md § respondWithFile()
     */
    respondWithFile(
        path: string,
        headers?: Record<string, string | string[] | number>,
        options?: {
            offset?: number;
            length?: number;
            statCheck?: (stat: any, headers: any, statOptions: any) => void;
            onError?: (err: Error) => void;
        },
    ): void {
        let fd: number;
        try {
            fd = openSync(path, 'r');
        } catch (err) {
            if (options?.onError) {
                options.onError(err as Error);
                return;
            }
            throw err;
        }
        _respondFromFD(this, fd, headers, options ?? {}, /* closeFd */ true);
    }

    /**
     * pushStream — request the server to push an additional resource on a
     * fresh server-initiated stream. The Vala/nghttp2 bridge allocates the
     * promised even stream-id and constructs the PUSH_PROMISE frame; wire-level
     * delivery requires raw nghttp2-on-socket access that Soup does not expose,
     * so the byte-frame is currently a no-op on the wire — but the bridge
     * allocator and frame builder are exercised end-to-end and the callback
     * receives a fully-usable `ServerHttp2Stream` whose `respond()` / `end()`
     * calls write into a synthetic in-memory stream observable from tests.
     *
     * See STATUS.md "Open TODOs" → "http2 PUSH_PROMISE wire delivery".
     */
    pushStream(
        headers: Record<string, string | string[] | number>,
        options:
            | { parent?: number; weight?: number; exclusive?: boolean }
            | ((err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void),
        callback?: (err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void,
    ): void {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (!callback) {
            // Match Node behaviour: missing callback raises ERR_INVALID_ARG_TYPE
            throw new TypeError('callback must be a function');
        }
        if (!this._stream) {
            callback(new Error('No associated stream'), null as unknown as ServerHttp2Stream, {});
            return;
        }
        this._stream.pushStream(headers, options, callback);
    }

    /**
     * createPushResponse — alternate API: create a child Http2ServerResponse
     * for the push without needing to bridge through ServerHttp2Stream. The
     * created response shares the parent's stream allocator + bridge.
     *
     * Reference: Node.js doc/api/http2.md § Http2ServerResponse#createPushResponse()
     */
    createPushResponse(
        headers: Record<string, string | string[] | number>,
        callback: (err: Error | null, res: Http2ServerResponse) => void,
    ): void {
        if (typeof callback !== 'function') {
            throw new TypeError('callback must be a function');
        }
        this.pushStream(headers, {}, (err, pushStream) => {
            if (err) {
                callback(err, null as unknown as Http2ServerResponse);
                return;
            }
            // The synthetic ServerHttp2Stream owns its own Http2ServerResponse
            // (created in ServerHttp2Stream.pushStream below) — extract it.
            const res = (pushStream as unknown as { _res?: Http2ServerResponse })._res;
            callback(null, res ?? (null as unknown as Http2ServerResponse));
        });
    }
}

// ─── ServerHttp2Stream ────────────────────────────────────────────────────────
// Facade over Http2ServerResponse exposing the session/stream API.
// Delegates all writes to the underlying response object.

export class ServerHttp2Stream extends EventEmitter {
    readonly id: number;
    readonly pushAllowed: boolean;
    readonly sentHeaders: Record<string, string | string[]> = {};

    private _res: Http2ServerResponse;
    private _session: ServerHttp2Session | null;
    private _isPushedStream: boolean;
    /** Children pushed off this request stream (parent → array). */
    private _pushedChildren: ServerHttp2Stream[] = [];
    /** Cached PUSH_PROMISE frame bytes for inspection in tests. */
    private _pushPromiseFrame: Uint8Array | null = null;
    /** Push request headers (`:method`, `:path`, …). */
    private _pushRequestHeaders: Record<string, string | string[]> | null = null;

    get session(): ServerHttp2Session | null { return this._session; }
    get headersSent(): boolean { return this._res.headersSent; }
    get closed(): boolean { return this._res.writableEnded; }
    get destroyed(): boolean { return this._res.destroyed; }
    get pending(): boolean { return false; }
    get state(): number {
        return this.closed ? constants.NGHTTP2_STREAM_STATE_CLOSED : constants.NGHTTP2_STREAM_STATE_OPEN;
    }

    /** Bytes of the PUSH_PROMISE frame this stream was reserved with (push streams only). */
    get pushPromiseFrame(): Uint8Array | null { return this._pushPromiseFrame; }
    /** Request headers the push was promised with (push streams only). */
    get pushRequestHeaders(): Record<string, string | string[]> | null { return this._pushRequestHeaders; }
    /** Push streams created from this stream. */
    get pushedChildren(): ReadonlyArray<ServerHttp2Stream> { return this._pushedChildren; }

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
        return this._res.write(
            chunk,
            encoding as BufferEncoding,
            callback,
        );
    }

    end(
        chunk?: Parameters<Http2ServerResponse['end']>[0],
        encoding?: BufferEncoding | (() => void),
        callback?: () => void,
    ): this {
        this._res.end(
            chunk,
            encoding as BufferEncoding,
            callback,
        );
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
            try { backend.reset(code ?? constants.NGHTTP2_NO_ERROR); } catch {}
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
        options?: { offset?: number; length?: number; statCheck?: (stat: any, headers: any, statOptions: any) => void },
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
            statCheck?: (stat: any, headers: any, statOptions: any) => void;
            onError?: (err: Error) => void;
        },
    ): void {
        this._res.respondWithFile(path, headers, options);
    }

    /**
     * pushStream — see {@link Http2ServerResponse.pushStream} for the full
     * contract. This is the lower-level entry point: it allocates a promised
     * stream-id from the session-bound `GjsifyHttp2.StreamIdAllocator`, builds
     * the PUSH_PROMISE frame via `GjsifyHttp2.FrameEncoder`, then synthesises
     * a child `ServerHttp2Stream` whose response surface is independent of
     * the parent's underlying SoupServerMessage.
     */
    pushStream(
        headers: Record<string, string | string[] | number>,
        options:
            | { parent?: number; weight?: number; exclusive?: boolean }
            | ((err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void),
        callback?: (err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void,
    ): void {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (!callback) {
            throw new TypeError('callback must be a function');
        }

        // Per RFC 7540 §8.2: pushed streams MUST NOT initiate further pushes.
        // Node surfaces this as ERR_HTTP2_NESTED_PUSH.
        if (this._isPushedStream) {
            const err = Object.assign(new Error('Cannot initiate nested push streams'), {
                code: 'ERR_HTTP2_NESTED_PUSH',
            });
            callback(err, null as unknown as ServerHttp2Stream, {});
            return;
        }

        // Session-level enable_push must be honoured. Soup-backed sessions
        // default to allowing it (we simulate the API), but a goaway/SETTINGS
        // toggle disables further pushes.
        if (this._session && this._session.canPush === false) {
            const err = Object.assign(new Error('HTTP/2 server push has been disabled'), {
                code: 'ERR_HTTP2_PUSH_DISABLED',
            });
            callback(err, null as unknown as ServerHttp2Stream, {});
            return;
        }

        // Allocate the promised stream-id and build the PUSH_PROMISE frame
        // bytes. Both go through the @gjsify/http2-native bridge when the
        // typelib is loadable; otherwise we fall back to in-process counters.
        let promisedId: number;
        let frameBytes: Uint8Array | null = null;
        let pushHeaders: Record<string, string | string[]> = {};

        // Normalise pseudo-headers — Node fills in :scheme/:authority from
        // the parent if omitted (matches refs/node/lib/internal/http2/util.js).
        const normalised: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(headers)) {
            normalised[k] = typeof v === 'number' ? String(v) : v;
        }
        if (!normalised[':method']) normalised[':method'] = 'GET';
        pushHeaders = normalised;

        // Native-dispatcher path: if this stream's response is backed by a
        // native backend, submit the PUSH_PROMISE through the wire and build
        // a pushed Http2ServerResponse whose writes route through the child
        // backend the dispatcher just allocated. Both the promised stream id
        // AND the PUSH_PROMISE frame come from nghttp2 itself.
        const parentBackend = this._res.nativeBackend;
        let pushChildBackend: Http2NativeBackend | null = null;
        if (parentBackend) {
            pushChildBackend = parentBackend.pushPromise(normalised);
            if (!pushChildBackend) {
                const err = Object.assign(new Error('No available stream ids'), {
                    code: 'ERR_HTTP2_OUT_OF_STREAMS',
                });
                callback(err, null as unknown as ServerHttp2Stream, {});
                return;
            }
            promisedId = pushChildBackend.streamId;
            // No frameBytes — the bytes are already on the wire; expose `null`
            // through `pushPromiseFrame` so consumers can distinguish the two
            // paths during the transition window.
            frameBytes = null;
        } else if (this._session) {
            promisedId = this._session._allocatePushId();
            if (promisedId === 0) {
                const err = Object.assign(new Error('No available stream ids'), {
                    code: 'ERR_HTTP2_OUT_OF_STREAMS',
                });
                callback(err, null as unknown as ServerHttp2Stream, {});
                return;
            }
            frameBytes = this._session._buildPushPromise(this.id, promisedId, normalised);
        } else {
            // No session attached — synthesise a counter so tests see a stable id.
            promisedId = 2;
        }

        // Build the synthetic response surface. Native path: wire writes via
        // the child backend. Soup path: writes land in a detached buffer
        // reachable from `pushStream._res.detachedBody` (test inspection only,
        // since Soup multiplexes HTTP/2 streams internally and refuses
        // external injection).
        const pushRes = pushChildBackend
            ? new Http2ServerResponse(null, pushChildBackend)
            : new Http2ServerResponse(_makeDetachedSoupMessage());
        const pushStream = new ServerHttp2Stream(pushRes, this._session, {
            isPushedStream: true,
            streamId: promisedId,
        });
        pushStream._pushPromiseFrame = frameBytes;
        pushStream._pushRequestHeaders = normalised;
        pushRes._setStream(pushStream);
        this._pushedChildren.push(pushStream);

        // Match Node's contract: callback runs asynchronously after the
        // pushStream is wired up.
        Promise.resolve().then(() => {
            callback!(null, pushStream, pushHeaders);
        });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Internal-only — only called from Response/Stream methods above.

/**
 * _makeDetachedSoupMessage — placeholder factory for push-stream Http2ServerResponse.
 *
 * Push streams have no associated SoupServerMessage (the Soup connection
 * multiplexer multiplexes them internally and refuses external injection),
 * so we hand the response a `null` Soup message and let it route writes
 * into a buffered backing store via `Http2ServerResponse._detachedBody`.
 *
 * Kept as a function (not an inline `null`) so future revisions can return
 * a real shadow message once Soup exposes the underlying nghttp2 session
 * — call sites won't have to change.
 */
function _makeDetachedSoupMessage(): Soup.ServerMessage | null {
    return null;
}

/**
 * _respondFromFD — common implementation behind respondWithFD / respondWithFile.
 *
 * Flow:
 *  1) statSync on the FD so the user-supplied `statCheck()` callback can
 *     mutate headers based on size / mtime / ino (Node parity).
 *  2) flushHeaders via writeHead — kicks the Soup chunked-write path.
 *  3) Read the FD in 64 KiB chunks via fs.read; pipe each chunk through
 *     `res.write()` so existing Soup pause/unpause back-pressure applies.
 *  4) On EOF, call `res.end()` and close the FD if we opened it.
 *
 * This deliberately uses `node:fs` (the gjsify polyfill) instead of
 * `Gio.UnixInputStream` so the same code path works on Node test runs.
 */
function _respondFromFD(
    res: Http2ServerResponse,
    fdOrHandle: number | { fd: number },
    headers: Record<string, string | string[] | number> | undefined,
    options: { offset?: number; length?: number; statCheck?: (stat: any, headers: any, statOptions: any) => void; onError?: (err: Error) => void },
    closeFd: boolean,
): void {
    // Both raw numeric fds and `@gjsify/fs` FileHandle wrappers (which carry
    // the numeric fd on `.fd`) are accepted — `fs.openSync()` returns the
    // wrapper on GJS, a raw integer on Node.
    const fd: number = typeof fdOrHandle === 'number' ? fdOrHandle : (fdOrHandle as { fd: number }).fd;
    // Always hand `fs.read` / `fs.close` the numeric fd. On GJS the @gjsify/fs
    // FileHandle wrapper registers itself under the numeric fd in its FD
    // table — passing the wrapper object itself fails the lookup
    // (object → "[object Object]" string key).
    const fdArg: number = fd;
    const finalHeaders: Record<string, string | string[] | number> = { ...(headers ?? {}) };

    // statCheck — mirrors Node's contract: lets the app mutate headers based
    // on stat results without hand-writing fstat boilerplate.
    if (options.statCheck) {
        try {
            const stat = statSync(_fdPath(fd) ?? '/proc/self/fd/' + fd);
            const cont = options.statCheck(stat, finalHeaders, options) as unknown;
            if (cont === false) {
                if (closeFd) closeSync(fd);
                res.end();
                return;
            }
        } catch (err) {
            if (options.onError) {
                options.onError(err as Error);
                if (closeFd) closeSync(fd);
                return;
            }
            // Continue without statCheck — Node's behaviour is to skip silently
            // when fstat fails (the FD will fail later in the read loop anyway).
        }
    }

    // Headers go out first.
    const status = Number(finalHeaders[':status'] ?? 200);
    delete finalHeaders[':status'];
    const sanitised: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(finalHeaders)) {
        sanitised[k] = typeof v === 'number' ? String(v) : v;
    }
    res.writeHead(status, sanitised);
    res.flushHeaders();

    const startOffset = Math.max(0, options.offset ?? 0);
    const totalLength = options.length;
    const CHUNK = 64 * 1024;
    const buffer = Buffer.alloc(CHUNK);
    let position = startOffset;
    let remaining = typeof totalLength === 'number' ? totalLength : Infinity;
    let bytesSent = 0;

    const readNext = (): void => {
        if (remaining <= 0) {
            finish();
            return;
        }
        const want = Math.min(CHUNK, remaining);
        fsRead(fdArg, buffer, 0, want, position, (err, bytesRead) => {
            if (err) {
                cleanup(err);
                return;
            }
            if (bytesRead === 0) {
                finish();
                return;
            }
            position += bytesRead;
            bytesSent += bytesRead;
            remaining -= bytesRead;
            // Copy the chunk so the same backing buffer can be reused on the
            // next read iteration without overwriting in-flight Soup data.
            const slice = Buffer.allocUnsafe(bytesRead);
            buffer.copy(slice, 0, 0, bytesRead);
            const ok = res.write(slice);
            if (ok) {
                readNext();
            } else {
                res.once('drain', readNext);
            }
        });
    };

    const finish = (): void => {
        res.end();
        if (closeFd) {
            try { closeSync(fdArg); } catch { /* ignore */ }
        }
    };

    const cleanup = (err: Error): void => {
        if (options.onError) options.onError(err);
        else res.destroy(err);
        if (closeFd) {
            try { closeSync(fdArg); } catch { /* ignore */ }
        }
    };

    // Suppress empty-body fstat path: if length===0 we just close out.
    if (remaining === 0) {
        finish();
        return;
    }

    readNext();
    // Mark that we used the fd-streaming path so listeners know the body
    // is being delivered out-of-band of the regular write() machinery.
    void bytesSent;
}

/**
 * _fdPath — best-effort fd → path lookup via `/proc/self/fd/<fd>`.
 *
 * Used only for statCheck; `fs.statSync` accepts that path on Linux to
 * stat the open FD. Returns null on non-Linux (caller falls back to
 * `/proc/self/fd/N` regardless — `statSync` will fail cleanly).
 */
function _fdPath(fd: number): string | null {
    if (typeof fd !== 'number' || fd < 0) return null;
    return '/proc/self/fd/' + fd;
}
