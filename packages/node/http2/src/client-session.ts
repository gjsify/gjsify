// Reference: Node.js lib/internal/http2/core.js
// Reimplemented for GJS using Soup.Session (HTTP/2 transparently via ALPN over HTTPS)
//
// Phase 1 limitations:
//   - connect() over HTTP (non-TLS) uses HTTP/1.1 only (Soup does not support h2c)
//   - connect() over HTTPS upgrades to HTTP/2 automatically via ALPN if the server supports it
//   - pushStream, stream IDs, flow control are Soup-internal — not exposed
//   - rejectUnauthorized: false is best-effort (requires system-level TLS trust or custom DB)

import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { Buffer } from 'node:buffer';
import { readBytesAsync } from '@gjsify/utils';
import { constants, getDefaultSettings, type Http2Settings } from './protocol.js';

export type { Http2Settings };

export interface ClientSessionOptions {
  maxDeflateDynamicTableSize?: number;
  maxSessionMemory?: number;
  maxHeaderListPairs?: number;
  maxOutstandingPings?: number;
  maxReservedRemoteStreams?: number;
  maxSendHeaderBlockLength?: number;
  paddingStrategy?: number;
  peerMaxHeaderListSize?: number;
  protocol?: string;
  settings?: Http2Settings;
  // TLS options
  rejectUnauthorized?: boolean;
  ca?: string | Buffer | Array<string | Buffer>;
  cert?: string | Buffer | Array<string | Buffer>;
  key?: string | Buffer | Array<string | Buffer>;
  ALPNProtocols?: string[];
  /**
   * Native dispatcher mode (gjsify-specific, defaults to `'auto'`).
   *
   * - `'auto'` — use the @gjsify/http2-native client for `http://` (h2c)
   *   URLs when the prebuild is loadable; route `https://` through Soup
   *   (h2 negotiated transparently via ALPN — works fine, no need for
   *   the native path).
   * - `'force'` — always use the native client; throws if unavailable.
   *   Surfaces server-pushed streams ('stream' event on the session) that
   *   Soup's high-level Session API doesn't expose.
   * - `'off'` — never use the native client; keep Soup even for h2c.
   *   Result: h2c requests fail at the protocol level.
   */
  nativeDispatcher?: 'auto' | 'force' | 'off';
}

export interface ClientStreamOptions {
  endStream?: boolean;
  exclusive?: boolean;
  parent?: number;
  weight?: number;
  waitForTrailers?: boolean;
  signal?: AbortSignal;
}

// ─── Http2Session (base) ──────────────────────────────────────────────────────

export class Http2Session extends EventEmitter {
  readonly type: number = constants.NGHTTP2_SESSION_CLIENT;
  readonly alpnProtocol: string | undefined = undefined;
  readonly encrypted: boolean = false;

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
  get originSet(): Set<string> { return new Set(); }

  settings(settings: Http2Settings, callback?: () => void): void {
    Object.assign(this._settings, settings);
    if (callback) Promise.resolve().then(callback);
  }

  goaway(code?: number, _lastStreamId?: number, _data?: Uint8Array): void {
    this.emit('goaway', code ?? constants.NGHTTP2_NO_ERROR);
    this.destroy();
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
    if (code !== undefined) this.emit('goaway', code);
    this.emit('close');
  }

  ref(): void {}
  unref(): void {}
}

// ─── ClientHttp2Stream ────────────────────────────────────────────────────────
// Duplex: writable = request body (buffered until end()), readable = response body.
// The Soup request is dispatched when end() is called.

export class ClientHttp2Stream extends Duplex {
  private _id: number = 1;
  readonly pending = false;
  readonly aborted = false;
  readonly bufferSize = 0;
  readonly endAfterHeaders = false;

  private _session: ClientHttp2Session;
  private _requestHeaders: Record<string, string | string[]>;
  private _requestChunks: Buffer[] = [];
  private _cancellable: Gio.Cancellable;
  private _state: number = constants.NGHTTP2_STREAM_STATE_OPEN;
  private _responseHeaders: Record<string, string | string[]> = {};
  /** Native dispatcher stream id when the request rides the native path. */
  private _nativeStreamId: number = 0;

