// Reference: Node.js lib/http2.js, lib/internal/http2/core.js, lib/internal/http2/util.js
// Reimplemented for GJS — constants and settings are fully implemented,
// createServer/connect are stubs (Soup 3.0 handles HTTP/2 transparently but
// does not expose multiplexed streams needed for the full Node.js API)

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Constants — complete set matching Node.js http2.constants
// ---------------------------------------------------------------------------

export const constants = {
  // --- NGHTTP2 Error Codes (RFC 7540 Section 7) ---
  NGHTTP2_NO_ERROR: 0x00,
  NGHTTP2_PROTOCOL_ERROR: 0x01,
  NGHTTP2_INTERNAL_ERROR: 0x02,
  NGHTTP2_FLOW_CONTROL_ERROR: 0x03,
  NGHTTP2_SETTINGS_TIMEOUT: 0x04,
  NGHTTP2_STREAM_CLOSED: 0x05,
  NGHTTP2_FRAME_SIZE_ERROR: 0x06,
  NGHTTP2_REFUSED_STREAM: 0x07,
  NGHTTP2_CANCEL: 0x08,
  NGHTTP2_COMPRESSION_ERROR: 0x09,
  NGHTTP2_CONNECT_ERROR: 0x0a,
  NGHTTP2_ENHANCE_YOUR_CALM: 0x0b,
  NGHTTP2_INADEQUATE_SECURITY: 0x0c,
  NGHTTP2_HTTP_1_1_REQUIRED: 0x0d,

  // --- NGHTTP2 Internal Error Codes ---
  NGHTTP2_ERR_FRAME_SIZE_ERROR: -522,
  NGHTTP2_ERR_DEFERRED: -508,
  NGHTTP2_ERR_STREAM_ID_NOT_AVAILABLE: -509,
  NGHTTP2_ERR_INVALID_ARGUMENT: -501,
  NGHTTP2_ERR_STREAM_CLOSED: -510,
  NGHTTP2_ERR_NOMEM: -901,

  // --- Session Types ---
  NGHTTP2_SESSION_SERVER: 0,
  NGHTTP2_SESSION_CLIENT: 1,

  // --- Stream States ---
  NGHTTP2_STREAM_STATE_IDLE: 1,
  NGHTTP2_STREAM_STATE_OPEN: 2,
  NGHTTP2_STREAM_STATE_RESERVED_LOCAL: 3,
  NGHTTP2_STREAM_STATE_RESERVED_REMOTE: 4,
  NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL: 5,
  NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE: 6,
  NGHTTP2_STREAM_STATE_CLOSED: 7,

  // --- Frame Flags ---
  NGHTTP2_FLAG_NONE: 0,
  NGHTTP2_FLAG_END_STREAM: 0x01,
  NGHTTP2_FLAG_END_HEADERS: 0x04,
  NGHTTP2_FLAG_ACK: 0x01,
  NGHTTP2_FLAG_PADDED: 0x08,
  NGHTTP2_FLAG_PRIORITY: 0x20,

  // --- Header Categories ---
  NGHTTP2_HCAT_REQUEST: 0,
  NGHTTP2_HCAT_RESPONSE: 1,
  NGHTTP2_HCAT_PUSH_RESPONSE: 2,
  NGHTTP2_HCAT_HEADERS: 3,

  // --- NV Flags ---
  NGHTTP2_NV_FLAG_NONE: 0,
  NGHTTP2_NV_FLAG_NO_INDEX: 0x01,

  // --- Settings IDs (RFC 7540 Section 6.5.2) ---
  NGHTTP2_SETTINGS_HEADER_TABLE_SIZE: 0x01,
  NGHTTP2_SETTINGS_ENABLE_PUSH: 0x02,
  NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS: 0x03,
  NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE: 0x04,
  NGHTTP2_SETTINGS_MAX_FRAME_SIZE: 0x05,
  NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE: 0x06,
  NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL: 0x08,

  // --- Default Settings Values ---
  DEFAULT_SETTINGS_HEADER_TABLE_SIZE: 4096,
  DEFAULT_SETTINGS_ENABLE_PUSH: 1,
  DEFAULT_SETTINGS_MAX_CONCURRENT_STREAMS: 0xffffffff,
  DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE: 65535,
  DEFAULT_SETTINGS_MAX_FRAME_SIZE: 16384,
  DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE: 65535,
  DEFAULT_SETTINGS_ENABLE_CONNECT_PROTOCOL: 0,

  // --- Frame Size Constraints ---
  MAX_MAX_FRAME_SIZE: 16777215,
  MIN_MAX_FRAME_SIZE: 16384,
  MAX_INITIAL_WINDOW_SIZE: 2147483647,
  NGHTTP2_DEFAULT_WEIGHT: 16,

  // --- Padding Strategies ---
  PADDING_STRATEGY_NONE: 0,
  PADDING_STRATEGY_ALIGNED: 1,
  PADDING_STRATEGY_MAX: 2,
  PADDING_STRATEGY_CALLBACK: 1,

  // --- HTTP/2 Pseudo-Headers ---
  HTTP2_HEADER_STATUS: ':status',
  HTTP2_HEADER_METHOD: ':method',
  HTTP2_HEADER_AUTHORITY: ':authority',
  HTTP2_HEADER_SCHEME: ':scheme',
  HTTP2_HEADER_PATH: ':path',
  HTTP2_HEADER_PROTOCOL: ':protocol',

  // --- Standard HTTP Headers ---
  HTTP2_HEADER_ACCEPT: 'accept',
  HTTP2_HEADER_ACCEPT_CHARSET: 'accept-charset',
  HTTP2_HEADER_ACCEPT_ENCODING: 'accept-encoding',
  HTTP2_HEADER_ACCEPT_LANGUAGE: 'accept-language',
  HTTP2_HEADER_ACCEPT_RANGES: 'accept-ranges',
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS: 'access-control-allow-credentials',
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS: 'access-control-allow-headers',
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS: 'access-control-allow-methods',
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN: 'access-control-allow-origin',
  HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS: 'access-control-expose-headers',
  HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE: 'access-control-max-age',
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS: 'access-control-request-headers',
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD: 'access-control-request-method',
  HTTP2_HEADER_AGE: 'age',
  HTTP2_HEADER_ALLOW: 'allow',
  HTTP2_HEADER_ALT_SVC: 'alt-svc',
  HTTP2_HEADER_AUTHORIZATION: 'authorization',
  HTTP2_HEADER_CACHE_CONTROL: 'cache-control',
  HTTP2_HEADER_CONNECTION: 'connection',
  HTTP2_HEADER_CONTENT_DISPOSITION: 'content-disposition',
  HTTP2_HEADER_CONTENT_ENCODING: 'content-encoding',
  HTTP2_HEADER_CONTENT_LANGUAGE: 'content-language',
  HTTP2_HEADER_CONTENT_LENGTH: 'content-length',
  HTTP2_HEADER_CONTENT_LOCATION: 'content-location',
  HTTP2_HEADER_CONTENT_MD5: 'content-md5',
  HTTP2_HEADER_CONTENT_RANGE: 'content-range',
  HTTP2_HEADER_CONTENT_SECURITY_POLICY: 'content-security-policy',
  HTTP2_HEADER_CONTENT_TYPE: 'content-type',
  HTTP2_HEADER_COOKIE: 'cookie',
  HTTP2_HEADER_DATE: 'date',
  HTTP2_HEADER_DNT: 'dnt',
  HTTP2_HEADER_EARLY_DATA: 'early-data',
  HTTP2_HEADER_ETAG: 'etag',
  HTTP2_HEADER_EXPECT: 'expect',
  HTTP2_HEADER_EXPECT_CT: 'expect-ct',
  HTTP2_HEADER_EXPIRES: 'expires',
  HTTP2_HEADER_FORWARDED: 'forwarded',
  HTTP2_HEADER_FROM: 'from',
  HTTP2_HEADER_HOST: 'host',
  HTTP2_HEADER_HTTP2_SETTINGS: 'http2-settings',
  HTTP2_HEADER_IF_MATCH: 'if-match',
  HTTP2_HEADER_IF_MODIFIED_SINCE: 'if-modified-since',
  HTTP2_HEADER_IF_NONE_MATCH: 'if-none-match',
  HTTP2_HEADER_IF_RANGE: 'if-range',
  HTTP2_HEADER_IF_UNMODIFIED_SINCE: 'if-unmodified-since',
  HTTP2_HEADER_KEEP_ALIVE: 'keep-alive',
  HTTP2_HEADER_LAST_MODIFIED: 'last-modified',
  HTTP2_HEADER_LINK: 'link',
  HTTP2_HEADER_LOCATION: 'location',
  HTTP2_HEADER_MAX_FORWARDS: 'max-forwards',
  HTTP2_HEADER_ORIGIN: 'origin',
  HTTP2_HEADER_PREFER: 'prefer',
  HTTP2_HEADER_PRIORITY: 'priority',
  HTTP2_HEADER_PROXY_AUTHENTICATE: 'proxy-authenticate',
  HTTP2_HEADER_PROXY_AUTHORIZATION: 'proxy-authorization',
  HTTP2_HEADER_PROXY_CONNECTION: 'proxy-connection',
  HTTP2_HEADER_RANGE: 'range',
  HTTP2_HEADER_REFERER: 'referer',
  HTTP2_HEADER_REFRESH: 'refresh',
  HTTP2_HEADER_RETRY_AFTER: 'retry-after',
  HTTP2_HEADER_SERVER: 'server',
  HTTP2_HEADER_SET_COOKIE: 'set-cookie',
  HTTP2_HEADER_STRICT_TRANSPORT_SECURITY: 'strict-transport-security',
  HTTP2_HEADER_TE: 'te',
  HTTP2_HEADER_TIMING_ALLOW_ORIGIN: 'timing-allow-origin',
  HTTP2_HEADER_TRAILER: 'trailer',
  HTTP2_HEADER_TRANSFER_ENCODING: 'transfer-encoding',
  HTTP2_HEADER_TK: 'tk',
  HTTP2_HEADER_UPGRADE: 'upgrade',
  HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS: 'upgrade-insecure-requests',
  HTTP2_HEADER_USER_AGENT: 'user-agent',
  HTTP2_HEADER_VARY: 'vary',
  HTTP2_HEADER_VIA: 'via',
  HTTP2_HEADER_WARNING: 'warning',
  HTTP2_HEADER_WWW_AUTHENTICATE: 'www-authenticate',
  HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS: 'x-content-type-options',
  HTTP2_HEADER_X_FORWARDED_FOR: 'x-forwarded-for',
  HTTP2_HEADER_X_FRAME_OPTIONS: 'x-frame-options',
  HTTP2_HEADER_X_XSS_PROTECTION: 'x-xss-protection',
  HTTP2_HEADER_PURPOSE: 'purpose',

  // --- HTTP Methods ---
  HTTP2_METHOD_ACL: 'ACL',
  HTTP2_METHOD_BASELINE_CONTROL: 'BASELINE-CONTROL',
  HTTP2_METHOD_BIND: 'BIND',
  HTTP2_METHOD_CHECKIN: 'CHECKIN',
  HTTP2_METHOD_CHECKOUT: 'CHECKOUT',
  HTTP2_METHOD_CONNECT: 'CONNECT',
  HTTP2_METHOD_COPY: 'COPY',
  HTTP2_METHOD_DELETE: 'DELETE',
  HTTP2_METHOD_GET: 'GET',
  HTTP2_METHOD_HEAD: 'HEAD',
  HTTP2_METHOD_LABEL: 'LABEL',
  HTTP2_METHOD_LINK: 'LINK',
  HTTP2_METHOD_LOCK: 'LOCK',
  HTTP2_METHOD_MERGE: 'MERGE',
  HTTP2_METHOD_MKACTIVITY: 'MKACTIVITY',
  HTTP2_METHOD_MKCALENDAR: 'MKCALENDAR',
  HTTP2_METHOD_MKCOL: 'MKCOL',
  HTTP2_METHOD_MKREDIRECTREF: 'MKREDIRECTREF',
  HTTP2_METHOD_MKWORKSPACE: 'MKWORKSPACE',
  HTTP2_METHOD_MOVE: 'MOVE',
  HTTP2_METHOD_OPTIONS: 'OPTIONS',
  HTTP2_METHOD_ORDERPATCH: 'ORDERPATCH',
  HTTP2_METHOD_PATCH: 'PATCH',
  HTTP2_METHOD_POST: 'POST',
  HTTP2_METHOD_PRI: 'PRI',
  HTTP2_METHOD_PROPFIND: 'PROPFIND',
  HTTP2_METHOD_PROPPATCH: 'PROPPATCH',
  HTTP2_METHOD_PUT: 'PUT',
  HTTP2_METHOD_REBIND: 'REBIND',
  HTTP2_METHOD_REPORT: 'REPORT',
  HTTP2_METHOD_SEARCH: 'SEARCH',
  HTTP2_METHOD_TRACE: 'TRACE',
  HTTP2_METHOD_UNBIND: 'UNBIND',
  HTTP2_METHOD_UNCHECKOUT: 'UNCHECKOUT',
  HTTP2_METHOD_UNLINK: 'UNLINK',
  HTTP2_METHOD_UNLOCK: 'UNLOCK',
  HTTP2_METHOD_UPDATE: 'UPDATE',
  HTTP2_METHOD_UPDATEREDIRECTREF: 'UPDATEREDIRECTREF',
  HTTP2_METHOD_VERSION_CONTROL: 'VERSION-CONTROL',

  // --- HTTP Status Codes ---
  HTTP_STATUS_CONTINUE: 100,
  HTTP_STATUS_SWITCHING_PROTOCOLS: 101,
  HTTP_STATUS_PROCESSING: 102,
  HTTP_STATUS_EARLY_HINTS: 103,
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_CREATED: 201,
  HTTP_STATUS_ACCEPTED: 202,
  HTTP_STATUS_NON_AUTHORITATIVE_INFORMATION: 203,
  HTTP_STATUS_NO_CONTENT: 204,
  HTTP_STATUS_RESET_CONTENT: 205,
  HTTP_STATUS_PARTIAL_CONTENT: 206,
  HTTP_STATUS_MULTI_STATUS: 207,
  HTTP_STATUS_ALREADY_REPORTED: 208,
  HTTP_STATUS_IM_USED: 226,
  HTTP_STATUS_MULTIPLE_CHOICES: 300,
  HTTP_STATUS_MOVED_PERMANENTLY: 301,
  HTTP_STATUS_FOUND: 302,
  HTTP_STATUS_SEE_OTHER: 303,
  HTTP_STATUS_NOT_MODIFIED: 304,
  HTTP_STATUS_USE_PROXY: 305,
  HTTP_STATUS_TEMPORARY_REDIRECT: 307,
  HTTP_STATUS_PERMANENT_REDIRECT: 308,
  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_PAYMENT_REQUIRED: 402,
  HTTP_STATUS_FORBIDDEN: 403,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_METHOD_NOT_ALLOWED: 405,
  HTTP_STATUS_NOT_ACCEPTABLE: 406,
  HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED: 407,
  HTTP_STATUS_REQUEST_TIMEOUT: 408,
  HTTP_STATUS_CONFLICT: 409,
  HTTP_STATUS_GONE: 410,
  HTTP_STATUS_LENGTH_REQUIRED: 411,
  HTTP_STATUS_PRECONDITION_FAILED: 412,
  HTTP_STATUS_PAYLOAD_TOO_LARGE: 413,
  HTTP_STATUS_URI_TOO_LONG: 414,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE: 415,
  HTTP_STATUS_RANGE_NOT_SATISFIABLE: 416,
  HTTP_STATUS_EXPECTATION_FAILED: 417,
  HTTP_STATUS_TEAPOT: 418,
  HTTP_STATUS_MISDIRECTED_REQUEST: 421,
  HTTP_STATUS_UNPROCESSABLE_ENTITY: 422,
  HTTP_STATUS_LOCKED: 423,
  HTTP_STATUS_FAILED_DEPENDENCY: 424,
  HTTP_STATUS_TOO_EARLY: 425,
  HTTP_STATUS_UPGRADE_REQUIRED: 426,
  HTTP_STATUS_PRECONDITION_REQUIRED: 428,
  HTTP_STATUS_TOO_MANY_REQUESTS: 429,
  HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
  HTTP_STATUS_NOT_IMPLEMENTED: 501,
  HTTP_STATUS_BAD_GATEWAY: 502,
  HTTP_STATUS_SERVICE_UNAVAILABLE: 503,
  HTTP_STATUS_GATEWAY_TIMEOUT: 504,
  HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED: 505,
  HTTP_STATUS_VARIANT_ALSO_NEGOTIATES: 506,
  HTTP_STATUS_INSUFFICIENT_STORAGE: 507,
  HTTP_STATUS_LOOP_DETECTED: 508,
  HTTP_STATUS_BANDWIDTH_LIMIT_EXCEEDED: 509,
  HTTP_STATUS_NOT_EXTENDED: 510,
  HTTP_STATUS_NETWORK_AUTHENTICATION_REQUIRED: 511,
} as const;

