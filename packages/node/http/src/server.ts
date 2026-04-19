// Reference: Node.js lib/_http_server.js
// Reimplemented for GJS using Soup.Server

import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { Socket as NetSocket } from '@gjsify/net/socket';
import { deferEmit, ensureMainLoop } from '@gjsify/utils';
import { STATUS_CODES } from './constants.js';
import { IncomingMessage } from './incoming-message.js';

/**
 * OutgoingMessage — Base class for ServerResponse and ClientRequest.
 * Reference: Node.js lib/_http_outgoing.js
 */
export class OutgoingMessage extends Writable {
  headersSent = false;
  sendDate = true;
  finished = false;
  socket: import('net').Socket | null = null;

  protected _headers: Map<string, string | string[]> = new Map();

  /** Set a header. */
  setHeader(name: string, value: string | number | string[]): this {
    this._headers.set(name.toLowerCase(), typeof value === 'number' ? String(value) : value);
    return this;
  }

  /** Get a header. */
  getHeader(name: string): string | string[] | undefined {
    return this._headers.get(name.toLowerCase());
  }

  /** Remove a header. */
  removeHeader(name: string): void {
    this._headers.delete(name.toLowerCase());
  }

  /** Check if a header has been set. */
  hasHeader(name: string): boolean {
    return this._headers.has(name.toLowerCase());
  }

  /** Get all header names. */
  getHeaderNames(): string[] {
    return Array.from(this._headers.keys());
  }

  /** Get all headers as an object. */
  getHeaders(): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [key, value] of this._headers) {
      result[key] = value;
    }
    return result;
  }

  /** Append a header value instead of replacing. */
  appendHeader(name: string, value: string | string[]): this {
    const lower = name.toLowerCase();
    const existing = this._headers.get(lower);
    if (existing === undefined) {
      this._headers.set(lower, value);
    } else if (Array.isArray(existing)) {
      if (Array.isArray(value)) {
        existing.push(...value);
      } else {
        existing.push(value);
      }
    } else {
      if (Array.isArray(value)) {
        this._headers.set(lower, [existing as string, ...value]);
      } else {
        this._headers.set(lower, [existing as string, value]);
      }
    }
    return this;
  }

  /** Flush headers (no-op in base class). */
  flushHeaders(): void {
    this.headersSent = true;
  }

  _write(_chunk: any, _encoding: string, callback: (error?: Error | null) => void): void {
    callback();
  }
}

/**
 * ServerResponse — Writable stream representing an HTTP response.
 * Extends OutgoingMessage for shared header management.
 */
export class ServerResponse extends OutgoingMessage {
  statusCode = 200;
  statusMessage = '';

  private _streaming = false;
  private _soupMsg: Soup.ServerMessage;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(soupMsg: Soup.ServerMessage) {
    super();
    this._soupMsg = soupMsg;
  }

  /** Set a timeout for the response. Emits 'timeout' if response not sent within msecs. */
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

