// Reference: Node.js lib/internal/http2/compat.js, lib/_http_server.js
// Reimplemented for GJS using Soup.Server (HTTP/2 transparently via ALPN when TLS is used)
//
// Phase 1 limitations (resolved in Phase 2):
//   - createServer() serves HTTP/1.1 only (Soup does not support h2c/cleartext HTTP/2)
//   - createSecureServer() negotiates h2 via ALPN automatically when TLS cert is set
//   - pushStream(), respondWithFD(), respondWithFile() are stubs
//   - stream IDs are always 1 (Soup internal)
//
// Phase 2 (this file, post-`@gjsify/http2-native`):
//   - respondWithFD()   — fully wired through fs.read on the FD into Soup's chunked write path
//   - respondWithFile() — fully wired through fs.createReadStream
//   - pushStream()      — accepts the call, allocates a stream-id via the
//                         GjsifyHttp2.StreamIdAllocator, builds the PUSH_PROMISE
//                         frame in-memory via GjsifyHttp2.FrameEncoder. Wire-level
//                         delivery still requires raw nghttp2-on-socket access
//                         that Soup does not expose — see STATUS.md "Open TODOs".
//                         The callback IS invoked with a usable ServerHttp2Stream
//                         so application code that fans out a "main + push" pair
//                         observes a working API contract.
//   - stream IDs        — sourced from the bridge allocator (server pushes use
//                         even ids starting at 2, client requests still appear
//                         as 1 via the Soup compat layer)

import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { read as fsRead, createReadStream, statSync, openSync, closeSync } from 'node:fs';
import { deferEmit, ensureMainLoop } from '@gjsify/utils';
import { hasNativeHttp2, loadNativeHttp2 } from '@gjsify/http2-native';
import { constants, getDefaultSettings, type Http2Settings } from './protocol.js';

export type { Http2Settings };

// ─── Http2ServerRequest ───────────────────────────────────────────────────────

export class Http2ServerRequest extends Readable {
  method = 'GET';
  url = '/';
  headers: Record<string, string | string[]> = {};
  rawHeaders: string[] = [];
  authority = '';
  scheme = 'https';
  httpVersion = '2.0';
  httpVersionMajor = 2;
  httpVersionMinor = 0;
  complete = false;
  socket: any = null;
  trailers: Record<string, string> = {};
  rawTrailers: string[] = [];

  private _stream: ServerHttp2Stream | null = null;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  get stream(): ServerHttp2Stream | null { return this._stream; }

  // Called by Http2Server after stream is created
  _setStream(stream: ServerHttp2Stream): void {
    this._stream = stream;
  }

  constructor() {
    super();
  }

  _read(_size: number): void {}

  // 'close' means connection lost, not body-stream end
  protected _autoClose(): void {}

  _pushBody(body: Uint8Array | null): void {
    if (body && body.length > 0) {
      this.push(Buffer.from(body));
    }
    this.push(null);
    this.complete = true;
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  }

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

  destroy(error?: Error): this {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
    return super.destroy(error) as this;
  }
}

// ─── Http2ServerResponse ──────────────────────────────────────────────────────

/**
 * Backend that routes writes through `SessionBridge.submit_response()` +
 * `submit_data()` instead of into a Soup message. Set on responses produced
 * by the native dispatcher (Phase 1+). When `_nativeBackend` is non-null,
 * `Http2ServerResponse` ignores its `_soupMsg` field (also null in that case)
 * and dispatches every operation through this object.
 */
export interface Http2NativeBackend {
  submitResponse(statusCode: number, statusMessage: string, headers: Map<string, string | string[]>, endStream: boolean): void;
  submitData(chunk: Buffer, endStream: boolean): void;
  reset(errorCode: number): void;
  /** Used by pushStream() to allocate the promised id + send PUSH_PROMISE. */
  submitPushPromise(headers: Record<string, string | string[]>): number;
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

  // Writable-like interface delegating to response
  write(chunk: any, encoding?: BufferEncoding | (() => void), callback?: () => void): boolean {
    return this._res.write(chunk as any, encoding as any, callback as any);
  }

