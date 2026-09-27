// TLSSocket — wraps a net.Socket with TLS via Gio.TlsConnection.
//
// Node API ↔ Gio mapping for getters: getProtocol() reads
// TlsConnection.get_protocol_version(); getCipher() reads
// get_ciphersuite_name(); getAlpnProtocol() reads
// get_negotiated_protocol(); getPeerCertificate() walks
// get_peer_certificate() + (when `detailed`) the issuer chain via
// get_issuer(). `_setupTlsStreams` wires the TLS connection's input/output
// streams into the underlying Socket private fields so `socket.write()` /
// `socket.on('data', …)` go through the encrypted channel.
//
// Phase 2 (session resumption + channel binding): getFinished() /
// getPeerFinished() / getSession() / setSession() / isSessionReused()
// + the 'session' event delegate to a `NativeSessionAccess` wrapper
// from `@gjsify/tls-native`. The native side currently throws
// "not supported" — see `session-access.ts` and
// `docs/poc/tls-phase2-session-access.md` for the open question.
// The TLSSocket methods translate that throw into a `Buffer | undefined`
// return (Node's contract for "session feature unavailable").

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Buffer } from 'node:buffer';
import { Socket } from 'node:net';
import process from 'node:process';
import { tlsCertToPeerCert, type PeerCertificate } from './internal/cert-utils.js';
import { createSecureContext, type SecureContext, type SecureContextOptions } from './secure-context.js';
import { createSessionAccess, hasTlsSessionAccess } from './session-access.js';
import type { NativeSessionAccess } from './session-access.js';

export interface TlsConnectOptions extends SecureContextOptions {
    host?: string;
    port?: number;
    socket?: Socket;
    servername?: string;
    ALPNProtocols?: string[];
    /** Pre-built secure context from createSecureContext(). */
    secureContext?: SecureContext;
    /** Custom server-identity check (runs after the GnuTLS-level check). */
    checkServerIdentity?: (host: string, cert: PeerCertificate) => Error | undefined;
    /**
     * Previously serialized session blob to attempt resumption with.
     * Pulled from a prior connection's `'session'` event / `getSession()`.
     *
     * Silently ignored when {@link hasTlsSessionAccess} returns `false`
     * (no native bridge, or the GIO struct-layout work hasn't landed
     * yet) — the connection falls back to a full handshake.
     */
    session?: Buffer | Uint8Array;
}

/**
 * Internal cast for Socket's private-field shape. We own `node:net`'s
 * implementation (`@gjsify/net`), so reaching into `_connection` etc. is
 * a defined extension, not a private-API break. Exported for the
 * `connect.ts` + `tls-server.ts` modules that need to wire/read these fields.
 */
export interface SocketInternals {
    _connection: Gio.SocketConnection | null;
    _ioStream: Gio.IOStream | null;
    _inputStream: Gio.InputStream | null;
    _outputStream: Gio.OutputStream | null;
    _reading: boolean;
    _startReading(): void;
    /** In-flight Gio operations `_destroy` waits for before closing the connection. */
    _pendingIo: number;
    _ioSettled(): void;
    /** Cancelled by `destroy()`; guards every Gio operation on this socket. */
    _cancellable: Gio.Cancellable;
    /**
     * Stop the read loop and cancel any in-flight read, resolving once
     * settled — see `@gjsify/net`'s `Socket._detachReader()` for the full
     * contract. Used to hand an already-connected `net.Socket`'s Gio
     * connection off to a `TLSSocket` (`tls.connect({socket})` / STARTTLS).
     */
    _detachReader(): Promise<Buffer | null>;
    /**
     * Atomically null out the four stream fields above and return what
     * they were — see `@gjsify/net`'s `Socket._claimConnection()`. Call
     * SYNCHRONOUSLY within a 'connect'/'connection' listener to pre-empt
     * an auto-start that hasn't run yet (nulling `_inputStream` makes it
     * a no-op); pair with `_detachReader()` when a read may already be
     * running.
     */
    _claimConnection(): {
        connection: Gio.SocketConnection | null;
        ioStream: Gio.IOStream | null;
        inputStream: Gio.InputStream | null;
        outputStream: Gio.OutputStream | null;
    };
}

