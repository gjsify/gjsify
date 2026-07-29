// tls.connect — TLS client. Opens a TCP socket via @gjsify/net, upgrades it
// to TLS via Gio.TlsClientConnection (with optional mTLS + ALPN + custom CA),
// then emits 'secureConnect' on the returned TLSSocket.
//
// Reference: Node.js lib/_tls_wrap.js `TLSSocket.prototype._init` +
// lib/_tls_common.js. Gio-mapping notes live at the top of `index.ts`.
//
// Phase 2 hooks: when `options.session` is provided AND the native
// session-access bridge is functional ({@link hasTlsSessionAccess}),
// the session blob is injected BEFORE `handshake_async()` so GnuTLS
// can attempt resumption. After the handshake completes, a `'session'`
// event is emitted on the socket with the fresh session blob — Node
// consumers cache this for subsequent connect calls. Both paths are
// no-ops when the bridge isn't available, matching Node's behavior
// on a build without session support.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { TLSSocket, type SocketInternals, type TlsConnectOptions } from './tls-socket.js';
import { createSecureContext } from './secure-context.js';
import { hasTlsSessionAccess } from './session-access.js';

/**
 * Create a TLS client connection.
 *
 * Connects via TCP first (using net.Socket.connect), then upgrades
 * the connection to TLS using Gio.TlsClientConnection.
 */
export function connect(options: TlsConnectOptions, callback?: () => void): TLSSocket {
    const socket = new TLSSocket(undefined, options);

    if (callback) {
        socket.once('secureConnect', callback);
    }

    const port = options.port || 443;
    const host = options.host || 'localhost';
    const servername = options.servername || host;
    const rejectUnauthorized = options.rejectUnauthorized !== false;

    const ctx = options.secureContext ?? createSecureContext(options);
    socket._secureContext = ctx;
    socket.servername = servername;
    const customCheckServerIdentity = options.checkServerIdentity;

    socket.once('connect', () => {
        const rawConnection = (socket as unknown as SocketInternals)._connection;
        if (!rawConnection) {
            socket.destroy(new Error('No underlying connection for TLS upgrade'));
            return;
        }

        try {
            const connectable = Gio.NetworkAddress.new(servername, port);
            const tlsConn = Gio.TlsClientConnection.new(rawConnection as unknown as Gio.IOStream, connectable);

            tlsConn.set_server_identity(connectable);

            // Session resumption: inject the prior session blob (if any)
            // BEFORE handshake_async() so GnuTLS can attempt resumption.
            // No-op when the native bridge isn't available; consumers
            // get a full handshake without error.
            //
            // We route through `socket.setSession(...)` (rather than
            // calling the native access directly) so the Buffer →
            // GLib.Bytes coercion lives in ONE place — `tls-socket.ts`'s
            // `_bufferToBytes` helper. The setSession path also no-ops
            // gracefully when `hasTlsSessionAccess()` is false, so the
            // outer guard is belt-and-suspenders.
            if (options.session && hasTlsSessionAccess()) {
                try {
                    // Wire the TLS connection on the socket so
                    // `_getSessionAccess()` resolves a bridge bound to
                    // the same `tlsConn` we're about to handshake on.
                    socket._tlsConnection = tlsConn;
                    socket.setSession(options.session);
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

            // ALPN
            if (options.ALPNProtocols && options.ALPNProtocols.length > 0) {
                try {
                    tlsConn.set_advertised_protocols(options.ALPNProtocols);
                } catch {
                    // ALPN may not be supported
                }
            }

            // Certificate validation: by default rely on system trust store +
            // 'accept-certificate' returning false. With a custom CA we accept
            // peer certs that validate against `ctx.caCertificates`. With
            // `rejectUnauthorized: false`, accept everything.
            tlsConn.connect(
                'accept-certificate',
                (_conn: Gio.TlsConnection, peerCert: Gio.TlsCertificate, _errors: Gio.TlsCertificateFlags): boolean => {
                    if (!rejectUnauthorized) return true;
                    if (ctx.caCertificates.length === 0) return false;
                    for (const ca of ctx.caCertificates) {
                        try {
                            const flags = peerCert.verify(connectable, ca);
                            if (flags === Gio.TlsCertificateFlags.NO_FLAGS) return true;
                        } catch {
                            /* try next */
                        }
                    }
                    return false;
                },
            );

            const cancellable = new Gio.Cancellable();
            tlsConn.handshake_async(
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (_source: Gio.TlsConnection | null, asyncResult: Gio.AsyncResult) => {
                    try {
                        tlsConn.handshake_finish(asyncResult);
                        socket.authorized = true;
                        socket._setupTlsStreams(tlsConn);
                        socket.alpnProtocol = socket.getAlpnProtocol();

                        // Custom server-identity check (post-handshake, mirrors Node).
                        if (customCheckServerIdentity) {
                            const peer = socket.getPeerCertificate();
                            const idErr = customCheckServerIdentity(servername, peer);
                            if (idErr) {
                                socket.authorized = false;
                                socket.authorizationError = idErr.message;
                                if (rejectUnauthorized) {
                                    socket.destroy(idErr);
                                    return;
                                }
                            }
                        }

                        const internals = socket as unknown as SocketInternals;
                        internals._reading = false;
                        internals._startReading();

                        // Phase 2: emit 'session' after the handshake so
                        // consumers can cache the session blob for the
                        // next connect call. No-op when the native bridge
                        // is unavailable (`getSession()` returns undefined).
                        // Node fires this once per new session ticket; the
                        // POC fires once post-handshake. The full event
                        // semantics (multiple tickets per connection, the
                        // 'new-session-ticket' callback signal proxy)
                        // arrive when the GIO struct-layout work lands.
                        if (hasTlsSessionAccess()) {
                            const session = socket.getSession();
                            if (session) {
                                socket.emit('session', session);
                            }
                        }

                        socket.emit('secureConnect');
                    } catch (err: unknown) {
                        socket.authorized = false;
                        socket.authorizationError = err instanceof Error ? err.message : String(err);
                        if (rejectUnauthorized) {
                            socket.destroy(err instanceof Error ? err : new Error(String(err)));
                        } else {
                            socket._setupTlsStreams(tlsConn);
                            socket.emit('secureConnect');
                        }
                    }
                },
            );
        } catch (err: unknown) {
            socket.destroy(err instanceof Error ? err : new Error(String(err)));
        }
    });

    socket.connect({ port, host });
    return socket;
}
