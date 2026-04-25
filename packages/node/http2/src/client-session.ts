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
  readonly id = 1;
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

  get state(): number { return this._state; }
  get rstCode(): number { return constants.NGHTTP2_NO_ERROR; }
  get session(): ClientHttp2Session { return this._session; }
  get sentHeaders(): Record<string, string | string[]> { return this._requestHeaders; }

  constructor(session: ClientHttp2Session, requestHeaders: Record<string, string | string[]>) {
    super();
    this._session = session;
    this._requestHeaders = requestHeaders;
    this._cancellable = new Gio.Cancellable();
  }

  _read(_size: number): void {}

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
    this._requestChunks.push(buf);
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    this._sendRequest()
      .then(() => callback())
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
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

    // Emit 'connect' asynchronously after construction
    Promise.resolve().then(() => {
      if (!this.destroyed) {
        (this as any).alpnProtocol = this.encrypted ? 'h2' : undefined;
        this.emit('connect', this, null);
      }
    });
  }

  /** @internal Used by ClientHttp2Stream to get the Soup.Session */
  _getSoupSession(): Soup.Session {
    return this._soupSession;
  }

  /** @internal Used by ClientHttp2Stream to build the request URL */
  _getAuthority(): string {
    return this._authority;
  }

  request(headers: Record<string, string | string[]>, options?: ClientStreamOptions): ClientHttp2Stream {
    if (this.destroyed || this.closed) {
      throw new Error('Session is closed');
    }

    // Fill in missing pseudo-headers from the authority
    const finalHeaders = { ...headers };
    if (!finalHeaders[':scheme']) {
      finalHeaders[':scheme'] = this.encrypted ? 'https' : 'http';
    }
    if (!finalHeaders[':authority']) {
      finalHeaders[':authority'] = this._authority.replace(/^https?:\/\//, '');
    }
    if (!finalHeaders[':method']) {
      finalHeaders[':method'] = 'GET';
    }
    if (!finalHeaders[':path']) {
      finalHeaders[':path'] = '/';
    }

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
