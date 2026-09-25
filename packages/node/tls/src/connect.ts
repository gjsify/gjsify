// tls.connect — TLS client. Either opens a TCP socket via @gjsify/net and
// upgrades it to TLS (no `options.socket`), or adopts a caller-supplied,
// already-connected/connecting `net.Socket` and upgrades THAT (STARTTLS —
// see `TLSSocket._startClient`/`_adoptConnection` in `tls-socket.ts`, where
// both entry points now share one implementation). Upgrade is via
// Gio.TlsClientConnection (with optional mTLS + ALPN + custom CA), then
// emits 'secureConnect' on the returned TLSSocket.
//
// Reference: Node.js lib/internal/tls/wrap.js `tls.connect` — a thin
// wrapper over `new TLSSocket(options.socket, opts)` plus starting the
// handshake, which is exactly the shape kept here.

import { TLSSocket, type TlsConnectOptions } from './tls-socket.js';

/**
 * Create a TLS client connection.
 *
 * Without `options.socket`: connects via TCP first (net.Socket.connect on
 * the TLSSocket itself), then upgrades to TLS once connected.
 *
 * With `options.socket`: adopts that already-connected (or still
 * connecting) `net.Socket` and upgrades it in place — the STARTTLS shape
 * (`@xmpp/starttls`, SMTP `STARTTLS`, IMAP `STARTTLS`, …): the caller has
 * already exchanged some plaintext over the socket and is now handing it
 * over for the TLS handshake to take over reading/writing.
 */
export function connect(options: TlsConnectOptions, callback?: () => void): TLSSocket {
    const providedSocket = options.socket;
    const socket = new TLSSocket(providedSocket, options);

    if (callback) {
        socket.once('secureConnect', callback);
    }

    if (!providedSocket) {
        const port = options.port || 443;
        const host = options.host || 'localhost';
        socket.servername = options.servername || host;
        socket.once('connect', () => socket._performHandshake(options));
        socket.connect({ port, host });
    }
    // With `options.socket`, the constructor (via `_startClient`) has
    // already begun adopting the connection and will call
    // `_performHandshake` once it's ready.

    return socket;
}