  /** Returns the client-allocated stream id. Native path: real nghttp2 id;
   * Soup path: hard-coded 1 (Soup multiplexes opaquely). */
  get id(): number { return this._id; }
  get state(): number { return this._state; }
  get rstCode(): number { return constants.NGHTTP2_NO_ERROR; }
  get session(): ClientHttp2Session { return this._session; }
  get sentHeaders(): Record<string, string | string[]> { return this._requestHeaders; }

  /** @internal Hook used by the native client dispatcher to bind a stream to
   *  a server-pushed promised id (pushed streams arrive with their id
   *  already allocated by the peer; we don't submit_request for them). */
  _setNativeStreamId(streamId: number): void {
    this._id = streamId;
    this._nativeStreamId = streamId;
    this._wireNativeBody();
  }

  constructor(session: ClientHttp2Session, requestHeaders: Record<string, string | string[]>) {
    super();
    this._session = session;
    this._requestHeaders = requestHeaders;
    this._cancellable = new Gio.Cancellable();
  }

  _read(_size: number): void {}

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
    if (this._nativeStreamId > 0) {
      this._session._getNativeClient()!.writeData(this._nativeStreamId, buf, false);
    } else {
      this._requestChunks.push(buf);
    }
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    const nativeClient = this._session._getNativeClient();
    if (nativeClient) {
      try {
        if (this._nativeStreamId > 0) {
          // Request body already streamed via _write; close the stream half.
          nativeClient.writeData(this._nativeStreamId, Buffer.alloc(0), true);
        } else {
          // Submit the request with the buffered body (or end-stream if no body).
          const body = Buffer.concat(this._requestChunks);
          const endStream = body.length === 0;
          const streamId = nativeClient.submitRequest(this._requestHeaders, endStream);
          if (streamId === 0) {
            callback(new Error('Failed to submit HTTP/2 request stream'));
            return;
          }
          this._id = streamId;
          this._nativeStreamId = streamId;
          if (body.length > 0) {
            nativeClient.writeData(streamId, body, true);
          }
          this._wireNativeBody();
        }
        callback();
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }
    this._sendRequest()
      .then(() => callback())
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
  }