/**
 * Internal cast for the address/state fields `@types/node`'s `net.Socket`
 * type declares read-only (Node's own internals are the only writer).
 * `_adoptConnection` needs to copy them from the socket it's stealing the
 * connection from — same "we own the implementation" rationale as
 * {@link SocketInternals}, kept as a separate type since these fields
 * aren't Gio-facing.
 */
interface SocketAddressFields {
    remoteAddress?: string;
    remotePort?: number;
    remoteFamily?: string;
    localAddress?: string;
    localPort?: number;
    connecting: boolean;
    pending: boolean;
}

/**
 * TLSSocket wraps a net.Socket with TLS via Gio.TlsConnection.
 */
export class TLSSocket extends Socket {
    encrypted = true;
    authorized = false;
    authorizationError?: string;
    alpnProtocol: string | false = false;
    servername: string | undefined;

    /** @internal */
    _tlsConnection: Gio.TlsConnection | null = null;
    /** @internal — preserved for diagnostics + future cert-chain verification. */
    _secureContext: SecureContext | null = null;
    /**
     * @internal Lazily constructed Phase 2 session-access bridge for
     * this connection. Built on first call to a session/binding getter
     * (`_getSessionAccess()`), reused across subsequent calls.
     */
    _sessionAccess: NativeSessionAccess | null = null;

    /**
     * @internal Set while a `net.Socket` given to the constructor (or to
     * `tls.connect({socket})`) is being — or has been — adopted, so
     * `destroy()` can tear it down too. See `_startClient`.
     */
    _adoptedSocket: Socket | null = null;

    /**
     * @internal True from the moment a client handshake is scheduled
     * (`tls.connect()`, `new TLSSocket(socket)`) until `_setupTlsStreams()`
     * wires the encrypted streams. While set, `_write`/`_final` wait in
     * `_afterSecure` instead of reaching the plaintext transport — Node
     * buffers `tls.connect(...).write(req)` the same way.
     */
    _awaitingSecure = false;
    /** Writes/end() queued while `_awaitingSecure`; run in order once secure. */
    private _afterSecure: Array<{ run: () => void; abort: () => void }> = [];
    /**
     * The raw streams `_performHandshake` claimed, held here (not in a
     * closure) while the handshake runs so `_destroy` can hand them back to
     * `@gjsify/net`'s release path — otherwise a `destroy()` mid-handshake
     * leaked the descriptor.
     */
    private _handshakeClaim: ReturnType<SocketInternals['_claimConnection']> | null = null;
    /** Why 'accept-certificate' refused the peer, as Node's error code + message. */
    private _certRejection: { code: string; message: string } | null = null;

    constructor(socket?: Socket, options?: TlsConnectOptions) {
        super();
        if (socket) {
            this._startClient(socket, options ?? {});
        }
    }

    /**
     * @internal Adopt `providedSocket` — already connected, or still
     * connecting — as this TLSSocket's transport, then run the client TLS
     * handshake over it. Backs both `new tls.TLSSocket(socket, options)`
     * and `tls.connect({socket, ...})`: Node's `tls.connect` is a thin
     * wrapper over the TLSSocket constructor plus starting the handshake,
     * so we fold the two entry points together here instead of keeping
     * the handshake logic twice (see `connect.ts`).
     */
    private _startClient(providedSocket: Socket, options: TlsConnectOptions): void {
        this.servername = options.servername || options.host || 'localhost';
        this._adoptedSocket = providedSocket;
        this._awaitingSecure = true;

        // Destroying this TLSSocket also tears down the socket it borrowed
        // the connection from — mirrors Node's `TLSWrap.close()`, which
        // walks up to the wrapping net.Socket and destroys it while it
        // still owns the handle (`refs/node/lib/internal/tls/wrap.js`).
        // Harmless once the handshake has adopted the connection: by then
        // `providedSocket`'s stream fields are already null, so this is a
        // no-op close.
        this.once('close', () => {
            if (!providedSocket.destroyed) providedSocket.destroy();
        });

        const begin = (): void => {
            void this._adoptConnection(providedSocket).then((adopted) => {
                if (adopted) this._performHandshake(options);
            });
        };

        if (providedSocket.connecting) {
            providedSocket.once('connect', begin);
        } else {
            // Already connected — defer so the caller can finish wiring
            // listeners on the TLSSocket it just got back, mirroring
            // Node's `process.nextTick(initRead, this, socket)`.
            process.nextTick(begin);
        }
    }