// ---------------------------------------------------------------------------
// Settings — RFC 7540 Section 6.5
// ---------------------------------------------------------------------------

export interface Http2Settings {
  headerTableSize?: number;
  enablePush?: boolean;
  maxConcurrentStreams?: number;
  initialWindowSize?: number;
  maxFrameSize?: number;
  maxHeaderListSize?: number;
  enableConnectProtocol?: boolean;
}

/** Setting ID → key mapping for pack/unpack. */
const SETTINGS_MAP: [number, keyof Http2Settings, boolean][] = [
  [0x01, 'headerTableSize', false],
  [0x02, 'enablePush', true],
  [0x03, 'maxConcurrentStreams', false],
  [0x04, 'initialWindowSize', false],
  [0x05, 'maxFrameSize', false],
  [0x06, 'maxHeaderListSize', false],
  [0x08, 'enableConnectProtocol', true],
];

/** Returns the default HTTP/2 settings per RFC 7540. */
export function getDefaultSettings(): Http2Settings {
  return {
    headerTableSize: 4096,
    enablePush: true,
    maxConcurrentStreams: 0xffffffff,
    initialWindowSize: 65535,
    maxFrameSize: 16384,
    maxHeaderListSize: 65535,
    enableConnectProtocol: false,
  };
}

/**
 * Encode HTTP/2 settings into the binary format used in SETTINGS frames.
 * Each setting is encoded as 6 bytes: 2-byte ID (big-endian) + 4-byte value (big-endian).
 * RFC 7540 Section 6.5.1
 */
