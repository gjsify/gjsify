// Reference: Node.js lib/_http_server.js
// Reimplemented for GJS using the @gjsify/http-soup-bridge native package.
//
// Why the bridge: see STATUS.md "Upstream GJS Patch Candidates" — two
// distinct GJS↔libsoup binding races (Boxed-Source GC race + shared
// `GMainContext` ref imbalance) make any in-JS Soup.Server wiring
// SIGSEGV silently after a non-GJS HTTP client (MCP Inspector subprocess,
// Node.js fetch, browser EventSource) sends a chunked SSE response. The
// bridge keeps every libsoup boxed type C-side; JS only sees plain
// GObject ref-counted bridge classes (`Server` / `Request` / `Response`)
// whose lifetime SpiderMonkey GC cannot race against. Same pattern as
// `@gjsify/webrtc-native`.

import Gio from '@girs/gio-2.0';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { Socket as NetSocket } from '@gjsify/net/socket';
import {
  Server as BridgeServer,
  type Request as BridgeRequest,
  type Response as BridgeResponse,
} from '@gjsify/http-soup-bridge';
import { ServerRequestSocket } from './server-request-socket.js';
import { createNodeError, deferEmit, ensureMainLoop } from '@gjsify/utils';
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
 *
 * Holds a `BridgeResponse` from `@gjsify/http-soup-bridge`. All header /
 * status / body operations delegate to the bridge, which handles the
 * underlying Soup.ServerMessage in C-space (no JS-visible boxed types).
 */
export class ServerResponse extends OutgoingMessage {
  statusCode = 200;
  statusMessage = '';

  private _streaming = false;
  private _bridge: BridgeResponse;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(bridge: BridgeResponse) {
    super();
    this._bridge = bridge;
    // Translate the bridge's `'close'` signal into a Node-style 'close'
    // event for consumers (Hono, MCP transport, engine.io, etc.).
    bridge.connect('close', () => {
      this.emit('close');
    });
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
    if (!this.headersSent) {
      this.headersSent = true;
    }
  }

  /** Add trailing headers for chunked transfer encoding. */
  addTrailers(headers: Record<string, string>): void {
    // Soup.Server doesn't support HTTP trailers natively. Stored for
    // compatibility but not transmitted.
    for (const [key, value] of Object.entries(headers)) {
      this._headers.set('trailer-' + key.toLowerCase(), value);
    }
  }

  /**
   * Push our header map to the bridge and call write_head() on first
   * write. Idempotent.
   */
  private _startStreaming(): void {
    if (this._streaming) return;
    this._streaming = true;
    this.headersSent = true;

    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }

    for (const [key, value] of this._headers) {
      if (Array.isArray(value)) {
        for (const v of value) this._bridge.append_header(key, v);
      } else {
        this._bridge.set_header(key, value as string);
      }
    }