    /**
     * @internal Detach `providedSocket`'s read loop (see
     * `SocketInternals._detachReader`) and steal its Gio connection/streams
     * onto `this`. Returns `false` — having already cleaned up — when
     * either socket was destroyed meanwhile, or when the detach lost the
     * race to data that had already arrived (see `_detachReader`'s doc):
     * `Gio.TlsClientConnection` has no API to replay bytes already pulled
     * off the wire, unlike Node's OpenSSL BIO, so that case is surfaced as
     * a destroy() error rather than silently dropped.
     *
     * Claims the streams (`_claimConnection`, nulling them on
     * `providedSocket`) SYNCHRONOUSLY, before the `_detachReader` await:
     * when `_startClient` runs this from `providedSocket`'s OWN 'connect'
     * listener (the still-connecting case), `Socket.connect()`'s
     * `_setupConnection()` is about to auto-start reading right after
     * 'connect' listeners finish — nulling `_inputStream` now makes that a
     * no-op instead of a second reader racing the handshake this method
     * goes on to start. For the already-connected case, a read may
     * already be running; `_detachReader()` (order relative to the claim
     * doesn't matter — the running loop holds its own local stream
     * reference, not `providedSocket`'s field) settles that.
     */
    private async _adoptConnection(providedSocket: Socket): Promise<boolean> {
        if (this.destroyed || providedSocket.destroyed) return false;
        const src = providedSocket as unknown as SocketInternals;

        // Node's real `tls.connect({socket})` accepts ANY Duplex; we can
        // only adopt a `@gjsify/net` Socket today — its Gio connection is
        // what gets handed to Gio.TlsClientConnection, and a foreign
        // Duplex has none. Feature-detect rather than let a bare
        // `_claimConnection is not a function` TypeError surface three
        // calls deep: reached in practice when a build aliases `node:tls`
        // to this polyfill but leaves `node:net` on a runtime's own
        // native module (e.g. `@gjsify/node-gi`'s consumer harness, which
        // forces `runtimes.node === "native"` deps onto their polyfill
        // body but `@gjsify/net` declares `"none"`, so it stays native —
        // see status/open-todos.md). Generic-Duplex support is tracked
        // there too.
        if (typeof src._claimConnection !== 'function' || typeof src._detachReader !== 'function') {
            this.destroy(_foreignSocketError());
            return false;
        }

        const claimed = src._claimConnection();
        const leftover = await src._detachReader();
        if (this.destroyed) {
            // Destroyed while we awaited: nothing was transplanted onto
            // `this`, and `providedSocket`'s own fields are already null
            // (claimed above), so it won't close this on its own destroy()
            // either — close it here or it leaks.
            try {
                (claimed.connection ?? claimed.ioStream)?.close(null);
            } catch {
                /* ignore */
            }
            return false;
        }
        if (leftover && leftover.length > 0) {
            this.destroy(_upgradeRaceError());
            try {
                (claimed.connection ?? claimed.ioStream)?.close(null);
            } catch {
                /* ignore */
            }
            return false;
        }

        const dst = this as unknown as SocketInternals;
        dst._connection = claimed.connection;
        dst._ioStream = claimed.ioStream;
        dst._inputStream = claimed.inputStream;
        dst._outputStream = claimed.outputStream;

        // `@types/node`'s net.Socket declares these read-only (only Node's
        // internals set them) — true of our own `@gjsify/net` Socket too
        // once type-checked against that ambient `node:net` shape (rather
        // than its own writable field declarations, visible only from
        // inside that package). Route the copy through the same
        // internal-field cast used for `_connection` etc. above.
        const dstAddr = this as unknown as SocketAddressFields;
        const srcAddr = providedSocket as unknown as SocketAddressFields;
        dstAddr.remoteAddress = srcAddr.remoteAddress;
        dstAddr.remotePort = srcAddr.remotePort;
        dstAddr.remoteFamily = srcAddr.remoteFamily;
        dstAddr.localAddress = srcAddr.localAddress;
        dstAddr.localPort = srcAddr.localPort;
        dstAddr.connecting = false;
        dstAddr.pending = false;
        return true;
    }

