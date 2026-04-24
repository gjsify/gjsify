// WebSocketServer — `ws.WebSocketServer` compatible surface.
//
// Reference: refs/ws/lib/websocket-server.js
//
// Phase 2 scope (this file):
//   - `new WebSocketServer({ port, host })` → standalone Soup.Server
//   - `new WebSocketServer({ server: httpServer })` → attach to existing @gjsify/http Server
//   - `verifyClient(info)` / `verifyClient(info, cb)` — sync + async access control
//     Mechanism: add_handler registered BEFORE add_websocket_handler. Soup calls
//     add_handler first for all requests; if it sets a status code the websocket
//     handler never fires. Soup processes: add_handler → add_websocket_handler.
//   - `handleProtocols(protocols, req)` — select subprotocol from client offer.
//     Limitation: Soup's 101 response is committed before our callback fires, so
//     the Sec-WebSocket-Protocol response header cannot be set per-request without
//     Phase 3 (manual handshake). Server-side ws.protocol IS correct; client-side
//     ws.protocol requires Phase 3.
//   - Emits 'listening' / 'connection' / 'close' / 'error' like ws
//
// Still not supported (Phase 3):
//   - `{ noServer: true }` + handleUpgrade() (external upgrade routing)
//
// Each gap throws a clear error at construction/call site.

import { EventEmitter } from '@gjsify/events';
import { Buffer } from '@gjsify/buffer';
import Soup from '@girs/soup-3.0';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { ensureMainLoop } from '@gjsify/utils';
import { CLOSED, CLOSING, CONNECTING, OPEN } from './constants.js';

/** Structural duck-type for @gjsify/http Server — avoids a hard dep on @gjsify/http. */
interface HttpServer {
  soupServer: Soup.Server | null;
  address(): { address: string; family: string; port: number } | null;
}

// ── verifyClient types ──────────────────────────────────────────────────────

export interface VerifyClientInfo {
  /** Value of the HTTP Origin request header (empty string if absent). */
  origin: string;
  /** Whether the connection uses TLS. Always false on Gjs (Soup plain text). */
  secure: boolean;
  /** Minimal HTTP request object populated from Soup.ServerMessage. */
  req: {
    method: string;
    url: string;
    headers: Record<string, string | string[]>;
    socket: { remoteAddress: string; remotePort: number };
  };
}

export type VerifyClientSync  = (info: VerifyClientInfo) => boolean;
export type VerifyClientAsync = (
  info: VerifyClientInfo,
  cb: (result: boolean, code?: number, message?: string, headers?: Record<string, string>) => void,
) => void;

// ── ServerOptions ───────────────────────────────────────────────────────────

export interface ServerOptions {
  host?: string;
  port?: number;
  backlog?: number;
  /** Attach to an existing @gjsify/http Server instead of creating a new one. */
  server?: HttpServer;
  /** Pre-upgrade access control hook. Sync: return boolean. Async: call cb(result, code?). */
  verifyClient?: VerifyClientSync | VerifyClientAsync;
  /** Subprotocol selection hook. Receives the Set of client-offered protocols and
   *  a minimal request object; return the selected protocol string or false to
   *  use none. Server-side ws.protocol is set correctly; client-visible protocol
   *  negotiation requires Phase 3 (manual handshake). */
  handleProtocols?: (protocols: Set<string>, req: VerifyClientInfo['req']) => string | false;
  path?: string;
  noServer?: boolean;
  clientTracking?: boolean;
  perMessageDeflate?: boolean | object;
  maxPayload?: number;
  skipUTF8Validation?: boolean;
  allowSynchronousEvents?: boolean;
}

// ── ServerSideWebSocket ─────────────────────────────────────────────────────

/** Wraps an accepted Soup.WebsocketConnection in a `ws.WebSocket`-shaped
 *  EventEmitter. Kept private to this file: the WebSocket class in
 *  ./websocket.ts targets the CLIENT constructor path. Server-accepted
 *  connections have different semantics (no URL reconnect, different
 *  lifecycle) so we expose a narrower surface. */
class ServerSideWebSocket extends EventEmitter {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  readonly CONNECTING = CONNECTING;
  readonly OPEN = OPEN;
  readonly CLOSING = CLOSING;
  readonly CLOSED = CLOSED;

  readyState = OPEN;
  protocol = '';
  extensions = '';
  url = '';

  private _conn: Soup.WebsocketConnection;

  constructor(conn: Soup.WebsocketConnection, url: string) {
    super();
    this._conn = conn;
    this.url = url;

    conn.connect('message', (_c: Soup.WebsocketConnection, type: number, bytes: GLib.Bytes) => {
      const data = bytes.get_data();
      if (type === Soup.WebsocketDataType.TEXT) {
        const str = typeof data === 'string'
          ? data
          : data
            ? new TextDecoder('utf-8').decode(data as Uint8Array)
            : '';
        this.emit('message', str, false);
      } else {
        const buf = data ? Buffer.from(data as Uint8Array) : Buffer.alloc(0);
        this.emit('message', buf, true);
      }
    });

    conn.connect('closed', () => {
      this.readyState = CLOSED;
      const code = conn.get_close_code() || 1005;
      const reason = conn.get_close_data() || '';
      this.emit('close', code, Buffer.from(reason));
    });

    conn.connect('error', (_c: Soup.WebsocketConnection, err: GLib.Error) => {
      this.emit('error', new Error(err.message));
    });
  }

