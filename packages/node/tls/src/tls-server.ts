// TLSServer — accepts incoming TCP connections and upgrades each to TLS via
// Gio.TlsServerConnection. Supports mTLS (requestCert+rejectUnauthorized
// → TlsAuthenticationMode.REQUIRED/REQUESTED/NONE), SNI selection via
// addContext() / SNICallback (driven by a *real* ClientHello-bytes peek —
// see `_upgradeTls` below), and ALPN negotiation.
//
// SNI peek-and-parse: `Gio.Socket.receive_message(MSG_PEEK)` is not
// introspectable in GJS, so we wrap the input stream in a
// `Gio.BufferedInputStream`, `fill_async()` it to land the kernel-buffered
// ClientHello in the 4 KiB buffer, `peek_buffer()` non-consumingly, and
// parse out the server_name extension via `parseClientHelloSni`. The
// buffered stream is then paired with the original output via
// `Gio.SimpleIOStream` and handed to `Gio.TlsServerConnection.new()` —
// TLS reads first drain the buffer (the same ClientHello bytes), then
// continue from the underlying socket transparently.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Server, type Socket } from 'node:net';
import type { Server as NetServer } from 'node:net';
import { createNodeError, deferEmit } from '@gjsify/utils/core';
import { parseClientHelloSni } from './internal/sni-parser.js';
import { checkHostMatch, splitHost } from './internal/hostname.js';
import { createSecureContext, type SecureContext, type SecureContextOptions } from './secure-context.js';
import { TLSSocket, type SocketInternals } from './tls-socket.js';

export type SNICallback = (servername: string, cb: (err: Error | null, ctx?: SecureContext) => void) => void;

export interface TlsServerOptions extends SecureContextOptions {
    requestCert?: boolean;
    rejectUnauthorized?: boolean;
    ALPNProtocols?: string[];
    SNICallback?: SNICallback;
}

/**
 * TLSServer accepts incoming TCP connections and upgrades each to TLS via
 * `Gio.TlsServerConnection`. Supports mTLS via `requestCert`+`rejectUnauthorized`,
 * SNI selection via `addContext`/`SNICallback`, and ALPN negotiation.
 */
export class TLSServer extends Server {
    private _tlsCertificate: Gio.TlsCertificate | null = null;
    private _tlsOptions: TlsServerOptions;
    private _sniContexts = new Map<string, SecureContext>();
    /** @internal — exposed for tests. */
    _secureContext: SecureContext;

    constructor(options?: TlsServerOptions, secureConnectionListener?: (socket: TLSSocket) => void) {
        super();
        this._tlsOptions = options ?? {};
        this._secureContext = createSecureContext(this._tlsOptions);
        this._tlsCertificate = this._secureContext.certificate;

        if (secureConnectionListener) {
            this.on('secureConnection', secureConnectionListener);
        }

        if (this._tlsOptions.cert && !this._tlsCertificate) {
            // PEM provided but failed to parse — emit error asynchronously.
            deferEmit(
                this as unknown as NetServer,
                'error',
                createNodeError(new Error('Failed to parse TLS certificate'), 'createServer', {}),
            );
        }
    }

    /**
     * Add an additional context for SNI (Server Name Indication). Uses RFC 6125
     * matching against the requested server name.
     */
    addContext(hostname: string, context: SecureContextOptions): void {
        try {
            const ctx = createSecureContext(context);
            this._sniContexts.set(hostname.toLowerCase(), ctx);
        } catch (err: unknown) {
            this.emit('error', createNodeError(err, 'addContext', {}));
        }
    }