    /**
     * @internal Perform the client TLS handshake over this socket's Gio
     * connection — either self-connected via `tls.connect()` (no
     * `options.socket`), or just adopted from a caller-supplied
     * `net.Socket` via `_startClient()`. Moved here from `connect.ts` so
     * both entry points share one implementation.
     *
     * Reference: Node.js `lib/internal/tls/wrap.js` `TLSSocket.prototype._init`.
     */
    _performHandshake(options: TlsConnectOptions): void {
        const servername = this.servername || options.servername || options.host || 'localhost';
        this.servername = servername;
        const port = options.port || this.remotePort || 443;
        const rejectUnauthorized = options.rejectUnauthorized !== false;

        const ctx = options.secureContext ?? createSecureContext(options);
        this._secureContext = ctx;
        const customCheckServerIdentity = options.checkServerIdentity;

        // Claim (null out) this socket's OWN stream fields SYNCHRONOUSLY,
        // capturing `_connection` first: for the self-connect path (no
        // `options.socket`), this runs inside `connect()`'s 'connect'
        // listener, and `Socket.connect()`'s `_setupConnection()` is about
        // to auto-start reading right after 'connect' listeners finish —
        // that would start a second, conflicting reader on the same
        // Gio.InputStream `handshake_async()` below is about to read
        // from. For the given-socket path this is a harmless re-clear
        // (already claimed by `_adoptConnection`).
        const internals = this as unknown as SocketInternals;
        const claimed = internals._claimConnection();
        const rawConnection = claimed.connection;
        if (!rawConnection) {
            this.destroy(new Error('No underlying connection for TLS upgrade'));
            return;
        }
        // Held on `this` until the handshake settles — see `_handshakeClaim`
        // and `_destroy`.
        this._handshakeClaim = claimed;
        const fail = (err: unknown): void => {
            this.destroy(err instanceof Error ? err : new Error(String(err)));
        };

        try {
            const connectable = Gio.NetworkAddress.new(servername, port);
            const tlsConn = Gio.TlsClientConnection.new(rawConnection as unknown as Gio.IOStream, connectable);

            tlsConn.set_server_identity(connectable);

            // Session resumption: inject the prior session blob (if any)
            // BEFORE handshake_async() so GnuTLS can attempt resumption.
            // No-op when the native bridge isn't available; consumers get
            // a full handshake without error.
            if (options.session && hasTlsSessionAccess()) {
                try {
                    // Wire the TLS connection on this socket so
                    // `_getSessionAccess()` resolves a bridge bound to the
                    // same `tlsConn` we're about to handshake on.
                    this._tlsConnection = tlsConn;
                    this.setSession(options.session);
                } catch {
                    // Swallow — resumption is best-effort.
                }
            }

            // Client certificate (mTLS)
            if (ctx.certificate) {
                try {
                    tlsConn.set_certificate(ctx.certificate);
                } catch (err: unknown) {
                    console.warn('[tls] failed to set client certificate:', err);
                }
            }

            // ALPN — set_advertised_protocols is a plain property setter with
            // no throw path in the GIR; an ALPN-less backend just ignores it.
            if (options.ALPNProtocols && options.ALPNProtocols.length > 0) {
                tlsConn.set_advertised_protocols(options.ALPNProtocols);
            }

            // Certificate validation: by default rely on system trust store +
            // 'accept-certificate' returning false. With a custom CA we accept
            // peer certs that validate against `ctx.caCertificates`. With
            // `rejectUnauthorized: false`, accept everything.
            tlsConn.connect(
                'accept-certificate',
                (_conn: Gio.TlsConnection, peerCert: Gio.TlsCertificate, errors: Gio.TlsCertificateFlags): boolean => {
                    if (!rejectUnauthorized) return true;
                    let flags = errors;
                    for (const ca of ctx.caCertificates) {
                        try {
                            flags = peerCert.verify(connectable, ca);
                            if (flags === Gio.TlsCertificateFlags.NO_FLAGS) return true;
                        } catch {
                            /* try next */
                        }
                    }
                    this._certRejection = _certRejection(peerCert, flags, servername);
                    return false;
                },
            );

            // `this._cancellable` is what `destroy()` cancels, and the
            // pending-I/O count makes its release wait for this callback
            // before closing the raw connection (see `_destroy`).
            internals._pendingIo++;
            tlsConn.handshake_async(
                GLib.PRIORITY_DEFAULT,
                internals._cancellable,
                (_source: Gio.TlsConnection | null, asyncResult: Gio.AsyncResult) => {
                    let handshakeError: unknown = null;
                    try {
                        tlsConn.handshake_finish(asyncResult);
                    } catch (err: unknown) {
                        handshakeError = err;
                    }
                    // Destroyed while the handshake ran: `_destroy` already
                    // handed the raw streams back for release. Never emit
                    // 'secureConnect' after 'close'.
                    if (this.destroyed) {
                        internals._ioSettled();
                        return;
                    }
                    this._handshakeClaim = null;
                    internals._ioSettled();
                    if (handshakeError) {
                        this.authorized = false;
                        const rejection = this._certRejection;
                        const err = rejection
                            ? Object.assign(new Error(rejection.message), { code: rejection.code })
                            : handshakeError;
                        this.authorizationError = err instanceof Error ? err.message : String(err);
                        // The raw streams go back onto `this` so the release
                        // path closes them.
                        internals._connection = claimed.connection;
                        internals._ioStream = claimed.ioStream;
                        fail(err);
                        return;
                    }
                    this._secureEstablished(tlsConn, servername, rejectUnauthorized, customCheckServerIdentity);
                },
            );
        } catch (err: unknown) {
            fail(err);
        }
    }