  /** Write the status line and headers. */
  writeHead(statusCode: number, statusMessage?: string | Record<string, string | string[]>, headers?: Record<string, string | string[]>): this {
    this.statusCode = statusCode;

    if (typeof statusMessage === 'object') {
      headers = statusMessage;
      statusMessage = undefined;
    }

    this.statusMessage = (statusMessage as string) || STATUS_CODES[statusCode] || '';

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        this.setHeader(key, value);
      }
    }

    return this;
  }

  /** Send a 100 Continue response. */
  writeContinue(callback?: () => void): void {
    // Soup.Server handles 100-Continue automatically, but we track the call
    if (callback) Promise.resolve().then(callback);
  }

  /** Send a 102 Processing response (WebDAV). */
  writeProcessing(callback?: () => void): void {
    if (callback) Promise.resolve().then(callback);
  }

  /** Flush headers (send them immediately). */
  flushHeaders(): void {
    // In our Soup-based implementation, headers are sent with the body.
    // This is a no-op but marks headersSent for compatibility.
    if (!this.headersSent) {
      this.headersSent = true;
    }
  }

  /** Add trailing headers for chunked transfer encoding. */
  addTrailers(headers: Record<string, string>): void {
    // Soup.Server doesn't support HTTP trailers natively.
    // Store for compatibility but they won't be sent.
    for (const [key, value] of Object.entries(headers)) {
      // Trailers are appended after the body in chunked encoding
      this._headers.set('trailer-' + key.toLowerCase(), value);
    }
  }

  /**
   * Send status + headers to the client via Soup and switch to streaming (chunked) mode.
   * Called on the first write() — subsequent writes append chunks and unpause.
   */
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

    // Choose response transfer encoding:
    //   - CONTENT_LENGTH when the caller set a Content-Length (range / streaming
    //     a known-size file, including 206 Partial Content). souphttpsrc and
    //     other fixed-length-sensitive clients require this.
    //   - CHUNKED when the length is unknown (e.g. dynamic responses from
    //     Express-style apps).
    // Forcing CHUNKED unconditionally broke GStreamer playback from the
    // WebTorrent HTTP server, which relies on Content-Range + Content-Length
    // for seekable streams.
    if (this._headers.has('content-length')) {
      responseHeaders.set_encoding(Soup.Encoding.CONTENT_LENGTH);
    } else {
      responseHeaders.set_encoding(Soup.Encoding.CHUNKED);
    }

    if (!this._headers.has('connection')) {
      responseHeaders.replace('Connection', 'close');
    }

    for (const [key, value] of this._headers) {
      if (Array.isArray(value)) {
        for (const v of value) {
          responseHeaders.append(key, v);
        }
      } else {
        responseHeaders.replace(key, value as string);
      }
    }
  }

  /** Writable stream _write — sends headers on first call, then appends + flushes each chunk. */
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
    this._startStreaming();
    const responseBody = this._soupMsg.get_response_body();
    responseBody.append(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    this._soupMsg.unpause();
    callback();
  }

  /** Called by Writable.end() — completes the body (streaming) or sends batch response (no-body). */
  _final(callback: (error?: Error | null) => void): void {
    if (this._streaming) {
      // Streaming mode — signal no more chunks
      const responseBody = this._soupMsg.get_response_body();
      responseBody.complete();
      this._soupMsg.unpause();
    } else {
      // Batch mode — no write() was called (e.g. redirects, 204, empty end())
      this._sendBatchResponse();
    }
    this.finished = true;
    callback();
  }

  /** Batch response — sends status + headers + empty/no body in one shot (for responses without write()). */
  private _sendBatchResponse(): void {
    if (this.headersSent) return;
    this.headersSent = true;

    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }

    this._soupMsg.set_status(this.statusCode, this.statusMessage || null);

    const responseHeaders = this._soupMsg.get_response_headers();

    if (!this._headers.has('connection')) {
      responseHeaders.replace('Connection', 'close');
    }

    for (const [key, value] of this._headers) {
      if (Array.isArray(value)) {
        for (const v of value) {
          responseHeaders.append(key, v);
        }
      } else {
        responseHeaders.replace(key, value as string);
      }
    }

    // Empty body — use set_response so Soup knows the response is complete.
    const contentType = (this._headers.get('content-type') as string) || 'text/plain';
    this._soupMsg.set_response(contentType, Soup.MemoryUse.COPY, new Uint8Array(0));
  }

  /** Write status + headers + body in one call (convenience). */
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
}

// GC guard — GJS garbage-collects objects with no JS references. When frameworks
// like Koa/Express create an http.Server inside .listen() and the caller discards
// the return value, the Server (and its Soup.Server) gets collected after ~10s.
// This Set keeps a strong reference to every listening server.
const _activeServers = new Set<Server>();

/**
 * HTTP Server wrapping Soup.Server.
 */
export class Server extends EventEmitter {
  listening = false;
  maxHeadersCount = 2000;
  timeout = 0;
  keepAliveTimeout = 5000;
  headersTimeout = 60000;
  requestTimeout = 300000;

  private _soupServer: Soup.Server | null = null;
  private _address: { port: number; family: string; address: string } | null = null;