  send(
    data: string | Buffer | ArrayBuffer | ArrayBufferView,
    optionsOrCb?: ((err?: Error) => void) | object,
    cb?: (err?: Error) => void,
  ): void {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb;
    try {
      if (typeof data === 'string') {
        const bytes = new TextEncoder().encode(data);
        this._conn.send_message(Soup.WebsocketDataType.TEXT, new GLib.Bytes(bytes));
      } else {
        let bytes: GLib.Bytes;
        if (Buffer.isBuffer(data as any)) {
          const b = data as Buffer;
          bytes = new GLib.Bytes(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
        } else if (data instanceof ArrayBuffer) {
          bytes = new GLib.Bytes(new Uint8Array(data));
        } else if (ArrayBuffer.isView(data)) {
          const view = data as ArrayBufferView;
          bytes = new GLib.Bytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        } else {
          throw new TypeError('Unsupported send() payload type');
        }
        this._conn.send_message(Soup.WebsocketDataType.BINARY, bytes);
      }
      if (callback) queueMicrotask(() => callback());
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (callback) queueMicrotask(() => callback(e));
      else queueMicrotask(() => this.emit('error', e));
    }
  }

  close(code?: number, reason?: string | Buffer): void {
    if (this.readyState === CLOSED || this.readyState === CLOSING) return;
    this.readyState = CLOSING;
    try {
      const reasonStr = reason === undefined
        ? null
        : Buffer.isBuffer(reason as any)
          ? (reason as Buffer).toString('utf8')
          : String(reason);
      this._conn.close(code ?? 1000, reasonStr);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  terminate(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSING;
    try { this._conn.close(1006, null); } catch { /* tearing down */ }
  }
}

// ── WebSocketServer ─────────────────────────────────────────────────────────

/** `ws.WebSocketServer` — listens on a TCP port (or attaches to an existing
 *  @gjsify/http Server) and emits 'connection' events wrapping
 *  Soup.WebsocketConnection as ws.WebSocket-shaped objects. */
export class WebSocketServer extends EventEmitter {
  readonly options: ServerOptions;
  readonly clients: Set<ServerSideWebSocket> = new Set();
  readonly path: string;

  private _server: Soup.Server | null = null;
  private _address: { address: string; family: string; port: number } | null = null;

  constructor(options: ServerOptions = {}, callback?: () => void) {
    super();
    this.options = options;
    this.path = options.path ?? '/';

    if (options.noServer) {
      throw new Error(
        'ws.WebSocketServer with { noServer: true } is not yet supported on Gjs. ' +
        'Use { port } or { server: httpServer } instead.',
      );
    }

    if (options.port === undefined && !options.server) {
      throw new Error(
        'ws.WebSocketServer requires either options.port or options.server on Gjs.',
      );
    }

    if (callback) this.once('listening', callback);
    this._start(options);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _buildVerifyClientInfo(msg: Soup.ServerMessage): VerifyClientInfo {
    const reqHeaders = msg.get_request_headers();
    const headers: Record<string, string | string[]> = {};
    reqHeaders.foreach((name: string, value: string) => {
      const lower = name.toLowerCase();
      const existing = headers[lower];
      if (existing === undefined) headers[lower] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else headers[lower] = [existing, value];
    });
    const uri = msg.get_uri();
    const urlPath = uri.get_path() ?? '/';
    const query = uri.get_query();
    const url = query ? `${urlPath}?${query}` : urlPath;
    const remoteHost = msg.get_remote_host() ?? '127.0.0.1';
    const remoteAddr = msg.get_remote_address();
    const remotePort = (remoteAddr instanceof Gio.InetSocketAddress)
      ? remoteAddr.get_port() : 0;
    return {
      origin: (headers['origin'] as string) ?? '',
      secure: false,
      req: {
        method: msg.get_method(),
        url,
        headers,
        socket: { remoteAddress: remoteHost, remotePort },
      },
    };
  }

  /** Register add_handler (verifyClient) + add_websocket_handler on soupServer.
   *  The verifyClient add_handler MUST be registered before add_websocket_handler —
   *  Soup processes normal handlers before websocket handlers; setting a status code
   *  in add_handler prevents the websocket handler from firing (HTTP-level rejection).
   *  Only register add_handler when verifyClient is provided — a no-op handler on the
   *  same path as an existing http.Server catch-all can interfere with Soup's routing. */
  private _setupHandlers(soupServer: Soup.Server, options: ServerOptions): void {
    // ── Step 1: HTTP interceptor — verifyClient (registered only when needed) ──
    if (options.verifyClient) {
      const vc = options.verifyClient;
      soupServer.add_handler(this.path, (_srv: Soup.Server, msg: Soup.ServerMessage) => {
        const reqHeaders = msg.get_request_headers();
        // Only intercept WebSocket upgrade requests; regular HTTP on same path passes through.
        const upgrade = (reqHeaders.get_one('Upgrade') ?? '').toLowerCase();
        if (upgrade !== 'websocket') return;

        const info = this._buildVerifyClientInfo(msg);

        if (vc.length >= 2) {
          // Async version: verifyClient(info, callback)
          msg.pause();
          (vc as VerifyClientAsync)(info, (result: boolean, code = 401) => {
            if (!result) msg.set_status(code, null);
            msg.unpause();
          });
        } else {
          // Sync version: verifyClient(info) => boolean
          const ok = (vc as VerifyClientSync)(info);
          if (!ok) msg.set_status(401, null);
        }
      });
    }

    // ── Step 2: WebSocket handler — fires only if Step 1 didn't reject ──
    soupServer.add_websocket_handler(
      this.path,
      null,  // origin filter — accept any
      null,  // protocols — Soup accepts all; handleProtocols selects after connect
      (
        _server: Soup.Server,
        msg: Soup.ServerMessage,
        _path: string,
        conn: Soup.WebsocketConnection,
      ) => {
        const url = msg.get_uri()?.to_string() ?? this.path;
        const ws = new ServerSideWebSocket(conn, url);

        if (options.handleProtocols) {
          // Read client-offered protocols from the request header.
          const raw = msg.get_request_headers().get_one('Sec-WebSocket-Protocol') ?? '';
          const offered = new Set(
            raw.split(',').map((s: string) => s.trim()).filter(Boolean),
          );
          const req = this._buildVerifyClientInfo(msg).req;
          const selected = options.handleProtocols(offered, req);
          // Set server-side protocol. Note: the 101 response was already committed
          // by Soup before this fires, so client ws.protocol won't reflect this
          // selection (requires Phase 3 manual handshake for full negotiation).
          if (selected) ws.protocol = selected;
        }

        if (options.clientTracking !== false) {
          this.clients.add(ws);
          ws.on('close', () => this.clients.delete(ws));
        }
        this.emit('connection', ws, msg);
      },
    );
  }

  private _start(options: ServerOptions): void {
    try {
      if (options.server) {
        // ── Attach to existing @gjsify/http Server ──────────────────────
        const httpServer = options.server;
        const soupServer = httpServer.soupServer;
        if (!soupServer) {
          throw new Error(
            'options.server has no active Soup.Server. ' +
            'Ensure httpServer.listen() was called before creating WebSocketServer.',
          );
        }
        this._server = soupServer;
        this._setupHandlers(soupServer, options);
        ensureMainLoop();
        const addr = httpServer.address();
        if (addr) this._address = { address: addr.address, family: addr.family, port: addr.port };
        queueMicrotask(() => this.emit('listening'));
      } else {
        // ── Standalone server ────────────────────────────────────────────
        this._server = new Soup.Server({});
        this._setupHandlers(this._server, options);

        const host = options.host ?? '0.0.0.0';
        const port = options.port!;

        if (host === '127.0.0.1' || host === 'localhost') {
          this._server.listen_local(port, Soup.ServerListenOptions.IPV4_ONLY);
        } else if (host === '::1') {
          this._server.listen_local(port, Soup.ServerListenOptions.IPV6_ONLY);
        } else {
          this._server.listen_all(port, 0);
        }

        // Resolve the actual port (0 → OS-assigned)
        const listeners = this._server.get_listeners();
        let actualPort = port;
        if (listeners && listeners.length > 0) {
          const addr = listeners[0].get_local_address() as Gio.InetSocketAddress;
          if (addr && typeof addr.get_port === 'function') actualPort = addr.get_port();
        }

        ensureMainLoop();
        this._address = { address: host, family: 'IPv4', port: actualPort };
        queueMicrotask(() => this.emit('listening'));
      }
    } catch (err) {
      queueMicrotask(() => this.emit('error', err instanceof Error ? err : new Error(String(err))));
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  address(): { address: string; family: string; port: number } | null {
    return this._address;
  }

  close(callback?: (err?: Error) => void): void {
    try {
      for (const ws of this.clients) ws.close();
      this.clients.clear();
      // Only disconnect the Soup.Server if WE own it (standalone mode).
      // In { server } mode the http.Server owns the Soup.Server lifecycle.
      if (!this.options.server) {
        this._server?.disconnect();
      }
      this._server = null;
      this._address = null;
      this.emit('close');
      if (callback) queueMicrotask(() => callback());
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit('error', e);
      if (callback) queueMicrotask(() => callback(e));
    }
  }

  /** ws-only: manual upgrade routing — not supported on Gjs (requires noServer mode). */
  handleUpgrade(): void {
    throw new Error('ws.WebSocketServer.handleUpgrade() is not supported on Gjs (requires noServer mode).');
  }

  shouldHandle(req: { url?: string }): boolean {
    return req?.url === this.path;
  }
}
