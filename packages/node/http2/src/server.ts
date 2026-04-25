// Reference: Node.js lib/internal/http2/compat.js, lib/_http_server.js
// Reimplemented for GJS using Soup.Server (HTTP/2 transparently via ALPN when TLS is used)
//
// Phase 1 limitations:
//   - createServer() serves HTTP/1.1 only (Soup does not support h2c/cleartext HTTP/2)
//   - createSecureServer() negotiates h2 via ALPN automatically when TLS cert is set
//   - pushStream(), respondWithFD(), respondWithFile() are stubs (Phase 2)
//   - stream IDs are always 1 (Soup internal)

import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { deferEmit, ensureMainLoop } from '@gjsify/utils';
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

export class Http2ServerResponse extends Writable {
  statusCode = 200;
  statusMessage = '';
  headersSent = false;
  finished = false;
  sendDate = true;

  private _soupMsg: Soup.ServerMessage;
  private _headers: Map<string, string | string[]> = new Map();
  private _streaming = false;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _stream: ServerHttp2Stream | null = null;

  get stream(): ServerHttp2Stream | null { return this._stream; }
  get socket(): null { return null; }

  // Called by Http2Server after stream is created
  _setStream(stream: ServerHttp2Stream): void {
    this._stream = stream;
  }

  constructor(soupMsg: Soup.ServerMessage) {
    super();
    this._soupMsg = soupMsg;
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
    const responseBody = this._soupMsg.get_response_body();
    responseBody.append(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    this._soupMsg.unpause();
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    if (this._streaming) {
      const responseBody = this._soupMsg.get_response_body();
      responseBody.complete();
      this._soupMsg.unpause();
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

  // respondWithFD and respondWithFile stubs (Phase 2)
  respondWithFD(_fd: any, _headers?: any, _options?: any): void {
    throw new Error('http2 respondWithFD is not yet implemented in GJS (Phase 2)');
  }

  respondWithFile(_path: string, _headers?: any, _options?: any): void {
    throw new Error('http2 respondWithFile is not yet implemented in GJS (Phase 2)');
  }

  pushStream(
    _headers: Record<string, string | string[]>,
    _options: any,
    _callback: (err: Error | null, pushStream: any, headers: Record<string, string | string[]>) => void,
  ): void {
    throw new Error('http2 server push is not yet implemented in GJS (Phase 2)');
  }

  createPushResponse(
    _headers: Record<string, string | string[]>,
    _callback: (err: Error | null, res: Http2ServerResponse) => void,
  ): void {
    throw new Error('http2 server push is not yet implemented in GJS (Phase 2)');
  }
}

// ─── ServerHttp2Stream ────────────────────────────────────────────────────────
// Facade over Http2ServerResponse exposing the session/stream API.
// Delegates all writes to the underlying response object.

export class ServerHttp2Stream extends EventEmitter {
  readonly id = 1;
  readonly pushAllowed = false;
  readonly sentHeaders: Record<string, string | string[]> = {};

  private _res: Http2ServerResponse;
  private _session: ServerHttp2Session | null;

  get session(): ServerHttp2Session | null { return this._session; }
  get headersSent(): boolean { return this._res.headersSent; }
  get closed(): boolean { return this._res.writableEnded; }
  get destroyed(): boolean { return this._res.destroyed; }
  get pending(): boolean { return false; }
  get state(): number {
    return this.closed ? constants.NGHTTP2_STREAM_STATE_CLOSED : constants.NGHTTP2_STREAM_STATE_OPEN;
  }

  constructor(res: Http2ServerResponse, session: ServerHttp2Session | null = null) {
    super();
    this._res = res;
    this._session = session;

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

  respondWithFD(_fd: any, _headers?: any, _options?: any): void {
    throw new Error('http2 respondWithFD is not yet implemented in GJS (Phase 2)');
  }

  respondWithFile(_path: string, _headers?: any, _options?: any): void {
    throw new Error('http2 respondWithFile is not yet implemented in GJS (Phase 2)');
  }

  pushStream(
    _headers: Record<string, string | string[]>,
    _options: any,
    _callback: (err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void,
  ): void {
    throw new Error('http2 server push is not yet implemented in GJS (Phase 2)');
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

  constructor() {
    super();
    this._settings = getDefaultSettings();
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
}

export class Http2Server extends EventEmitter {
  listening = false;
  maxHeadersCount = 2000;
  timeout = 0;

  protected _soupServer: Soup.Server | null = null;
  protected _address: { port: number; family: string; address: string } | null = null;
  private _options: ServerOptions;

  get soupServer(): Soup.Server | null { return this._soupServer; }

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
