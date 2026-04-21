// WebSocketServer — `ws.WebSocketServer` compatible surface.
//
// Reference: refs/ws/lib/websocket-server.js
//
// Phase 1 scope:
//   - `new WebSocketServer({ port, host })` → Soup.Server.add_websocket_handler
//   - Emits 'listening' / 'connection' / 'close' / 'error' like ws
//   - Incoming connections are wrapped so they look like ws.WebSocket (send,
//     close, readyState, 'message'/'close'/'error' events) without hitting
//     globalThis.WebSocket (server-side connection is already accepted by Soup)
//
// Not yet supported (documented):
//   - `{ server: httpServer }` (attach to existing Node http.Server)
//   - `{ noServer: true }` + handleUpgrade() (external upgrade routing)
//   - `{ path: '/foo' }` routing (only single-handler servers for now)
//   - per-client `verifyClient` / `handleProtocols`
//   - `perMessageDeflate` options (Soup default behavior is used)
//
// Each gap throws a clear error at construction/call site so callers can
// identify what's missing, rather than silently wrong behavior.

import { EventEmitter } from '@gjsify/events';
import { Buffer } from '@gjsify/buffer';
import Soup from '@girs/soup-3.0';
import GLib from '@girs/glib-2.0';
import { ensureMainLoop } from '@gjsify/utils';
import { CLOSED, CLOSING, CONNECTING, OPEN } from './constants.js';

export interface ServerOptions {
  host?: string;
  port?: number;
  backlog?: number;
  server?: unknown;            // not supported on Gjs — see file header
  verifyClient?: unknown;      // not supported — see file header
  handleProtocols?: unknown;   // not supported — see file header
  path?: string;
  noServer?: boolean;
  clientTracking?: boolean;
  perMessageDeflate?: boolean | object;
  maxPayload?: number;
  skipUTF8Validation?: boolean;
  allowSynchronousEvents?: boolean;
}

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
        this._conn.send_text(data);
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

/** `ws.WebSocketServer` — listens on a TCP port and emits 'connection'
 *  events wrapping Soup.WebsocketConnection as ws.WebSocket-shaped objects.
 *
 *  Implementation constraint: Soup.Server owns the HTTP/WebSocket handshake
 *  itself. ws's `noServer` + `handleUpgrade` model (where an external
 *  http.Server emits 'upgrade' and the ws code parses the handshake) does
 *  not map naturally. Phase 1 supports only standalone servers. */
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
        'Use { port } or { host, port } to start a standalone server.',
      );
    }
    if (options.server) {
      throw new Error(
        'ws.WebSocketServer with { server: existingHttpServer } is not yet supported on Gjs. ' +
        'Use { port } or { host, port } to start a standalone server.',
      );
    }
    if (options.verifyClient) {
      throw new Error('ws.WebSocketServer options.verifyClient is not yet supported on Gjs.');
    }
    if (options.handleProtocols) {
      throw new Error('ws.WebSocketServer options.handleProtocols is not yet supported on Gjs.');
    }
    if (options.port === undefined) {
      throw new Error(
        'ws.WebSocketServer requires options.port on Gjs (noServer/server modes not supported).',
      );
    }

    if (callback) this.once('listening', callback);
    this._start(options);
  }

  private _start(options: ServerOptions): void {
    try {
      this._server = new Soup.Server({});
      this._server.add_websocket_handler(
        this.path,
        null, // origin
        null, // protocols
        (
          _server: Soup.Server,
          msg: Soup.ServerMessage,
          _path: string,
          conn: Soup.WebsocketConnection,
        ) => {
          const url = msg.get_uri()?.to_string() ?? this.path;
          const ws = new ServerSideWebSocket(conn, url);
          if (options.clientTracking !== false) {
            this.clients.add(ws);
            ws.on('close', () => this.clients.delete(ws));
          }
          this.emit('connection', ws, msg);
        },
      );

      const host = options.host ?? '0.0.0.0';
      const port = options.port!;
      const inetAddr = GLib as any /* not exported on Gio.Server directly */;
      // Soup.Server has listen_all (any interface) and listen (specific address).
      // For a host binding we use listen_local / listen_all approximations.
      if (host === '127.0.0.1' || host === 'localhost') {
        this._server.listen_local(port, Soup.ServerListenOptions.IPV4_ONLY);
      } else if (host === '::1') {
        this._server.listen_local(port, Soup.ServerListenOptions.IPV6_ONLY);
      } else {
        this._server.listen_all(port, 0);
      }
      void inetAddr; // silence unused

      ensureMainLoop();
      this._address = { address: host, family: 'IPv4', port };
      queueMicrotask(() => this.emit('listening'));
    } catch (err) {
      queueMicrotask(() => this.emit('error', err instanceof Error ? err : new Error(String(err))));
    }
  }

  address(): { address: string; family: string; port: number } | null {
    return this._address;
  }

  close(callback?: (err?: Error) => void): void {
    try {
      for (const ws of this.clients) ws.close();
      this.clients.clear();
      this._server?.disconnect();
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

  /** ws-only: manual upgrade routing — not supported on Gjs. Throwing here
   *  matches the Phase 1 scope (see class doc). */
  handleUpgrade(): void {
    throw new Error('ws.WebSocketServer.handleUpgrade() is not supported on Gjs (requires noServer mode).');
  }

  shouldHandle(req: { url?: string }): boolean {
    return req?.url === this.path;
  }
}
