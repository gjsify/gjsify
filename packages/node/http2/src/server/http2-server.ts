// Http2Server + Http2SecureServer + TLS helpers.
//
// Two listen paths:
//   - Soup-backed (HTTP/1.1 + h2-over-TLS via ALPN). Default path for
//     createServer({}) / createSecureServer({cert, key}). Honoured for
//     `nativeDispatcher: 'auto'` when allowHTTP1 is undefined.
//   - Native-bridge h2c via @gjsify/http2-native (`@gjsify/http2-native`
//     dispatcher). Used when `allowHTTP1: false` (cleartext HTTP/2
//     server — Soup cannot serve that) or `nativeDispatcher: 'force'`.

import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { deferEmit, ensureMainLoop } from '@gjsify/utils';
import { Http2ServerRequest } from './request.js';
import { Http2ServerResponse, ServerHttp2Stream, type Http2NativeBackend } from './response.js';
import { ServerHttp2Session } from './session.js';
import type { Http2Settings } from '../protocol.js';
import type * as NativeDispatcherModule from '../native-dispatcher.js';
import type { Http2NativeDispatcher, NativeStreamEvent, NativeStreamBackend } from '../native-dispatcher.js';

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
    // Node typings model these as `typeof IncomingMessage` / `typeof ServerResponse`
    // (deprecated in favor of `http1Options.{IncomingMessage,ServerResponse}`).
    // We don't dispatch through them in this impl — the field is kept for shape
    // parity so user `ServerOptions` literals stay assignable.
    Http1IncomingMessage?: new (...args: unknown[]) => unknown;
    Http1ServerResponse?: new (...args: unknown[]) => unknown;
    unknownProtocolTimeout?: number;
    /**
     * Native dispatcher mode (gjsify-specific, defaults to `'auto'`).
     *
     * - `'auto'` — use the @gjsify/http2-native dispatcher when available and
     *   the call is for cleartext HTTP/2 (`createServer({allowHTTP1: false})`)
     *   or h2 ALPN over TLS. Falls back to Soup HTTP/1.1 otherwise.
     * - `'force'` — always use the native dispatcher; throws if the prebuild
     *   is missing. Useful for tests + integration with raw nghttp2 clients.
     * - `'off'` — never use the dispatcher; keep the Soup path even for h2c.
     *   `createServer({allowHTTP1: false})` then has no working configuration
     *   and listen() will throw.
     */
    nativeDispatcher?: 'auto' | 'force' | 'off';
}

export class Http2Server extends EventEmitter {
    listening = false;
    maxHeadersCount = 2000;
    timeout = 0;

    protected _soupServer: Soup.Server | null = null;
    protected _nativeDispatcher: Http2NativeDispatcher | null = null;
    protected _address: { port: number; family: string; address: string } | null = null;
    protected _options: ServerOptions;

    get soupServer(): Soup.Server | null {
        return this._soupServer;
    }
    get nativeDispatcher(): Http2NativeDispatcher | null {
        return this._nativeDispatcher;
    }