  constructor(requestListener?: ((req: IncomingMessage, res: ServerResponse) => void) | Record<string, unknown>);
  constructor(options: Record<string, unknown>, requestListener?: (req: IncomingMessage, res: ServerResponse) => void);
  constructor(
    optionsOrListener?: ((req: IncomingMessage, res: ServerResponse) => void) | Record<string, unknown>,
    requestListener?: (req: IncomingMessage, res: ServerResponse) => void,
  ) {
    super();
    // Support Node.js signature: new Server(options, listener)
    const listener = typeof optionsOrListener === 'function' ? optionsOrListener : requestListener;
    if (listener) {
      this.on('request', listener);
    }
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

      // Add a catch-all handler
      this._soupServer.add_handler(null, (server: Soup.Server, msg: Soup.ServerMessage, path: string) => {
        this._handleRequest(msg, path);
      });

      this._soupServer.listen_local(port, Soup.ServerListenOptions.IPV4_ONLY);
      ensureMainLoop();

      // Get the actual port from listeners
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
      if (this.listenerCount('error') === 0) {
        // No error listener — throw like Node.js does for unhandled EventEmitter errors
        throw error;
      }
      deferEmit(this, 'error', error);
    }

    return this;
  }

  private _handleRequest(soupMsg: Soup.ServerMessage, path: string): void {
    const req = new IncomingMessage();
    const res = new ServerResponse(soupMsg);

    // Populate request properties
    req.method = soupMsg.get_method();
    req.url = soupMsg.get_uri().get_path();
    const query = soupMsg.get_uri().get_query();
    if (query) req.url += '?' + query;
    req.httpVersion = '1.1';

    // Parse headers
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

    // Check for HTTP upgrade request (WebSocket, etc.)
    // Reference: Node.js lib/_http_server.js — emits 'upgrade' with (req, socket, head)
    const connectionHeader = (req.headers['connection'] as string || '').toLowerCase();
    const upgradeHeader = (req.headers['upgrade'] as string || '').toLowerCase();
    if (connectionHeader.includes('upgrade') && upgradeHeader && this.listenerCount('upgrade') > 0) {
      // Steal the raw TCP connection from Soup before it sends a response.
      // This gives us a Gio.IOStream positioned after the parsed HTTP request.
      let ioStream: Gio.IOStream | null = null;
      try {
        ioStream = soupMsg.steal_connection();
      } catch (err) {
        // steal_connection() may fail if Soup has already started processing
        // the response or if the connection is in an unexpected state.
        // Surface as 'clientError' (matches Node.js) so apps can log/react.
        this.emit('clientError', err instanceof Error ? err : new Error(String(err)));
      }
      if (ioStream) {
        const socket = new NetSocket();
        socket._setupFromIOStream(ioStream);
        // head: any data after HTTP headers — empty for upgrade requests
        this.emit('upgrade', req, socket, Buffer.alloc(0));
        return;
      }
    }

    // Get request body
    const body = soupMsg.get_request_body();
    if (body && body.data && body.data.length > 0) {
      req._pushBody(body.data);
    } else {
      req._pushBody(null);
    }

    // Pause Soup's processing — we'll set the response when ServerResponse.end() is called
    soupMsg.pause();

    res.on('finish', () => {
      soupMsg.unpause();
    });

    this.emit('request', req, res);
  }

  address(): { port: number; family: string; address: string } | null {
    return this._address;
  }

  /**
   * Register a WebSocket handler on this server (GJS only).
   * Delegates to Soup.Server.add_websocket_handler().
   * @param path URL path to handle WebSocket upgrades (e.g., '/ws')
   * @param callback Called for each new WebSocket connection with the Soup.WebsocketConnection
   */
  addWebSocketHandler(
    path: string,
    callback: (connection: unknown) => void,
  ): void {
    if (!this._soupServer) {
      throw new Error('Server must be listening before adding WebSocket handlers. Call listen() first.');
    }
    this._soupServer.add_websocket_handler(
      path, null, null,
      (_srv: Soup.Server, _msg: Soup.ServerMessage, _path: string, connection: unknown) => {
        callback(connection);
      },
    );
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