export function getPackedSettings(settings?: Http2Settings): Uint8Array {
  if (!settings) return new Uint8Array(0);

  const pairs: [number, number][] = [];
  for (const [id, key, isBool] of SETTINGS_MAP) {
    const val = settings[key];
    if (val !== undefined) {
      pairs.push([id, isBool ? (val ? 1 : 0) : val as number]);
    }
  }

  const buf = new Uint8Array(pairs.length * 6);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < pairs.length; i++) {
    const offset = i * 6;
    view.setUint16(offset, pairs[i][0], false);
    view.setUint32(offset + 2, pairs[i][1], false);
  }
  return buf;
}

/**
 * Decode a binary SETTINGS frame payload into an Http2Settings object.
 * RFC 7540 Section 6.5.1
 */
export function getUnpackedSettings(buf: Uint8Array | ArrayBuffer): Http2Settings {
  const data = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  if (data.byteLength % 6 !== 0) {
    throw new RangeError('Invalid packed settings length');
  }

  const result: Http2Settings = {};
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let i = 0; i < data.byteLength; i += 6) {
    const id = view.getUint16(i, false);
    const value = view.getUint32(i + 2, false);

    for (const [settingId, key, isBool] of SETTINGS_MAP) {
      if (id === settingId) {
        (result as Record<string, unknown>)[key] = isBool ? value !== 0 : value;
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Http2Session — base class for HTTP/2 sessions (stub with proper API shape)
// ---------------------------------------------------------------------------

/**
 * Http2Session represents an active HTTP/2 session.
 * Stub implementation — Soup 3.0 handles HTTP/2 transparently and does not
 * expose the session/stream multiplexing API needed for full implementation.
 */
export class Http2Session extends EventEmitter {
  readonly alpnProtocol: string | undefined = undefined;
  readonly encrypted: boolean = false;
  readonly type: number = constants.NGHTTP2_SESSION_CLIENT;

  private _closed = false;
  private _destroyed = false;
  private _settings: Http2Settings;

  constructor() {
    super();
    this._settings = getDefaultSettings();
  }

  get closed(): boolean { return this._closed; }
  get destroyed(): boolean { return this._destroyed; }
  get connecting(): boolean { return false; }
  get pendingSettingsAck(): boolean { return false; }

  get localSettings(): Http2Settings { return { ...this._settings }; }
  get remoteSettings(): Http2Settings { return getDefaultSettings(); }

  settings(settings: Http2Settings, callback?: () => void): void {
    Object.assign(this._settings, settings);
    if (callback) Promise.resolve().then(callback);
  }

  goaway(code?: number, _lastStreamId?: number, _data?: Uint8Array): void {
    this.emit('goaway', code ?? constants.NGHTTP2_NO_ERROR);
  }

  ping(payload?: Uint8Array, callback?: (err: Error | null, duration: number, payload: Uint8Array) => void): boolean {
    const buf = payload || new Uint8Array(8);
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
    this.emit('close');
    if (code !== undefined) {
      this.goaway(code);
    }
  }

  ref(): void {}
  unref(): void {}
}

/** Server-side HTTP/2 session. */
export class ServerHttp2Session extends Http2Session {
  readonly type = constants.NGHTTP2_SESSION_SERVER;

  altsvc(_alt: string, _originOrStream: string | number): void {}

  origin(..._origins: string[]): void {}
}

/** Client-side HTTP/2 session. */
export class ClientHttp2Session extends Http2Session {
  readonly type = constants.NGHTTP2_SESSION_CLIENT;

  request(_headers?: Record<string, string | string[]>, _options?: unknown): Http2Stream {
    throw new Error('http2 client requests are not yet implemented in GJS');
  }
}

// ---------------------------------------------------------------------------
// Http2Stream — base class for HTTP/2 streams (stub)
// ---------------------------------------------------------------------------

/** Represents a single HTTP/2 stream within a session. */
export class Http2Stream extends EventEmitter {
  readonly id: number = 0;
  readonly session: Http2Session | null = null;
  readonly sentHeaders: Record<string, string | string[]> = {};
  readonly sentInfoHeaders: Record<string, string | string[]>[] = [];

  private _closed = false;
  private _destroyed = false;
  private _state: number = constants.NGHTTP2_STREAM_STATE_IDLE;

  get closed(): boolean { return this._closed; }
  get destroyed(): boolean { return this._destroyed; }
  get pending(): boolean { return this.id === 0; }
  get state(): number { return this._state; }
  get endAfterHeaders(): boolean { return false; }
  get bufferSize(): number { return 0; }

  get rstCode(): number { return constants.NGHTTP2_NO_ERROR; }

  close(code?: number, callback?: () => void): void {
    if (this._closed) return;
    this._closed = true;
    this._state = constants.NGHTTP2_STREAM_STATE_CLOSED;
    this.emit('close', code ?? constants.NGHTTP2_NO_ERROR);
    if (callback) callback();
  }

  destroy(error?: Error): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._closed = true;
    this._state = constants.NGHTTP2_STREAM_STATE_CLOSED;
    if (error) this.emit('error', error);
    this.emit('close');
  }

  priority(_options: { exclusive?: boolean; parent?: number; weight?: number; silent?: boolean }): void {}

  setTimeout(msecs: number, callback?: () => void): void {
    if (callback) setTimeout(callback, msecs);
  }
}

/** Server-side HTTP/2 stream. */
export class ServerHttp2Stream extends Http2Stream {
  readonly headersSent: boolean = false;
  readonly pushAllowed: boolean = false;

  respond(_headers?: Record<string, string | string[] | number>, _options?: unknown): void {
    throw new Error('http2 server respond is not yet implemented in GJS');
  }

  respondWithFD(_fd: number | unknown, _headers?: Record<string, string | string[]>, _options?: unknown): void {
    throw new Error('http2 respondWithFD is not yet implemented in GJS');
  }

  respondWithFile(_path: string, _headers?: Record<string, string | string[]>, _options?: unknown): void {
    throw new Error('http2 respondWithFile is not yet implemented in GJS');
  }

  pushStream(
    _headers: Record<string, string | string[]>,
    _options: unknown,
    _callback: (err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void,
  ): void {
    throw new Error('http2 server push is not yet implemented in GJS');
  }

  additionalHeaders(_headers: Record<string, string | string[]>): void {}
}

/** Client-side HTTP/2 stream. */
export class ClientHttp2Stream extends Http2Stream {}

// ---------------------------------------------------------------------------
// Http2ServerRequest / Http2ServerResponse — compat layer stubs
// ---------------------------------------------------------------------------

/** HTTP/2 request object (compat layer, mirrors http.IncomingMessage). */
export class Http2ServerRequest extends EventEmitter {
  readonly headers: Record<string, string | string[] | undefined> = {};
  readonly httpVersion: string = '2.0';
  readonly method: string = 'GET';
  readonly url: string = '/';
  readonly stream: Http2Stream | null = null;
  readonly authority: string = '';
  readonly scheme: string = 'https';

  get complete(): boolean { return true; }

  setTimeout(msecs: number, callback?: () => void): this {
    if (callback) setTimeout(callback, msecs);
    return this;
  }
}

/** HTTP/2 response object (compat layer, mirrors http.ServerResponse). */
export class Http2ServerResponse extends EventEmitter {
  statusCode: number = 200;
  readonly stream: Http2Stream | null = null;
  readonly headersSent: boolean = false;

  private _headers: Record<string, string | string[] | number> = {};

  setHeader(name: string, value: string | string[] | number): this {
    this._headers[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name: string): string | string[] | number | undefined {
    return this._headers[name.toLowerCase()];
  }

  getHeaders(): Record<string, string | string[] | number> {
    return { ...this._headers };
  }

  removeHeader(name: string): void {
    delete this._headers[name.toLowerCase()];
  }

  hasHeader(name: string): boolean {
    return name.toLowerCase() in this._headers;
  }

  writeHead(statusCode: number, headers?: Record<string, string | string[] | number>): this {
    this.statusCode = statusCode;
    if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        this._headers[name.toLowerCase()] = value;
      }
    }
    return this;
  }

  end(_data?: string | Uint8Array, _encoding?: string, _callback?: () => void): this {
    this.emit('finish');
    return this;
  }

  write(_chunk: string | Uint8Array, _encoding?: string, _callback?: () => void): boolean {
    return true;
  }

  createPushResponse(_headers: Record<string, string | string[]>, _callback: (err: Error | null, res: Http2ServerResponse) => void): void {
    throw new Error('http2 server push is not yet implemented in GJS');
  }

  setTimeout(msecs: number, callback?: () => void): this {
    if (callback) setTimeout(callback, msecs);
    return this;
  }
}

// ---------------------------------------------------------------------------
// Factory functions — stubs with clear error messages
// ---------------------------------------------------------------------------

/**
 * Create an HTTP/2 server (cleartext, h2c).
 * Not yet implemented — Soup 3.0 handles HTTP/2 transparently but does not
 * expose the multiplexed stream API required by Node.js http2.createServer().
 */
export function createServer(
  _options?: Record<string, unknown>,
  _onRequestHandler?: (request: Http2ServerRequest, response: Http2ServerResponse) => void,
): unknown {
  throw new Error(
    'http2.createServer() is not yet implemented in GJS. ' +
    'Soup 3.0 handles HTTP/2 transparently but does not expose multiplexed streams. ' +
    'Use http.createServer() for HTTP/1.1 or consider a future nghttp2-based implementation.'
  );
}

/**
 * Create an HTTPS + HTTP/2 server (h2 over TLS).
 * Not yet implemented — requires TLS + HTTP/2 multiplexing support.
 */
export function createSecureServer(
  _options?: Record<string, unknown>,
  _onRequestHandler?: (request: Http2ServerRequest, response: Http2ServerResponse) => void,
): unknown {
  throw new Error(
    'http2.createSecureServer() is not yet implemented in GJS. ' +
    'Requires TLS server support combined with HTTP/2 multiplexing.'
  );
}

/**
 * Connect to an HTTP/2 server.
 * Not yet implemented — would need HTTP/2 frame parsing over a raw TLS connection.
 */
export function connect(
  _authority: string | URL,
  _options?: Record<string, unknown>,
  _listener?: (session: ClientHttp2Session) => void,
): ClientHttp2Session {
  throw new Error(
    'http2.connect() is not yet implemented in GJS. ' +
    'Soup 3.0 can negotiate HTTP/2 transparently via Soup.Session, ' +
    'but does not expose the session/stream API needed for http2.connect().'
  );
}

// ---------------------------------------------------------------------------
// Misc exports
// ---------------------------------------------------------------------------

/** Symbol for marking headers as sensitive (not to be compressed). */
export const sensitiveHeaders = Symbol('http2.sensitiveHeaders');

/**
 * Perform an HTTP/2 server handshake on an existing socket.
 * Not yet implemented.
 */
export function performServerHandshake(_socket: unknown): unknown {
  throw new Error('http2.performServerHandshake() is not yet implemented in GJS');
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default {
  constants,
  createServer,
  createSecureServer,
  connect,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
  performServerHandshake,
  Http2Session,
  Http2Stream,
  ServerHttp2Session,
  ClientHttp2Session,
  ServerHttp2Stream,
  ClientHttp2Stream,
  Http2ServerRequest,
  Http2ServerResponse,
};