    private _secureEstablished(
        tlsConn: Gio.TlsConnection,
        servername: string,
        rejectUnauthorized: boolean,
        customCheckServerIdentity: TlsConnectOptions['checkServerIdentity'],
    ): void {
        this.authorized = true;
        this._setupTlsStreams(tlsConn);
        this.alpnProtocol = this.getAlpnProtocol();

        // Custom server-identity check (post-handshake, mirrors Node).
        if (customCheckServerIdentity) {
            const peer = this.getPeerCertificate();
            const idErr = customCheckServerIdentity(servername, peer);
            if (idErr) {
                this.authorized = false;
                this.authorizationError = idErr.message;
                if (rejectUnauthorized) {
                    this.destroy(idErr);
                    return;
                }
            }
        }

        const internals = this as unknown as SocketInternals;
        internals._reading = false;
        internals._startReading();

        // Phase 2: emit 'session' after the handshake so consumers can cache
        // the session blob for the next connect call. No-op when the native
        // bridge is unavailable (`getSession()` returns undefined).
        if (hasTlsSessionAccess()) {
            const session = this.getSession();
            if (session) {
                this.emit('session', session);
            }
        }

        this.emit('secureConnect');
        this._flushAfterSecure();
    }

    override _write(chunk: unknown, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        if (this._awaitingSecure) {
            this._afterSecure.push({
                run: () => super._write(chunk, encoding, callback),
                abort: () => callback(_destroyedError()),
            });
            return;
        }
        super._write(chunk, encoding, callback);
    }

    private _flushAfterSecure(): void {
        const queued = this._afterSecure;
        this._afterSecure = [];
        for (const op of queued) op.run();
    }

    /**
     * Hands a mid-handshake connection back to `@gjsify/net`'s release path:
     * `super._destroy` cancels `_cancellable` (aborting `handshake_async`)
     * and, since the handshake counts as pending I/O, closes the restored
     * raw connection only once that callback has settled.
     */
    override _destroy(err: Error | null, callback: (error?: Error | null) => void): void {
        const claim = this._handshakeClaim;
        if (claim) {
            this._handshakeClaim = null;
            const internals = this as unknown as SocketInternals;
            internals._connection = claim.connection;
            internals._ioStream = claim.ioStream;
        }
        const queued = this._afterSecure;
        this._afterSecure = [];
        for (const op of queued) op.abort();
        super._destroy(err, callback);
    }

