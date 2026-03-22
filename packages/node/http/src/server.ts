// HTTP Server wrapping Soup.Server for GJS
// Reference: Node.js lib/_http_server.js

import Soup from '@girs/soup-3.0';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { Buffer } from 'buffer';
import { STATUS_CODES } from './constants.js';

/**
 * IncomingMessage — Readable stream representing an HTTP request.
 */
export class IncomingMessage extends Readable {
  httpVersion = '1.1';
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  headers: Record<string, string | string[]> = {};
  rawHeaders: string[] = [];
  method?: string;
  url?: string;
  statusCode?: number;
  statusMessage?: string;
  complete = false;
  socket: any = null;

  constructor() {
    super();
  }

  /** Finish the readable stream with the body data. */
  _pushBody(body: Uint8Array | null): void {
    if (body && body.length > 0) {
      this.push(Buffer.from(body));
    }
    this.push(null);
    this.complete = true;
  }
}

/**
 * ServerResponse — Writable stream representing an HTTP response.
 */
export class ServerResponse extends Writable {
  statusCode = 200;
  statusMessage = '';
  headersSent = false;
  finished = false;
  socket: any = null;

  private _headers: Map<string, string | string[]> = new Map();
  private _chunks: Buffer[] = [];
  private _soupMsg: Soup.ServerMessage;

  constructor(soupMsg: Soup.ServerMessage) {
    super();
    this._soupMsg = soupMsg;
  }

  /** Set a response header. */
  setHeader(name: string, value: string | number | string[]): this {
    this._headers.set(name.toLowerCase(), typeof value === 'number' ? String(value) : value);
    return this;
  }

  /** Get a response header. */
  getHeader(name: string): string | string[] | undefined {
    return this._headers.get(name.toLowerCase());
  }

  /** Remove a response header. */
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

    // Set headers
    const responseHeaders = this._soupMsg.get_response_headers();
    for (const [key, value] of this._headers) {
      if (Array.isArray(value)) {
        for (const v of value) {
          responseHeaders.append(key, v);
        }
      } else {
        responseHeaders.replace(key, value as string);
      }
    }

    // Set body
    const body = Buffer.concat(this._chunks);
    if (body.length > 0) {
      const contentType = (this._headers.get('content-type') as string) || 'application/octet-stream';
      this._soupMsg.set_response(contentType, Soup.MemoryUse.COPY, body);
    }

    this.finished = true;
    this.emit('finish');
  }

  /** Write status + headers + body in one call (convenience). */
  end(chunk?: any, encoding?: any, callback?: any): this {
    if (typeof chunk === 'function') {
      callback = chunk;
      chunk = undefined;
    } else if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }

    if (chunk != null) {
      this.write(chunk, encoding);
    }

    super.end(callback);
    return this;
  }
}

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
  listen(...args: any[]): this {
    let port = 0;
    let hostname = '0.0.0.0';
    let callback: (() => void) | undefined;

    for (const arg of args) {
      if (typeof arg === 'number') port = arg;
      else if (typeof arg === 'string') hostname = arg;
      else if (typeof arg === 'function') callback = arg;
    }

    if (callback) this.once('listening', callback);

    try {
      this._soupServer = new Soup.Server({});

      // Add a catch-all handler
      this._soupServer.add_handler(null, (server: Soup.Server, msg: Soup.ServerMessage, path: string) => {
        this._handleRequest(msg, path);
      });

      this._soupServer.listen_local(port, Soup.ServerListenOptions.IPV4_ONLY);

      // Get the actual port from listeners
      const listeners = this._soupServer.get_listeners();
      let actualPort = port;
      if (listeners && listeners.length > 0) {
        const addr = listeners[0].get_local_address() as any;
        if (addr && typeof addr.get_port === 'function') {
          actualPort = addr.get_port();
        }
      }

      this.listening = true;
      this._address = { port: actualPort, family: 'IPv4', address: hostname };

      setTimeout(() => this.emit('listening'), 0);
    } catch (err: any) {
      setTimeout(() => this.emit('error', err), 0);
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
    setTimeout(() => this.emit('close'), 0);
    return this;
  }

  setTimeout(msecs: number, callback?: () => void): this {
    this.timeout = msecs;
    if (callback) this.on('timeout', callback);
    return this;
  }
}