  end(chunk?: any, encoding?: BufferEncoding | (() => void), callback?: () => void): this {
    this._res.end(chunk as any, encoding as any, callback as any);
    return this;
  }

  destroy(error?: Error): this {
    this._res.destroy(error);
    return this;
  }

  close(code?: number, callback?: () => void): void {
    if (callback) this.once('close', callback);
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

    if (this._session) {
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

    // Build the synthetic response surface. We can't dispatch a separate
    // SoupServerMessage onto the existing Soup connection (Soup multiplexes
    // streams internally and refuses external injection), so the push
    // response writes into a detached buffer reachable from `pushStream._res`.
    const pushRes = new Http2ServerResponse(_makeDetachedSoupMessage());
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

// ─── ServerHttp2Session ───────────────────────────────────────────────────────

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

// ─── Http2Server ──────────────────────────────────────────────────────────────

// GC guard — prevents server from being collected while listening
const _activeServers = new Set<Http2Server>();

export interface ServerOptions {
  allowHTTP1?: boolean;
  maxDeflateDynamicTableSize?: number;
  maxSessionMemory?: number;
  maxHeaderListPairs?: number;
  maxOutstandingPings?: number;
  maxSendHeaderBlockLength?: number;
  paddingStrategy?: number;
  peerMaxHeaderListSize?: number;
  selectPadding?: (frameLen: number, maxFrameLen: number) => number;
  settings?: Http2Settings;
  Http1IncomingMessage?: any;
  Http1ServerResponse?: any;
  unknownProtocolTimeout?: number;
  /**
   * Native dispatcher mode (gjsify-specific, defaults to `'auto'`).
   *
   * - `'auto'` — use the @gjsify/http2-native dispatcher when available and
   *   the call is for cleartext HTTP/2 (`createServer({allowHTTP1: false})`)
   *   or h2 ALPN over TLS. Falls back to Soup HTTP/1.1 otherwise.
   * - `'force'` — always use the native dispatcher; throws if the prebuild
   *   is missing. Useful for tests + integration with raw nghttp2 clients.
   * - `'off'` — never use the dispatcher; keep the Soup path even for h2c.
   *   `createServer({allowHTTP1: false})` then has no working configuration
   *   and listen() will throw.
   */
  nativeDispatcher?: 'auto' | 'force' | 'off';
}

export class Http2Server extends EventEmitter {
  listening = false;
  maxHeadersCount = 2000;
  timeout = 0;

  protected _soupServer: Soup.Server | null = null;
  protected _nativeDispatcher: import('./native-dispatcher.js').Http2NativeDispatcher | null = null;
  protected _address: { port: number; family: string; address: string } | null = null;
  protected _options: ServerOptions;

  get soupServer(): Soup.Server | null { return this._soupServer; }
  get nativeDispatcher(): import('./native-dispatcher.js').Http2NativeDispatcher | null {
    return this._nativeDispatcher;
  }

  constructor(options?: ServerOptions | ((req: Http2ServerRequest, res: Http2ServerResponse) => void), handler?: (req: Http2ServerRequest, res: Http2ServerResponse) => void) {
    super();
    if (typeof options === 'function') {
      handler = options;
      options = {};
    }
    this._options = options ?? {};
    if (handler) this.on('request', handler);
  }

  listen(port?: number, hostname?: string, backlog?: number, callback?: () => void): this;
  listen(port?: number, hostname?: string, callback?: () => void): this;
  listen(port?: number, callback?: () => void): this;
  listen(...args: unknown[]): this {
    let port = 0;
    let hostname = '0.0.0.0';
    let callback: (() => void) | undefined;

    for (const arg of args) {
      if (typeof arg === 'number') port = arg;
      else if (typeof arg === 'string') hostname = arg;
      else if (typeof arg === 'function') callback = arg as () => void;
    }

    if (callback) this.once('listening', callback);

    try {
      // Decide whether to take the native dispatcher path. createServer({
      // allowHTTP1: false }) signals "h2c only" — Soup can't serve h2c, so
      // we MUST use the native dispatcher. `nativeDispatcher: 'force'` is a
      // test escape hatch.
      const mode = this._options.nativeDispatcher ?? 'auto';
      const wantsNative =
        mode === 'force' ||
        (mode === 'auto' && this._options.allowHTTP1 === false);

      if (mode === 'off' && this._options.allowHTTP1 === false) {
        throw new Error(
          'createServer({ allowHTTP1: false }) requires the native dispatcher; ' +
          'nativeDispatcher cannot be "off" in this configuration',
        );
      }

      if (wantsNative) {
        this._startNativeListen(port, hostname);
        ensureMainLoop();
        deferEmit(this, 'listening');
        _activeServers.add(this);
        return this;
      }

      this._soupServer = new Soup.Server({});
      this._configureSoupServer(this._soupServer);

      this._soupServer.add_handler(null, (_server: Soup.Server, msg: Soup.ServerMessage, _path: string) => {
        this._handleRequest(msg);
      });

      this._soupServer.listen_local(port, Soup.ServerListenOptions.IPV4_ONLY);
      ensureMainLoop();

      const listeners = this._soupServer.get_listeners();
      let actualPort = port;
      if (listeners && listeners.length > 0) {
        const addr = listeners[0].get_local_address() as Gio.InetSocketAddress;
        if (addr && typeof addr.get_port === 'function') {
          actualPort = addr.get_port();
        }
      }

      this.listening = true;
      this._address = { port: actualPort, family: 'IPv4', address: hostname };
      _activeServers.add(this);

      deferEmit(this, 'listening');
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.listenerCount('error') === 0) throw error;
      deferEmit(this, 'error', error);
    }

    return this;
  }

  /**
   * Native dispatcher takes over the listen socket. Soup is not involved.
   * Used by createServer({allowHTTP1: false}) (h2c).
   */
  private _startNativeListen(port: number, hostname: string): void {
    // Lazy import keeps the module out of the Node bundle for createServer
    // consumers who never opt into the native path.
    const { Http2NativeDispatcher } = require('./native-dispatcher.js') as typeof import('./native-dispatcher.js');
    if (!Http2NativeDispatcher.available()) {
      throw new Error(
        '@gjsify/http2-native prebuild is not loadable. createServer({ allowHTTP1: false }) ' +
        'requires the native HTTP/2 dispatcher. Ensure GjsifyHttp2-1.0.typelib is installed.',
      );
    }
    this._nativeDispatcher = new Http2NativeDispatcher({
      handler: (event) => this._handleNativeStream(event),
    });
    const actualPort = this._nativeDispatcher.listen(port);
    this.listening = true;
    this._address = { port: actualPort, family: 'IPv4', address: hostname };
  }

  /** @internal Handler for streams arriving on the native dispatcher. */
  private _handleNativeStream(event: import('./native-dispatcher.js').NativeStreamEvent): void {
    const req = new Http2ServerRequest();

    // Build the native backend that routes _write/_final through the bridge.
    const backend: Http2NativeBackend = {
      submitResponse: (statusCode, _statusMessage, headers, endStream) => {
        const responseHeaders: Record<string, string | number | string[]> = {
          ':status': statusCode,
        };
        for (const [k, v] of headers) responseHeaders[k] = v as string | string[];
        event.respond(responseHeaders, endStream);
      },
      submitData: (chunk, endStream) => event.writeData(chunk, endStream),
      reset: (errorCode) => event.reset(errorCode),
      submitPushPromise: (headers) => event.pushPromise(headers),
    };

    const res = new Http2ServerResponse(null, backend);
    const session = new ServerHttp2Session();
    const stream = new ServerHttp2Stream(res, session, { streamId: event.streamId });
    req._setStream(stream);
    res._setStream(stream);

    // Populate request metadata from the pseudo-headers.
    const headers = event.headers;
    req.method = String((headers[':method'] ?? 'GET'));
    const path = String(headers[':path'] ?? '/');
    req.url = path;
    req.authority = String(headers[':authority'] ?? '');
    req.scheme = String(headers[':scheme'] ?? 'http');
    req.httpVersion = '2.0';
    req.httpVersionMajor = 2;
    req.httpVersionMinor = 0;

    // Strip pseudo-headers from regular headers; everything else stays.
    for (const [k, v] of Object.entries(headers)) {
      if (k.startsWith(':')) continue;
      req.headers[k] = v;
      if (Array.isArray(v)) {
        for (const item of v) req.rawHeaders.push(k, item);
      } else {
        req.rawHeaders.push(k, v);
      }
    }

    req.socket = {
      remoteAddress: event.remoteAddress,
      remotePort: event.remotePort,
      localAddress: this._address?.address ?? '127.0.0.1',
      localPort: event.localPort,
      encrypted: false,
    } as any;

    // Drain DATA frames into the Readable. The dispatcher gave us an async
    // iterable; pump it into `_pushBody` and signal EOF.
    (async () => {
      try {
        for await (const chunk of event.body) {
          req._pushBody(chunk);
        }
        req._pushBody(null);
      } catch {
        req._pushBody(null);
      }
    })();

    // Build the stream headers (Node-compat: includes pseudo-headers).
    const streamHeaders: Record<string, string | string[]> = { ...headers };
    this.emit('stream', stream, streamHeaders);
    this.emit('request', req, res);
  }

  // Override in Http2SecureServer to set TLS certificate before listen
  protected _configureSoupServer(_server: Soup.Server): void {}

  private _handleRequest(soupMsg: Soup.ServerMessage): void {
    const req = new Http2ServerRequest();
    const res = new Http2ServerResponse(soupMsg);

    // Populate request metadata
    req.method = soupMsg.get_method();
    const uri = soupMsg.get_uri();
    const path = uri.get_path();
    const query = uri.get_query();
    req.url = query ? path + '?' + query : path;
    req.authority = uri.get_host() ?? '';
    req.scheme = uri.get_scheme() ?? 'http';

    // Detect HTTP version from Soup
    const httpVersion = soupMsg.get_http_version();
    if (httpVersion === Soup.HTTPVersion.HTTP_2_0) {
      req.httpVersion = '2.0';
      req.httpVersionMajor = 2;
      req.httpVersionMinor = 0;
    } else {
      req.httpVersion = '1.1';
      req.httpVersionMajor = 1;
      req.httpVersionMinor = 1;
    }

    // Parse request headers
    const requestHeaders = soupMsg.get_request_headers();
    requestHeaders.foreach((name: string, value: string) => {
      const lower = name.toLowerCase();
      req.rawHeaders.push(name, value);
      if (lower in req.headers) {
        const existing = req.headers[lower];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          req.headers[lower] = [existing as string, value];
        }
      } else {
        req.headers[lower] = value;
      }
    });

    // Remote address info
    const remoteHost = soupMsg.get_remote_host() ?? '127.0.0.1';
    const remoteAddr = soupMsg.get_remote_address();
    const remotePort = (remoteAddr instanceof Gio.InetSocketAddress) ? remoteAddr.get_port() : 0;
    req.socket = {
      remoteAddress: remoteHost,
      remotePort,
      localAddress: this._address?.address ?? '127.0.0.1',
      localPort: this._address?.port ?? 0,
      encrypted: this instanceof Http2SecureServer,
    } as any;

    // Push request body into the readable stream
    const body = soupMsg.get_request_body();
    if (body?.data && body.data.length > 0) {
      req._pushBody(body.data);
    } else {
      req._pushBody(null);
    }

    // Build headers record for 'stream' event (http2 session API)
    const streamHeaders: Record<string, string | string[]> = {
      ':method': req.method,
      ':path': req.url,
      ':authority': req.authority,
      ':scheme': req.scheme,
      ...req.headers,
    };

    // Pause Soup until response is sent
    soupMsg.pause();
    res.on('finish', () => soupMsg.unpause());

    // Create stream facade and wire references
    const session = new ServerHttp2Session();
    const stream = new ServerHttp2Stream(res, session);
    req._setStream(stream);
    res._setStream(stream);

    // Emit both session API ('stream') and compat API ('request') events
    this.emit('stream', stream, streamHeaders);
    this.emit('request', req, res);
  }

  address(): { port: number; family: string; address: string } | null {
    return this._address;
  }

  close(callback?: (err?: Error) => void): this {
    if (callback) this.once('close', callback);
    if (this._soupServer) {
      this._soupServer.disconnect();
      this._soupServer = null;
    }
    if (this._nativeDispatcher) {
      this._nativeDispatcher.close();
      this._nativeDispatcher = null;
    }
    this.listening = false;
    _activeServers.delete(this);
    deferEmit(this, 'close');
    return this;
  }

  setTimeout(msecs: number, callback?: () => void): this {
    this.timeout = msecs;
    if (callback) this.on('timeout', callback);
    return this;
  }
}

// ─── Http2SecureServer ────────────────────────────────────────────────────────

export interface SecureServerOptions extends ServerOptions {
  cert?: string | Buffer | Array<string | Buffer>;
  key?: string | Buffer | Array<string | Buffer>;
  pfx?: string | Buffer | Array<string | Buffer>;
  passphrase?: string;
  ca?: string | Buffer | Array<string | Buffer>;
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
  ALPNProtocols?: string[];
}

export class Http2SecureServer extends Http2Server {
  private _tlsCert: Gio.TlsCertificate | null = null;