    /**
     * `end()` on a TLS socket must send TLS close_notify — the peer's TLS
     * layer only reports EOF on that alert, never on a bare TCP half-close.
     * `@gjsify/net`'s `_final` half-closes via `get_socket().shutdown()`,
     * which a `Gio.TlsConnection` (stored in `_connection`) doesn't have:
     * the call threw, was swallowed, and nothing reached the peer, so an
     * `end()` with the default `allowHalfOpen: false` on both sides waited
     * forever for the other side's 'end'. Closing the TLS output stream
     * sends close_notify and closes the base stream's write side
     * (glib-networking's `g_tls_connection_base_close_internal`), while
     * the read side stays open for the peer's reply.
     */
    override _final(callback: (error?: Error | null) => void): void {
        if (this._awaitingSecure) {
            // Node never runs `_final` after destroy; nothing to call back.
            this._afterSecure.push({ run: () => this._final(callback), abort: () => {} });
            return;
        }
        const tlsConn = this._tlsConnection;
        if (!tlsConn) {
            super._final(callback);
            return;
        }
        const internals = this as unknown as SocketInternals;
        const output = tlsConn.get_output_stream();
        // Counted as in-flight I/O so a concurrent `destroy()` defers closing
        // the connection until this close settles (a sync close while an
        // async one is pending fails with G_IO_ERROR_PENDING and leaks the fd).
        internals._pendingIo++;
        output.close_async(GLib.PRIORITY_DEFAULT, null, (_source: Gio.OutputStream | null, result: Gio.AsyncResult) => {
            try {
                output.close_finish(result);
            } catch {
                // The peer may already be gone (EPIPE/ECONNRESET on the
                // close_notify write) — not an error of end() itself, same
                // as `@gjsify/net`'s `_final` ignoring a failed shutdown.
            }
            internals._ioSettled();
            callback();
        });
    }

    /**
     * @internal Wire the TLS connection's I/O streams into this socket
     * so that read/write operations go through the encrypted channel.
     */
    _setupTlsStreams(tlsConn: Gio.TlsConnection): void {
        this._awaitingSecure = false;
        this._tlsConnection = tlsConn;
        const internals = this as unknown as SocketInternals;
        internals._inputStream = tlsConn.get_input_stream();
        internals._outputStream = tlsConn.get_output_stream();
        internals._connection = tlsConn as unknown as Gio.SocketConnection;
    }

    /**
     * @internal Build (or reuse) the `NativeSessionAccess` for this
     * TLS connection. Returns `null` when no TLS connection is wired
     * yet or the native typelib is unavailable.
     */
    _getSessionAccess(): NativeSessionAccess | null {
        if (this._sessionAccess) return this._sessionAccess;
        if (!this._tlsConnection) return null;
        try {
            this._sessionAccess = createSessionAccess(this._tlsConnection as unknown as never);
        } catch {
            this._sessionAccess = null;
        }
        return this._sessionAccess;
    }

    /**
     * Get the peer certificate. When `detailed` is true, walks the issuer chain
     * via `Gio.TlsCertificate.get_issuer()` and populates `issuerCertificate`
     * recursively (with a self-reference on the root for compatibility).
     */
    getPeerCertificate(detailed = false): PeerCertificate {
        if (!this._tlsConnection) return {};
        try {
            const cert = this._tlsConnection.get_peer_certificate();
            if (!cert) return {};
            return tlsCertToPeerCert(cert, detailed);
        } catch {
            return {};
        }
    }

    /**
     * Get the negotiated TLS protocol version.
     *
     * No try/catch here or in the two getters below: get_protocol_version,
     * get_ciphersuite_name and get_negotiated_protocol are plain GObject
     * property getters with no throw path in the GIR, and all exist since
     * GLib 2.70 (below our runtime floor).
     */
    getProtocol(): string | null {
        if (!this._tlsConnection) return null;
        const proto = this._tlsConnection.get_protocol_version();
        switch (proto) {
            case Gio.TlsProtocolVersion.TLS_1_0:
                return 'TLSv1';
            case Gio.TlsProtocolVersion.TLS_1_1:
                return 'TLSv1.1';
            case Gio.TlsProtocolVersion.TLS_1_2:
                return 'TLSv1.2';
            case Gio.TlsProtocolVersion.TLS_1_3:
                return 'TLSv1.3';
            default:
                return null;
        }
    }

    /** Get the negotiated cipher suite name + version. */
    getCipher(): { name: string; version: string } | null {
        if (!this._tlsConnection) return null;
        const name = this._tlsConnection.get_ciphersuite_name();
        return { name: name || 'unknown', version: this.getProtocol() || 'unknown' };
    }

    /** Get the negotiated ALPN protocol (or false if none). */
    getAlpnProtocol(): string | false {
        if (!this._tlsConnection) return false;
        const proto = this._tlsConnection.get_negotiated_protocol();
        return proto || false;
    }

