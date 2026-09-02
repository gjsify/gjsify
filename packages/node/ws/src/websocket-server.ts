// WebSocketServer — `ws.WebSocketServer` compatible surface.
//
// Reference: refs/ws/lib/websocket-server.js
//
// Supported:
//   - `new WebSocketServer({ port, host })` → standalone Soup.Server
//   - `new WebSocketServer({ server: httpServer })` → attach to existing @gjsify/http Server
//   - `new WebSocketServer({ noServer: true })` → caller calls handleUpgrade() manually
//   - `verifyClient(info)` / `verifyClient(info, cb)` — sync + async access control
//     Mechanism (Soup path): add_handler registered BEFORE add_websocket_handler.
//     Mechanism (handleUpgrade path): HTTP 4xx response written before 101.
//   - `handleProtocols(protocols, req)` — select subprotocol from client offer.
//     Note: In the Soup path the 101 response is committed before our callback fires,
//     so client-side ws.protocol won't reflect the selection. In the handleUpgrade
//     path it IS reflected because we write the 101 ourselves.
//   - `handleUpgrade(req, socket, head, cb)` — manual upgrade routing.
//     Computes Sec-WebSocket-Accept, emits 'headers', writes 101 via socket.write(),
//     then creates Soup.WebsocketConnection from the IOStream and calls cb(ws, req).
//   - Emits 'listening' / 'connection' / 'close' / 'error' / 'headers' like ws
//
// Not supported:
//   - `ping()`/`pong()` events — libsoup 3 GI does not expose a user-level API;
//     Soup handles control frames internally (Phase 4).
//   - `createWebSocketStream()` (Phase 4)

import { EventEmitter } from '@gjsify/events';
import { Buffer } from '@gjsify/buffer';
import { createHash } from '@gjsify/crypto';
import Soup from '@girs/soup-3.0';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { ensureMainLoop } from '@gjsify/utils/core';
import { CLOSED, CLOSING, CONNECTING, OPEN } from './constants.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_KEY_REGEX = /^[+/0-9A-Za-z]{22}==$/;

/** Structural duck-type for @gjsify/http Server — avoids a hard dep on @gjsify/http. */
interface HttpServer {
    soupServer: Soup.Server | null;
    address(): { address: string; family: string; port: number } | null;
}

/** Structural duck-type for an HTTP upgrade request (Node `IncomingMessage`-shaped).
 *  ws's `handleUpgrade(req, socket, head, cb)` accepts the IncomingMessage produced
 *  by `http.Server`'s 'upgrade' event — modelled structurally so this file does not
 *  hard-depend on `@gjsify/http`'s exact request class. Members read defensively. */
interface UpgradeRequest {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string; remotePort?: number };
}

/** Structural duck-type for the upgrade socket (Node `Duplex`/`net.Socket`-shaped).
 *  We only need `write`/`destroy` to send the 101/4xx response, plus the optional
 *  `_releaseIOStream` hook that `@gjsify/net`'s Socket exposes so we can hand its
 *  underlying `Gio.IOStream` to `Soup.WebsocketConnection.new`. The hook stays
 *  optional so a plain net.Socket can still pass through `_abortHandshake`. */
