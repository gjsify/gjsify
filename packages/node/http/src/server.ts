// Reference: Node.js lib/_http_server.js
// Reimplemented for GJS using Soup.Server

import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { Buffer } from 'node:buffer';
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

  private _chunks: Buffer[] = [];
  private _soupMsg: Soup.ServerMessage;

  constructor(soupMsg: Soup.ServerMessage) {
    super();
    this._soupMsg = soupMsg;
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

  /** Writable stream _write implementation. */
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
    this._chunks.push(buf);
    callback();
  }

  /** Send the response after end(). */
  _final(callback: (error?: Error | null) => void): void {
    this._sendResponse();
    callback();
  }

  private _sendResponse(): void {
    if (this.headersSent) return;
    this.headersSent = true;

    // Set status
    this._soupMsg.set_status(this.statusCode, this.statusMessage || null);

    // Set headers on the Soup response
    const responseHeaders = this._soupMsg.get_response_headers();

    // Force connection close — Soup.Server keeps HTTP/1.1 connections alive by default,
    // which exhausts the connection pool when clients open new TCP connections per request.
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

    // Set body — always call set_response so Soup knows the response is complete.
    // Without this, empty responses (redirects, 204s) leave the connection hanging.
    const body = Buffer.concat(this._chunks);
    const contentType = (this._headers.get('content-type') as string) || (body.length > 0 ? 'application/octet-stream' : 'text/plain');
    this._soupMsg.set_response(contentType, Soup.MemoryUse.COPY, body);

    this.finished = true;
    // Note: 'finish' is emitted by Writable.end() — do NOT emit here to avoid double emission
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

  constructor(requestListener?: (req: IncomingMessage, res: ServerResponse) => void) {
    super();
    if (requestListener) {
      this.on('request', requestListener);
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
      deferEmit(this, 'error', err instanceof Error ? err : new Error(String(err)));
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