    //
    // Surface mirrors Node's `tls.TLSSocket`. Each getter follows the
    // same pattern: gate on `hasTlsSessionAccess()` (returns `undefined`
    // / `false` when unavailable so consumers never see a thrown error
    // for the "feature not built in" case), then delegate to the
    // session-access bridge (which today throws — caught and converted
    // to `undefined` to keep the Node contract intact while the native
    // impl matures).

    /**
     * Get the local Finished message bytes (RFC 5246 §7.4.9) for use
     * as a `tls-unique` channel binding (RFC 5929 §3). Used by
     * SCRAM-SHA-* SASL mechanisms (RFC 5802 §6).
     *
     * Returns `undefined` when:
     *   - The handshake has not completed.
     *   - The native session-access bridge is not available
     *     ({@link hasTlsSessionAccess} returns `false`).
     *
     * On TLS 1.3 the underlying GnuTLS call returns the
     * `tls-exporter` (RFC 9266) bytes — the Node-compat `getFinished`
     * name is preserved but the semantics auto-degrade to the
     * version-appropriate binding.
     */
    getFinished(): Buffer | undefined {
        if (!hasTlsSessionAccess()) return undefined;
        const access = this._getSessionAccess();
        if (!access) return undefined;
        try {
            const bytes = access.get_finished();
            return _bytesToBuffer(bytes);
        } catch {
            return undefined;
        }
    }

    /**
     * Get the peer's Finished message bytes. Same TLS 1.3 fallback as
     * {@link getFinished}.
     */
    getPeerFinished(): Buffer | undefined {
        if (!hasTlsSessionAccess()) return undefined;
        const access = this._getSessionAccess();
        if (!access) return undefined;
        try {
            const bytes = access.get_peer_finished();
            return _bytesToBuffer(bytes);
        } catch {
            return undefined;
        }
    }

    /**
     * Get the serialized session for resumption. Suitable for caching
     * and feeding back into a future `tls.connect({session})` call.
     *
     * Returns `undefined` when the native session-access bridge is
     * not available.
     */
    getSession(): Buffer | undefined {
        if (!hasTlsSessionAccess()) return undefined;
        const access = this._getSessionAccess();
        if (!access) return undefined;
        try {
            const bytes = access.get_session_data();
            return _bytesToBuffer(bytes);
        } catch {
            return undefined;
        }
    }

    /**
     * Inject a previously serialized session blob. Must be called
     * BEFORE the handshake completes — typically Node consumers use
     * `tls.connect({session})` instead, which forwards here at the
     * right time.
     *
     * Silently no-ops when the native session-access bridge is not
     * available (matches Node's behavior on a build without session
     * support).
     */
    setSession(session: Buffer | Uint8Array): void {
        if (!hasTlsSessionAccess()) return;
        const access = this._getSessionAccess();
        if (!access) return;
        try {
            access.set_session_data(_bufferToBytes(session));
        } catch {
            // Swallow — Node also silently ignores setSession failures.
        }
    }

    /**
     * Returns `true` if this connection resumed an earlier session
     * (via session ID or ticket). `false` for fresh handshakes and
     * when the native bridge is unavailable.
     */
    isSessionReused(): boolean {
        if (!hasTlsSessionAccess()) return false;
        const access = this._getSessionAccess();
        if (!access) return false;
        try {
            return access.is_session_reused();
        } catch {
            return false;
        }
    }
}

/**
 * Error surfaced by `TLSSocket._adoptConnection()` when a caller-supplied
 * `net.Socket`'s read loop resolved with real data despite being told to
 * detach — i.e. the peer sent bytes before the client began the TLS
 * handshake. A well-behaved STARTTLS peer never does this (it waits for
 * the client to speak first, which is what makes STARTTLS work at all
 * without a receive-buffer API); Node can absorb the race because its
 * OpenSSL binding lets you feed it already-read bytes directly
 * (`initRead`'s `tlsSocket._handle.receive(buf)` in
 * `refs/node/lib/internal/tls/wrap.js`), but `Gio.TlsClientConnection`
 * owns and reads its base stream itself — there is no equivalent
 * "receive these bytes I already read" call to replay them into.
 */