    /**
     * Resolve a SecureContext for the given server name. Order:
     *   1. exact match in `_sniContexts`
     *   2. RFC 6125 wildcard match in `_sniContexts`
     *   3. SNICallback (if provided)
     *   4. fall through to the server's default context
     */
    private _resolveSniContext(servername: string | null, done: (ctx: SecureContext) => void): void {
        const fallback = this._secureContext;
        if (!servername) {
            done(fallback);
            return;
        }
        const lower = servername.toLowerCase();
        const exact = this._sniContexts.get(lower);
        if (exact) {
            done(exact);
            return;
        }
        const hostParts = splitHost(lower);
        for (const [pattern, ctx] of this._sniContexts) {
            if (checkHostMatch(hostParts, pattern)) {
                done(ctx);
                return;
            }
        }
        if (this._tlsOptions.SNICallback) {
            try {
                this._tlsOptions.SNICallback(servername, (err: Error | null, ctx?: SecureContext) => {
                    if (err || !ctx) {
                        done(fallback);
                        return;
                    }
                    done(ctx);
                });
                return;
            } catch {
                done(fallback);
                return;
            }
        }
        done(fallback);
    }

    listen(...args: unknown[]): this {
        this.on('connection', (socket: Socket) => {
            this._upgradeTls(socket);
        });
        type ListenArgs = Parameters<NetServer['listen']>;
        return (super.listen as (...a: ListenArgs) => this)(...(args as unknown as ListenArgs));
    }