    constructor(
        options?: ServerOptions | ((req: Http2ServerRequest, res: Http2ServerResponse) => void),
        handler?: (req: Http2ServerRequest, res: Http2ServerResponse) => void,
    ) {
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
            // Decide whether to take the native dispatcher path. createServer({
            // allowHTTP1: false }) signals "h2c only" — Soup can't serve h2c, so
            // we MUST use the native dispatcher. `nativeDispatcher: 'force'` is a
            // test escape hatch.
            const mode = this._options.nativeDispatcher ?? 'auto';
            const wantsNative = mode === 'force' || (mode === 'auto' && this._options.allowHTTP1 === false);

            if (mode === 'off' && this._options.allowHTTP1 === false) {
                throw new Error(
                    'createServer({ allowHTTP1: false }) requires the native dispatcher; ' +
                        'nativeDispatcher cannot be "off" in this configuration',
                );
            }

            if (wantsNative) {
                this._startNativeListen(port, hostname);
                ensureMainLoop();
                deferEmit(this, 'listening');
                _activeServers.add(this);
                return this;
            }

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

    /**
     * Native dispatcher takes over the listen socket. Soup is not involved.
     * Used by createServer({allowHTTP1: false}) (h2c).
     */
    private _startNativeListen(port: number, hostname: string): void {
        // Lazy import keeps the module out of the Node bundle for createServer
        // consumers who never opt into the native path.
        const { Http2NativeDispatcher } = require('../native-dispatcher.js') as typeof NativeDispatcherModule;
        if (!Http2NativeDispatcher.available()) {
            throw new Error(
                '@gjsify/http2-native prebuild is not loadable. createServer({ allowHTTP1: false }) ' +
                    'requires the native HTTP/2 dispatcher. Ensure GjsifyHttp2-1.0.typelib is installed.',
            );
        }
        this._nativeDispatcher = new Http2NativeDispatcher({
            handler: (event) => this._handleNativeStream(event),
        });
        const actualPort = this._nativeDispatcher.listen(port);
        this.listening = true;
        this._address = { port: actualPort, family: 'IPv4', address: hostname };
    }

    /** @internal Handler for streams arriving on the native dispatcher. */
    private _handleNativeStream(event: NativeStreamEvent): void {
        const req = new Http2ServerRequest();

        // Build the http2-side Http2NativeBackend on top of the per-stream
        // dispatcher backend. Wraps the dispatcher API in the response-shaped
        // form `Http2ServerResponse` consumes. The closure recurses through
        // `pushPromise` so pushed streams get the same shape automatically.
        const adapt = (b: NativeStreamBackend): Http2NativeBackend => ({
            streamId: b.streamId,
            submitResponse: (statusCode, _statusMessage, headers, endStream) => {
                const responseHeaders: Record<string, string | number | string[]> = {
                    ':status': statusCode,
                };
                for (const [k, v] of headers) responseHeaders[k] = v as string | string[];
                b.respond(responseHeaders, endStream);
            },
            submitData: (chunk, endStream) => b.writeData(chunk, endStream),
            reset: (errorCode) => b.reset(errorCode),
            pushPromise: (headers) => {
                const child = b.pushPromise(headers);
                return child ? adapt(child) : null;
            },
        });
        const backend = adapt(event.backend);

        const res = new Http2ServerResponse(null, backend);
        const session = new ServerHttp2Session();
        const stream = new ServerHttp2Stream(res, session, { streamId: event.streamId });
        req._setStream(stream);
        res._setStream(stream);

        // Populate request metadata from the pseudo-headers.
        const headers = event.headers;
        req.method = String(headers[':method'] ?? 'GET');
        const path = String(headers[':path'] ?? '/');
        req.url = path;
        req.authority = String(headers[':authority'] ?? '');
        req.scheme = String(headers[':scheme'] ?? 'http');
        req.httpVersion = '2.0';
        req.httpVersionMajor = 2;
        req.httpVersionMinor = 0;

        // Strip pseudo-headers from regular headers; everything else stays.
        for (const [k, v] of Object.entries(headers)) {
            if (k.startsWith(':')) continue;
            req.headers[k] = v;
            if (Array.isArray(v)) {
                for (const item of v) req.rawHeaders.push(k, item);
            } else {
                req.rawHeaders.push(k, v);
            }
        }

        // GJS has no `net.Socket` / `tls.TLSSocket` instance to surface — the
        // dispatcher carries only the IP/port quadruple. Expose the connection
        // metadata via the public `socket` slot (typed as Node's
        // `net.Socket | tls.TLSSocket | null` for drop-in compat) using a
        // structural cast — consumers that read `remoteAddress` / `remotePort`
        // see correct values, the full Socket method surface is intentionally
        // absent and downstream Node-shaped code calling `socket.destroy()` etc.
        // will fail at runtime as expected for the partial-compat layer.
        req.socket = {
            remoteAddress: event.remoteAddress,
            remotePort: event.remotePort,
            localAddress: this._address?.address ?? '127.0.0.1',
            localPort: event.localPort,
            encrypted: false,
        } as unknown as NonNullable<typeof req.socket>;

        // Drain DATA frames into the Readable. The dispatcher gave us an async
        // iterable; pump it into `_pushBody` and signal EOF.
        (async () => {
            try {
                for await (const chunk of event.body) {
                    req._pushBody(chunk);
                }
                req._pushBody(null);
            } catch {
                req._pushBody(null);
            }
        })();

        // Build the stream headers (Node-compat: includes pseudo-headers).
        const streamHeaders: Record<string, string | string[]> = { ...headers };
        this.emit('stream', stream, streamHeaders);
        this.emit('request', req, res);
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
        const remotePort = remoteAddr instanceof Gio.InetSocketAddress ? remoteAddr.get_port() : 0;
        // Same partial-Socket cast as the dispatcher path above — see comment there.
        req.socket = {
            remoteAddress: remoteHost,
            remotePort,
            localAddress: this._address?.address ?? '127.0.0.1',
            localPort: this._address?.port ?? 0,
            encrypted: this instanceof Http2SecureServer,
        } as unknown as NonNullable<typeof req.socket>;

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
        if (this._nativeDispatcher) {
            this._nativeDispatcher.close();
            this._nativeDispatcher = null;
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

// ─── TLS-cert helpers ─────────────────────────────────────────────────────────

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
        void err;
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
            try {
                Gio.File.new_for_path(certPath).delete(null);
            } catch {}
            try {
                Gio.File.new_for_path(keyPath).delete(null);
            } catch {}
        }
    }
}