/** Node's error for a write that a destroy aborted (`ERR_STREAM_DESTROYED`). */
function _destroyedError(): Error & { code: string } {
    const err = new Error('Cannot call write after a stream was destroyed') as Error & { code: string };
    err.code = 'ERR_STREAM_DESTROYED';
    return err;
}

/**
 * Map a refused peer certificate to the error Node's OpenSSL binding
 * reports, so callers can branch on the same `code` on both runtimes.
 */
function _certRejection(
    peerCert: Gio.TlsCertificate,
    flags: Gio.TlsCertificateFlags,
    servername: string,
): { code: string; message: string } {
    if (flags & Gio.TlsCertificateFlags.BAD_IDENTITY) {
        return {
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
            message: `Hostname/IP does not match certificate's altnames: Host: ${servername}. is not in the cert's altnames`,
        };
    }
    if (flags & Gio.TlsCertificateFlags.EXPIRED) {
        return { code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' };
    }
    if (flags & Gio.TlsCertificateFlags.NOT_ACTIVATED) {
        return { code: 'CERT_NOT_YET_VALID', message: 'certificate is not yet valid' };
    }
    if (peerCert.subjectName && peerCert.subjectName === peerCert.issuerName) {
        return { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed certificate' };
    }
    return { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' };
}

function _upgradeRaceError(): Error & { code: string } {
    const err = new Error(
        'tls: data arrived on the socket before the TLS handshake could take over reading its ' +
            'input stream — Gio.TlsClientConnection has no API to replay already-read bytes into ' +
            'the handshake. This should not happen for a well-behaved STARTTLS peer.',
    ) as Error & { code: string };
    err.code = 'ERR_GJSIFY_TLS_UPGRADE_RACE';
    return err;
}

/**
 * Error surfaced by `TLSSocket._adoptConnection()` when `options.socket` /
 * the constructor's `socket` argument doesn't carry a `@gjsify/net` Gio
 * connection (`_claimConnection`/`_detachReader` missing). Node's real
 * `tls.connect({socket})` accepts any Duplex; adopting a foreign one needs
 * a Duplex→Gio.IOStream adapter this package doesn't have yet — tracked in
 * status/open-todos.md, next to the SNI-peek entry.
 */
function _foreignSocketError(): Error & { code: string } {
    const err = new Error(
        'tls.connect({socket}) / new tls.TLSSocket(socket, …) can only upgrade a @gjsify/net ' +
            "Socket today — the given socket doesn't carry the Gio connection needed to build a " +
            "Gio.TlsClientConnection. Generic Duplex support (Node's real contract) is tracked in " +
            'status/open-todos.md.',
    ) as Error & { code: string };
    err.code = 'ERR_GJSIFY_TLS_FOREIGN_SOCKET';
    return err;
}

/**
 * Coerce a value returned by the native bridge (GLib.Bytes, raw
 * Uint8Array, or null) to a Node `Buffer | undefined`. The native
 * bridge currently always throws — when the real implementation
 * lands it will return a `GLib.Bytes`. Both `toArray()` (GLib.Bytes
 * shape under gjs) and raw Uint8Array paths are handled here so the
 * flip is transparent.
 */
function _bytesToBuffer(value: unknown): Buffer | undefined {
    if (value == null) return undefined;
    // Buffer extends Uint8Array → this branch handles both.
    if (value instanceof Uint8Array) return Buffer.from(value);
    // GLib.Bytes from gjs surfaces `toArray()` returning a Uint8Array.
    const maybe = value as { toArray?: () => Uint8Array };
    if (typeof maybe.toArray === 'function') {
        try {
            return Buffer.from(maybe.toArray());
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/**
 * Coerce a `Buffer | Uint8Array` into the shape the native bridge
 * expects. Today the bridge throws before reading the argument; the
 * conversion path is wired up now so the flip is transparent.
 *
 * gjs auto-coerces a JS Uint8Array to `uint8[]` for Vala out-params
 * + to `GLib.Bytes` when the parameter type is `GLib.Bytes`. We hand
 * the bridge a Uint8Array view (zero-copy for Node Buffer's underlying
 * ArrayBuffer) and let gjs do the conversion.
 */
function _bufferToBytes(value: Buffer | Uint8Array): Uint8Array {
    // Buffer extends Uint8Array → return as-is. Note the order matters
    // ONLY if we ever want to special-case a Buffer; today's bridge
    // signature is the same for both.
    return value;
}