    this._bridge.write_head(this.statusCode, this.statusMessage || null);
  }

  /** Writable stream _write — sends headers on first call, then appends each chunk. */
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
    this._startStreaming();
    this._bridge.write_chunk(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    callback();
  }

  /** Called by Writable.end() — finishes the bridge response. */
  _final(callback: (error?: Error | null) => void): void {
    if (!this._streaming) {
      // Batch mode — push headers + status then end with no body. The
      // bridge's `end()` on a fresh Response sends an empty body.
      for (const [key, value] of this._headers) {
        if (Array.isArray(value)) {
          for (const v of value) this._bridge.append_header(key, v);
        } else {
          this._bridge.set_header(key, value as string);
        }
      }
      this._bridge.write_head(this.statusCode, this.statusMessage || null);
    }
    this._bridge.end();
    this.finished = true;
    callback();
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

// GC guard — GJS garbage-collects objects with no JS references. When
// frameworks like Koa/Express create an http.Server inside .listen() and
// the caller discards the return value, the Server (and its bridge
// underneath) gets collected after ~10 s. This Set keeps a strong
// reference to every listening server.
const _activeServers = new Set<Server>();

/**
 * HTTP Server — wraps a `@gjsify/http-soup-bridge` Server.
 *
 * Public API matches Node.js `http.Server`. Internal differences from the
 * pre-bridge version are invisible to consumers (Hono / Express / MCP /
 * engine.io / `@gjsify/ws`) — they continue to use `.on('request', …)`,
 * `.on('upgrade', …)`, `.listen()`, `.close()`, `.address()`, etc.
 */
export class Server extends EventEmitter {
  listening = false;
  maxHeadersCount = 2000;
  timeout = 0;
  keepAliveTimeout = 5000;
  headersTimeout = 60000;
  requestTimeout = 300000;

  private _bridge: BridgeServer | null = null;
  private _address: { port: number; family: string; address: string } | null = null;

  /** Exposes the underlying Soup.Server so consumers (e.g. WebSocketServer
   *  in `@gjsify/ws`) can register additional handlers (websocket, path-
   *  specific) on the same server instance without port-sharing conflicts. */
  get soupServer(): unknown {
    return this._bridge?.soup_server ?? null;
  }

  constructor(requestListener?: ((req: IncomingMessage, res: ServerResponse) => void) | Record<string, unknown>);
  constructor(options: Record<string, unknown>, requestListener?: (req: IncomingMessage, res: ServerResponse) => void);
  constructor(
    optionsOrListener?: ((req: IncomingMessage, res: ServerResponse) => void) | Record<string, unknown>,
    requestListener?: (req: IncomingMessage, res: ServerResponse) => void,
  ) {
    super();
    const listener = typeof optionsOrListener === 'function' ? optionsOrListener : requestListener;
    if (listener) this.on('request', listener);
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
      this._bridge = new BridgeServer();

      this._bridge.connect('request-received', (_self: BridgeServer, req: BridgeRequest, res: BridgeResponse) => {
        this._handleRequest(req, res);
      });

      this._bridge.connect('upgrade', (_self: BridgeServer, req: BridgeRequest, iostream: Gio.IOStream, _head: unknown) => {
        this._handleUpgrade(req, iostream);
      });

      this._bridge.connect('error-occurred', (_self: BridgeServer, msg: string) => {
        this.emit('error', new Error(msg));
      });

      this._bridge.listen(port, hostname);

      ensureMainLoop();

      this.listening = true;
      this._address = { port: this._bridge.port, family: 'IPv4', address: this._bridge.address || hostname };
      _activeServers.add(this);
      deferEmit(this, 'listening');
    } catch (err: unknown) {
      const nodeErr = createNodeError(err, 'listen', { address: hostname, port });
      deferEmit(this, 'error', nodeErr);
    }

    return this;
  }

  private _handleRequest(bridgeReq: BridgeRequest, bridgeRes: BridgeResponse): void {
    const req = new IncomingMessage();
    const res = new ServerResponse(bridgeRes);

    req.method = bridgeReq.method;
    req.url = bridgeReq.url;
    req.httpVersion = '1.1';

    // header_pairs is [name, value, name, value, …]
    const pairs = bridgeReq.header_pairs ?? [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const name = pairs[i];
      const value = pairs[i + 1];
      const lower = name.toLowerCase();
      req.rawHeaders.push(name, value);
      if (lower in req.headers) {
        const existing = req.headers[lower];
        if (Array.isArray(existing)) existing.push(value);
        else req.headers[lower] = [existing as string, value];
      } else {
        req.headers[lower] = value;
      }
    }

    req.socket = new ServerRequestSocket(
      bridgeReq.remote_address ?? '127.0.0.1',
      bridgeReq.remote_port ?? 0,
      this._address?.address ?? '127.0.0.1',
      this._address?.port ?? 0,
      bridgeRes,
    ) as unknown as import('net').Socket;

    // Push body bytes (pre-buffered by libsoup) and EOF. Body is exposed
    // as a method (not a property) on the bridge — GIR-marshalled
    // `uint8[]` properties get cleared by the time JS reads them.
    const body = bridgeReq.get_body();
    if (body.length > 0) req._pushBody(body);
    else req._pushBody(null);

    // Translate bridge 'aborted_signal' / 'close' into req events.
    bridgeReq.connect('aborted_signal', () => {
      if (!req.aborted) {
        req.aborted = true;
        req.emit('aborted');
      }
    });
    bridgeReq.connect('close', () => {
      req.emit('close');
    });

    // Emit synchronously. Async handler rejections that escape user code
    // are caught here so they surface on stderr instead of becoming silent
    // GLib-callback rejections.
    try {
      const result = this.emit('request', req, res) as unknown;
      if (result instanceof Promise || (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function')) {
        (result as Promise<unknown>).catch((err: unknown) => {
          console.error('[HTTP] Unhandled error in async request handler:', err);
          if (!res.headersSent) {
            try { res.writeHead(500); res.end('Internal Server Error'); } catch { /* ignore */ }
          }
        });
      }
    } catch (err) {
      console.error('[HTTP] Unhandled error in request handler:', err);
      if (!res.headersSent) {
        try { res.writeHead(500); res.end('Internal Server Error'); } catch { /* ignore */ }
      }
    }
  }

  private _handleUpgrade(bridgeReq: BridgeRequest, iostream: Gio.IOStream): void {
    const req = new IncomingMessage();
    req.method = bridgeReq.method;
    req.url = bridgeReq.url;
    req.httpVersion = '1.1';

    const pairs = bridgeReq.header_pairs ?? [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const name = pairs[i];
      const value = pairs[i + 1];
      const lower = name.toLowerCase();
      req.rawHeaders.push(name, value);
      req.headers[lower] = value;
    }

    if (this.listenerCount('upgrade') > 0) {
      const socket = new NetSocket();
      socket._attachOutputOnly(iostream);
      this.emit('upgrade', req, socket, Buffer.alloc(0));
    }
  }

  address(): { port: number; family: string; address: string } | null {
    return this._address;
  }

  /**
   * Register a WebSocket handler on this server (GJS only).
   * Delegates to the underlying `Soup.Server.add_websocket_handler()`.
   * @param path URL path to handle WebSocket upgrades (e.g., '/ws')
   * @param callback Called for each new WebSocket connection with the Soup.WebsocketConnection
   */
  addWebSocketHandler(
    path: string,
    callback: (connection: unknown) => void,
  ): void {
    if (!this._bridge) {
      throw new Error('Server must be listening before adding WebSocket handlers. Call listen() first.');
    }
    const soupServer = this._bridge.soup_server as {
      add_websocket_handler: (
        p: string | null,
        origin: string | null,
        protocols: string[] | null,
        cb: (srv: unknown, msg: unknown, p: string, conn: unknown) => void,
      ) => void;
    };
    soupServer.add_websocket_handler(
      path, null, null,
      (_srv, _msg, _p, connection) => {
        callback(connection);
      },
    );
  }

  close(callback?: (err?: Error) => void): this {
    if (callback) this.once('close', callback);

    if (this._bridge) {
      this._bridge.close();
      this._bridge = null;
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