  /** Wire response headers + body iteration when running on the native path. */
  private _wireNativeBody(): void {
    const nativeClient = this._session._getNativeClient();
    if (!nativeClient || this._nativeStreamId === 0) return;
    const streamId = this._nativeStreamId;
    (async () => {
      try {
        // Wait for headers up to 30 s.
        const deadline = Date.now() + 30_000;
        let headers: Record<string, string | string[]> | null = null;
        while (Date.now() < deadline) {
          headers = nativeClient.responseHeaders(streamId);
          if (headers) break;
          await new Promise<void>((r) => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { r(); return false; }));
        }
        if (!headers) {
          this.destroy(new Error('Native HTTP/2 client: response headers timeout'));
          return;
        }
        this._responseHeaders = headers;
        this._state = constants.NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL;
        this.emit('response', headers, 0);

        for await (const chunk of nativeClient.body(streamId)) {
          if (chunk.length > 0) this.push(chunk);
        }
        this.push(null);
        this._state = constants.NGHTTP2_STREAM_STATE_CLOSED;
      } catch (err) {
        this._state = constants.NGHTTP2_STREAM_STATE_CLOSED;
        this.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  }

  private async _sendRequest(): Promise<void> {
    const session = this._session._getSoupSession();
    const authority = this._session._getAuthority();

    const method = (this._requestHeaders[':method'] as string) || 'GET';
    const path = (this._requestHeaders[':path'] as string) || '/';
    const scheme = (this._requestHeaders[':scheme'] as string) || (authority.startsWith('https') ? 'https' : 'http');
    const host = (this._requestHeaders[':authority'] as string) || authority.replace(/^https?:\/\//, '');

    const url = `${scheme}://${host}${path}`;
    let uri: GLib.Uri;
    try {
      uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
    } catch (err) {
      throw new Error(`Invalid HTTP/2 request URL: ${url}`);
    }

    const message = new Soup.Message({ method, uri });

    // Apply request headers (skip HTTP/2 pseudo-headers)
    const reqHeaders = message.get_request_headers();
    for (const [key, value] of Object.entries(this._requestHeaders)) {
      if (key.startsWith(':')) continue;
      if (Array.isArray(value)) {
        for (const v of value) reqHeaders.append(key, v);
      } else {
        reqHeaders.replace(key, value as string);
      }
    }

    // Set request body if any
    const body = Buffer.concat(this._requestChunks);
    if (body.length > 0) {
      const contentType = (this._requestHeaders['content-type'] as string) || 'application/octet-stream';
      message.set_request_body_from_bytes(contentType, new GLib.Bytes(body));
    }

    try {
      const inputStream = await new Promise<Gio.InputStream>((resolve, reject) => {
        session.send_async(message, GLib.PRIORITY_DEFAULT, this._cancellable, (_self: any, asyncRes: Gio.AsyncResult) => {
          try {
            resolve(session.send_finish(asyncRes));
          } catch (error) {
            reject(error);
          }
        });
      });

      // Collect response headers
      const statusCode = message.status_code;
      const responseHeaders = message.get_response_headers();
      const headersObj: Record<string, string | string[]> = { ':status': String(statusCode) };
      responseHeaders.foreach((name: string, value: string) => {
        const lower = name.toLowerCase();
        if (lower in headersObj) {
          const existing = headersObj[lower];
          if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            headersObj[lower] = [existing as string, value];
          }
        } else {
          headersObj[lower] = value;
        }
      });
      this._responseHeaders = headersObj;
      this._state = constants.NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL;

      // Emit 'response' before pushing body data so listeners can attach
      this.emit('response', headersObj, 0);

      // Stream response body
      try {
        let chunk: Uint8Array | null;
        while ((chunk = await readBytesAsync(inputStream, 16384, GLib.PRIORITY_DEFAULT, this._cancellable)) !== null) {
          if (chunk.length > 0) {
            this.push(Buffer.from(chunk));
          }
        }
      } catch (_readErr) {
        // Connection reset — push what we have
      }

      this.push(null);
      this._state = constants.NGHTTP2_STREAM_STATE_CLOSED;
    } catch (error: any) {
      this._state = constants.NGHTTP2_STREAM_STATE_CLOSED;
      if (!this._cancellable.is_cancelled()) {
        this.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  close(code?: number, callback?: () => void): void {
    this._cancellable.cancel();
    this._state = constants.NGHTTP2_STREAM_STATE_CLOSED;
    this.emit('close', code ?? constants.NGHTTP2_NO_ERROR);
    if (callback) callback();
  }

  priority(_options: { exclusive?: boolean; parent?: number; weight?: number; silent?: boolean }): void {}
  sendTrailers(_headers: Record<string, string | string[]>): void {}
  setTimeout(_msecs: number, _callback?: () => void): this { return this; }
}

// ─── ClientHttp2Session ───────────────────────────────────────────────────────

export class ClientHttp2Session extends Http2Session {
  override readonly type = constants.NGHTTP2_SESSION_CLIENT;
  declare readonly encrypted: boolean;

  private _authority: string;
  private _soupSession: Soup.Session;
  private _streams: Set<ClientHttp2Stream> = new Set();
  private _nativeClient: import('./native-client-dispatcher.js').Http2NativeClientDispatcher | null = null;

  get nativeClient(): import('./native-client-dispatcher.js').Http2NativeClientDispatcher | null {
    return this._nativeClient;
  }

  constructor(authority: string, options: ClientSessionOptions = {}) {
    super();
    this._authority = authority;
    this.encrypted = authority.startsWith('https:');

    this._soupSession = new Soup.Session();

    // Configure TLS for rejectUnauthorized: false (common in testing with self-signed certs)
    if (options.rejectUnauthorized === false) {
      // Connect to the accept-certificate signal on each message via session
      // This is a best-effort approach; system CA store may still reject the cert
      (this._soupSession as any).connect('accept-certificate',
        (_msg: any, _cert: any, _errors: any) => {
          return true;
        }
      );
    }

    // Native dispatcher: opt-in via `nativeDispatcher: 'force'`. The default
    // ('auto') keeps the Soup path verbatim so existing consumers — which
    // expect Soup-managed HTTP/1.1 for http:// and Soup-managed h2 (via ALPN)
    // for https:// — are unaffected by Phase 3. Setting `'force'` switches
    // to the native client + surfaces server-pushed streams as 'stream'
    // events that Soup's high-level Session API doesn't expose.
    const mode = options.nativeDispatcher ?? 'auto';
    if (mode === 'force') {
      this._setupNativeClient(authority, mode);
    }

    // Emit 'connect' asynchronously after construction
    Promise.resolve().then(() => {
      if (!this.destroyed) {
        (this as any).alpnProtocol = this.encrypted ? 'h2' : (this._nativeClient ? 'h2c' : undefined);
        this.emit('connect', this, null);
      }
    });
  }

  private _setupNativeClient(authority: string, mode: 'auto' | 'force' | 'off'): void {
    // Lazy load to keep the module out of the Node bundle when only Soup is
    // used. Pulling node:http2 directly never instantiates the dispatcher.
    const { Http2NativeClientDispatcher } = require('./native-client-dispatcher.js') as typeof import('./native-client-dispatcher.js');
    if (!Http2NativeClientDispatcher.available()) {
      if (mode === 'force') {
        throw new Error('@gjsify/http2-native prebuild not loadable — nativeDispatcher: "force" cannot proceed');
      }
      return; // fall back to Soup path
    }
    // Parse host:port from the authority URL.
    const stripped = authority.replace(/^https?:\/\//, '');
    const [host, portStr] = stripped.split(':');
    const port = parseInt(portStr || (this.encrypted ? '443' : '80'), 10);
    this._nativeClient = new Http2NativeClientDispatcher({
      onPushPromise: (event) => {
        // Surface as 'stream' event on the session — matches Node's
        // `ClientHttp2Session` 'stream' event for incoming pushes.
        const pushedStream = new ClientHttp2Stream(this, event.headers);
        (pushedStream as unknown as { _setNativeStreamId(id: number): void })._setNativeStreamId(event.promisedStreamId);
        this._streams.add(pushedStream);
        this.emit('stream', pushedStream, event.headers, 0);
      },
      onGoaway: (lastStreamId, errorCode) => {
        this.emit('goaway', errorCode, lastStreamId);
      },
      onClose: () => {
        // Allow consumers to react.
      },
    });
    try {
      this._nativeClient.connect(host || 'localhost', port);
    } catch (err) {
      this._nativeClient = null;
      if (mode === 'force') throw err;
    }
  }

  /** @internal Used by ClientHttp2Stream to get the Soup.Session */
  _getSoupSession(): Soup.Session {
    return this._soupSession;
  }

  /** @internal Used by ClientHttp2Stream to access the native client dispatcher. */
  _getNativeClient(): import('./native-client-dispatcher.js').Http2NativeClientDispatcher | null {
    return this._nativeClient;
  }

  /** @internal Used by ClientHttp2Stream to build the request URL */
  _getAuthority(): string {
    return this._authority;
  }

  request(headers: Record<string, string | string[]>, options?: ClientStreamOptions): ClientHttp2Stream {
    if (this.destroyed || this.closed) {
      throw new Error('Session is closed');
    }

    // Fill in missing pseudo-headers from the authority. RFC 7540 §8.1.2.1:
    // pseudo-headers MUST appear before any regular header in the encoded
    // block — nghttp2 rejects mis-ordered requests with PROTOCOL_ERROR.
    // We rebuild the headers object with pseudo-headers first, regular
    // headers second; insertion order is the wire order.
    const pseudo: Record<string, string | string[]> = {};
    const regular: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (k.startsWith(':')) pseudo[k] = v;
      else regular[k] = v;
    }
    if (!pseudo[':method']) pseudo[':method'] = 'GET';
    if (!pseudo[':scheme']) pseudo[':scheme'] = this.encrypted ? 'https' : 'http';
    if (!pseudo[':authority']) pseudo[':authority'] = this._authority.replace(/^https?:\/\//, '');
    if (!pseudo[':path']) pseudo[':path'] = '/';
    const finalHeaders: Record<string, string | string[]> = { ...pseudo, ...regular };

    const stream = new ClientHttp2Stream(this, finalHeaders);
    this._streams.add(stream);
    stream.once('close', () => this._streams.delete(stream));

    if (options?.endStream) {
      // No request body — end immediately to trigger the request
      stream.end();
    }

    return stream;
  }

  override close(callback?: () => void): void {
    for (const stream of this._streams) {
      stream.close();
    }
    this._streams.clear();
    super.close(callback);
  }

  override destroy(error?: Error, code?: number): void {
    for (const stream of this._streams) {
      stream.close();
    }
    this._streams.clear();
    super.destroy(error, code);
  }
}