    /** Upgrade a raw TCP socket to TLS using Gio.TlsServerConnection. */
    private _upgradeTls(socket: Socket): void {
        const rawConnection = (socket as unknown as SocketInternals)._connection;
        if (!rawConnection) {
            const err = new Error('Cannot upgrade socket: no underlying connection');
            this.emit('tlsClientError', err, socket);
            socket.destroy();
            return;
        }

        if (!this._tlsCertificate && this._sniContexts.size === 0 && !this._tlsOptions.SNICallback) {
            const err = new Error('TLS server has no certificate configured');
            this.emit('tlsClientError', err, socket);
            socket.destroy();
            return;
        }

        // SNI server-side selection: wrap the connection's input stream in a
        // Gio.BufferedInputStream, fill it (so the kernel-buffered ClientHello
        // lands in the buffer), peek the bytes without consuming them, and parse
        // out the server_name extension. The buffered stream is then handed to
        // Gio.TlsServerConnection via a Gio.SimpleIOStream — subsequent reads
        // first drain the buffer (the same ClientHello bytes), then continue
        // from the underlying socket transparently. Gio.Socket.receive_message
        // with MSG_PEEK is not introspectable in GJS (see refs note in
        // @gjsify/http-soup-bridge), so this BufferedInputStream route is the
        // pure-TS substitute.
        const ioStream = rawConnection as unknown as Gio.IOStream;
        const inputStream = ioStream.get_input_stream();
        const outputStream = ioStream.get_output_stream();
        // 4 KiB suffices for typical ClientHello (~100–800 B). Extremely large
        // hellos with many extensions can hit ~16 KiB, but missing such tails
        // only degrades to default-cert fallback — never breaks the handshake.
        const buffered = Gio.BufferedInputStream.new_sized(inputStream, 4096);

        buffered.fill_async(
            4096,
            GLib.PRIORITY_DEFAULT,
            null,
            (_source: Gio.BufferedInputStream | null, asyncResult: Gio.AsyncResult) => {
                let servername: string | null = null;
                try {
                    buffered.fill_finish(asyncResult);
                    const peeked = buffered.peek_buffer();
                    servername = parseClientHelloSni(peeked);
                } catch {
                    // peek failed — fall back to default cert selection.
                }

                this._resolveSniContext(servername, (ctx) => {
                    const certificate = ctx.certificate ?? this._tlsCertificate;
                    if (!certificate) {
                        const err = new Error('SNI resolution returned no certificate');
                        this.emit('tlsClientError', err, socket);
                        socket.destroy();
                        return;
                    }

                    try {
                        // Construct a virtual IOStream pairing the buffered input
                        // (already holding the ClientHello) with the original output.
                        // TlsServerConnection accepts any GIOStream; SocketConnection
                        // identity is not required for handshake correctness.
                        const wrappedIo = new Gio.SimpleIOStream({
                            inputStream: buffered,
                            outputStream,
                        });
                        const tlsConn = Gio.TlsServerConnection.new(wrappedIo, certificate);

                        // Client-cert / mTLS configuration
                        if (this._tlsOptions.requestCert) {
                            tlsConn.authenticationMode =
                                this._tlsOptions.rejectUnauthorized !== false
                                    ? Gio.TlsAuthenticationMode.REQUIRED
                                    : Gio.TlsAuthenticationMode.REQUESTED;
                        } else {
                            tlsConn.authenticationMode = Gio.TlsAuthenticationMode.NONE;
                        }

                        const requireClientCert =
                            !!this._tlsOptions.requestCert && this._tlsOptions.rejectUnauthorized !== false;
                        const clientCAs = this._secureContext.caCertificates;

                        tlsConn.connect(
                            'accept-certificate',
                            (
                                _conn: Gio.TlsConnection,
                                peerCert: Gio.TlsCertificate,
                                _errors: Gio.TlsCertificateFlags,
                            ): boolean => {
                                if (!requireClientCert) return true;
                                if (clientCAs.length === 0) return false;
                                for (const ca of clientCAs) {
                                    try {
                                        const flags = peerCert.verify(null, ca);
                                        if (flags === Gio.TlsCertificateFlags.NO_FLAGS) return true;
                                    } catch {
                                        /* try next */
                                    }
                                }
                                return false;
                            },
                        );

                        // ALPN — set_advertised_protocols is a plain property
                        // setter with no throw path in the GIR; an ALPN-less
                        // backend just ignores it.
                        if (this._tlsOptions.ALPNProtocols && this._tlsOptions.ALPNProtocols.length > 0) {
                            tlsConn.set_advertised_protocols(this._tlsOptions.ALPNProtocols);
                        }

                        const cancellable = new Gio.Cancellable();
                        tlsConn.handshake_async(
                            GLib.PRIORITY_DEFAULT,
                            cancellable,
                            (_source: Gio.TlsConnection | null, asyncResult: Gio.AsyncResult) => {
                                try {
                                    tlsConn.handshake_finish(asyncResult);

                                    const tlsSocket = new TLSSocket();
                                    tlsSocket.encrypted = true;
                                    tlsSocket.authorized = true;
                                    tlsSocket._secureContext = ctx;
                                    tlsSocket._setupTlsStreams(tlsConn);
                                    tlsSocket.alpnProtocol = tlsSocket.getAlpnProtocol();

                                    const internals = tlsSocket as unknown as SocketInternals;
                                    internals._startReading();

                                    this.emit('secureConnection', tlsSocket);
                                } catch (err: unknown) {
                                    const nodeErr = createNodeError(err, 'handshake', {});
                                    this.emit('tlsClientError', nodeErr, socket);
                                    socket.destroy();
                                }
                            },
                        );
                    } catch (err: unknown) {
                        const nodeErr = createNodeError(err, 'tls_wrap', {});
                        this.emit('tlsClientError', nodeErr, socket);
                        socket.destroy();
                    }
                });
            },
        );
    }
}

/**
 * Create a TLS server.
 */
export function createServer(
    options?: TlsServerOptions,
    secureConnectionListener?: (socket: TLSSocket) => void,
): TLSServer;
export function createServer(secureConnectionListener?: (socket: TLSSocket) => void): TLSServer;
export function createServer(
    optionsOrListener?: TlsServerOptions | ((socket: TLSSocket) => void),
    secureConnectionListener?: (socket: TLSSocket) => void,
): TLSServer {
    if (typeof optionsOrListener === 'function') {
        return new TLSServer(undefined, optionsOrListener);
    }
    return new TLSServer(optionsOrListener, secureConnectionListener);
}