interface UpgradeSocket {
    write(chunk: string | Uint8Array, cb?: (err?: Error) => void): boolean;
    destroy?(err?: Error): void;
    _releaseIOStream?(): Gio.IOStream | null;
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

export type VerifyClientSync = (info: VerifyClientInfo) => boolean;
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
                const str =
                    typeof data === 'string' ? data : data ? new TextDecoder('utf-8').decode(data as Uint8Array) : '';
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
                if (Buffer.isBuffer(data)) {
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
            const reasonStr =
                reason === undefined ? null : Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason);
            this._conn.close(code ?? 1000, reasonStr);
        } catch (err) {
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
    }

    terminate(): void {
        if (this.readyState === CLOSED) return;
        this.readyState = CLOSING;
        // soup_websocket_connection_close has no throw path in the GIR (a
        // double close is a g_return_if_fail warning) and both arguments are
        // literals — unlike close() above, whose caller-supplied code can fail
        // gushort marshalling and needs its catch.
        this._conn.close(1006, null);
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
            if (options.port !== undefined || options.server !== undefined) {
                throw new Error('ws.WebSocketServer: { noServer: true } is mutually exclusive with port and server.');
            }
            // noServer mode: caller manages the http.Server and calls handleUpgrade() manually.
            // No Soup.Server is created; no port is bound.
            if (callback) this.once('listening', callback);
            return;
        }

        if (options.port === undefined && !options.server) {
            throw new Error('ws.WebSocketServer requires either options.port or options.server on Gjs.');
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
        const remotePort = remoteAddr instanceof Gio.InetSocketAddress ? remoteAddr.get_port() : 0;
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
        // ── Step 0: Disable WebSocket per-message-deflate ──
        // Soup ships `WebsocketExtensionDeflate` registered by
        // default on every `Soup.Server` (see the `note` in
        // [libsoup's `soup_server_add_websocket_extension` docs](
        // refs/libsoup/libsoup/server/soup-server.c:1971)). Combined
        // with `@gjsify/ws` (the client side here, defaulting
        // `perMessageDeflate: true` to match npm-ws), the handshake
        // negotiates deflate but Soup's loopback encode/decode path
        // is buggy across Fedora Soup 3.x builds — server-to-client
        // frames go out compressed, the client never sees a usable
        // `message` event, and the connection times out.
        //
        // The pragmatic fix: REMOVE deflate from the server's
        // supported-extensions list. Clients that offer deflate
        // fall back to plain frames (which work end-to-end in
        // every test we run). For peers that genuinely need
        // deflate (cross-internet bandwidth-constrained), the
        // caller can re-register via `soupServer.add_websocket_
        // extension(...)` after constructing the WebSocketServer.
        //
        // Surfaced by pixel-rpg/map-editor's Pair-Editing 2026-05-31
        // hand-test: host sent 13 frames, joiner reported `0
        // frames delivered`. Reproduced in `rapid-server-send.
        // spec.ts` — `perMessageDeflate=false` client variant
        // already passes; with deflate disabled server-side every
        // client variant passes too.
        try {
            soupServer.remove_websocket_extension(Soup.WebsocketExtensionDeflate.$gtype);
        } catch {
            // Older Soup builds without WebsocketExtensionDeflate
            // fall through silently (nothing to remove).
        }

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
            null, // origin filter — accept any
            null, // protocols — Soup accepts all; handleProtocols selects after connect
            (_server: Soup.Server, msg: Soup.ServerMessage, _path: string, conn: Soup.WebsocketConnection) => {
                const url = msg.get_uri()?.to_string() ?? this.path;
                const ws = new ServerSideWebSocket(conn, url);

                if (options.handleProtocols) {
                    // Read client-offered protocols from the request header.
                    const raw = msg.get_request_headers().get_one('Sec-WebSocket-Protocol') ?? '';
                    const offered = new Set(
                        raw
                            .split(',')
                            .map((s: string) => s.trim())
                            .filter(Boolean),
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
                    // `0` is "no flags", which every GIR flags field accepts and no
                    // TypeScript enum can express: `Soup.ServerListenOptions` starts at
                    // `HTTPS = 1` and has no zero member. @girs 4.5.0 narrowed this
                    // parameter from `number` to the enum, so the cast is what carries
                    // the C semantics across — not a silenced error.
                    this._server.listen_all(port, 0 as Soup.ServerListenOptions);
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

    /** Manual WebSocket upgrade — matches npm ws semantics exactly.
     *  The caller intercepts 'upgrade' on an http.Server (typically with
     *  { noServer: true } on this WebSocketServer) and passes the raw
     *  IncomingMessage + net.Socket + head buffer here.
     *
     *  Internally: validates headers, runs verifyClient, computes
     *  Sec-WebSocket-Accept, emits 'headers' (mutable array), writes the 101
     *  response via socket.write(), then creates Soup.WebsocketConnection from
     *  the underlying IOStream and calls cb(ws, req). */
    handleUpgrade(
        req: UpgradeRequest,
        socket: UpgradeSocket,
        _head: Buffer,
        cb: (ws: ServerSideWebSocket, req: UpgradeRequest) => void,
    ): void {
        if (!this._validateUpgradeHeaders(req, socket)) return;
        const key = (req.headers?.['sec-websocket-key'] ?? '') as string;

        const doUpgrade = () => this._completeUpgrade(req, socket, key, cb);

        if (this.options.verifyClient) {
            const vc = this.options.verifyClient;
            const info = this._buildVerifyClientInfoFromReq(req);
            if (vc.length >= 2) {
                (vc as VerifyClientAsync)(info, (result: boolean, code = 401) => {
                    if (!result) {
                        this._abortHandshake(socket, code);
                        return;
                    }
                    doUpgrade();
                });
                return;
            }
            if (!(vc as VerifyClientSync)(info)) {
                this._abortHandshake(socket, 401);
                return;
            }
        }
        doUpgrade();
    }

    shouldHandle(req: { url?: string }): boolean {
        if (this.path === '/') return true;
        const url = req?.url ?? '/';
        return url === this.path || url.startsWith(this.path + '?') || url.startsWith(this.path + '/');
    }

    // ── handleUpgrade helpers ───────────────────────────────────────────────

    private _validateUpgradeHeaders(req: UpgradeRequest, socket: UpgradeSocket): boolean {
        const h = req.headers ?? {};
        if (req.method !== 'GET') {
            this._abortHandshake(socket, 405);
            return false;
        }
        if (((h['upgrade'] as string | undefined) ?? '').toLowerCase() !== 'websocket') {
            this._abortHandshake(socket, 400);
            return false;
        }
        if (!WS_KEY_REGEX.test((h['sec-websocket-key'] as string | undefined) ?? '')) {
            this._abortHandshake(socket, 400);
            return false;
        }
        const ver = Number((h['sec-websocket-version'] as string | undefined) ?? '0');
        if (ver !== 13 && ver !== 8) {
            this._abortHandshake(socket, 426);
            return false;
        }
        if (!this.shouldHandle(req)) {
            this._abortHandshake(socket, 400);
            return false;
        }
        return true;
    }

    private _completeUpgrade(
        req: UpgradeRequest,
        socket: UpgradeSocket,
        key: string,
        cb: (ws: ServerSideWebSocket, req: UpgradeRequest) => void,
    ): void {
        const digest = createHash('sha1')
            .update(key + WS_GUID)
            .digest('base64');

        const responseHeaders = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${digest}`,
        ];

        let selectedProtocol: string | null = null;
        if (this.options.handleProtocols) {
            const raw = (req.headers?.['sec-websocket-protocol'] ?? '') as string;
            const offered = new Set(
                raw
                    .split(',')
                    .map((s: string) => s.trim())
                    .filter(Boolean),
            );
            const sel = this.options.handleProtocols(offered, this._buildVerifyClientInfoFromReq(req).req);
            if (sel) {
                selectedProtocol = sel;
                responseHeaders.push(`Sec-WebSocket-Protocol: ${sel}`);
            }
        }

        // Emit 'headers' hook — listeners may push additional response headers.
        this.emit('headers', responseHeaders, req);

        // Write the 101 response then hand the IOStream to Soup.WebsocketConnection.
        const responseStr = responseHeaders.join('\r\n') + '\r\n\r\n';
        socket.write(responseStr, () => {
            const ioStream: Gio.IOStream | null =
                typeof socket._releaseIOStream === 'function' ? socket._releaseIOStream() : null;
            if (!ioStream) {
                socket.destroy?.();
                return;
            }

            const rawUrl = req.url ?? '/';
            const uri = GLib.Uri.parse(`ws://localhost${rawUrl}`, GLib.UriFlags.NONE);
            const conn = Soup.WebsocketConnection['new'](
                ioStream,
                uri,
                Soup.WebsocketConnectionType.SERVER,
                null,
                selectedProtocol,
                [],
            );

            const ws = new ServerSideWebSocket(conn, rawUrl);
            if (selectedProtocol) ws.protocol = selectedProtocol;

            if (this.options.clientTracking !== false) {
                this.clients.add(ws);
                ws.on('close', () => this.clients.delete(ws));
            }
            cb(ws, req);
        });
    }

    private _abortHandshake(socket: UpgradeSocket, code: number): void {
        const statusTexts: Record<number, string> = {
            400: 'Bad Request',
            401: 'Unauthorized',
            403: 'Forbidden',
            405: 'Method Not Allowed',
            426: 'Upgrade Required',
        };
        const msg = statusTexts[code] ?? 'Error';
        socket.write?.(`HTTP/1.1 ${code} ${msg}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`, () => {
            socket.destroy?.();
        });
    }

    private _buildVerifyClientInfoFromReq(req: UpgradeRequest): VerifyClientInfo {
        const h = req.headers ?? {};
        // Defensive coerce: UpgradeRequest models per-header values as
        // `string | string[] | undefined` (Node http), so a per-field cast is needed
        // to satisfy VerifyClientInfo's narrower `Record<string, string | string[]>`.
        const headers = h as Record<string, string | string[]>;
        return {
            origin: (headers['origin'] as string | undefined) ?? '',
            secure: false,
            req: {
                method: req.method ?? 'GET',
                url: req.url ?? '/',
                headers,
                socket: {
                    remoteAddress: req.socket?.remoteAddress ?? '127.0.0.1',
                    remotePort: req.socket?.remotePort ?? 0,
                },
            },
        };
    }
}