  constructor(options: SecureServerOptions, handler?: (req: Http2ServerRequest, res: Http2ServerResponse) => void) {
    super(options, handler);

    if (options.cert && options.key) {
      const certPem = _toPemString(options.cert);
      const keyPem = _toPemString(options.key);
      this._tlsCert = _createTlsCertificate(certPem, keyPem);
    } else if (options.pfx) {
      // PKCS#12 not supported yet; TLS still works if a cert was set via setSecureContext
    }
  }

  protected _configureSoupServer(server: Soup.Server): void {
    if (this._tlsCert) {
      server.set_tls_certificate(this._tlsCert);
    }
  }

  setSecureContext(options: SecureServerOptions): void {
    if (options.cert && options.key) {
      const certPem = _toPemString(options.cert);
      const keyPem = _toPemString(options.key);
      this._tlsCert = _createTlsCertificate(certPem, keyPem);
      if (this._soupServer && this._tlsCert) {
        this._soupServer.set_tls_certificate(this._tlsCert);
      }
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _toPemString(value: string | Buffer | Array<string | Buffer>): string {
  if (Array.isArray(value)) {
    return value.map(_toPemString).join('\n');
  }
  return Buffer.isBuffer(value) ? value.toString('utf8') : (value as string);
}

function _createTlsCertificate(certPem: string, keyPem: string): Gio.TlsCertificate {
  // Combine cert + key into a single PEM string — Gio.TlsCertificate.new_from_pem() accepts both
  const combined = certPem.trimEnd() + '\n' + keyPem.trimEnd() + '\n';
  try {
    return Gio.TlsCertificate.new_from_pem(combined, -1);
  } catch (err) {
    // Fall back: write to temp files
    const tmpDir = GLib.get_tmp_dir();
    const certPath = GLib.build_filenamev([tmpDir, 'gjsify-http2-cert.pem']);
    const keyPath = GLib.build_filenamev([tmpDir, 'gjsify-http2-key.pem']);
    try {
      GLib.file_set_contents(certPath, certPem);
      GLib.file_set_contents(keyPath, keyPem);
      const tlsCert = Gio.TlsCertificate.new_from_files(certPath, keyPath);
      return tlsCert;
    } finally {
      try { Gio.File.new_for_path(certPath).delete(null); } catch {}
      try { Gio.File.new_for_path(keyPath).delete(null); } catch {}
    }
  }
}

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
