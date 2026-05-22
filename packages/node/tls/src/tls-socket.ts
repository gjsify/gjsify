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

import Gio from '@girs/gio-2.0';
import { Socket } from 'node:net';
import { tlsCertToPeerCert, type PeerCertificate } from './internal/cert-utils.js';
import type { SecureContext, SecureContextOptions } from './secure-context.js';

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

    constructor(_socket?: Socket, _options?: SecureContextOptions) {
        super();
    }

    /**
     * @internal Wire the TLS connection's I/O streams into this socket
     * so that read/write operations go through the encrypted channel.
     */
    _setupTlsStreams(tlsConn: Gio.TlsConnection): void {
        this._tlsConnection = tlsConn;
        const internals = this as unknown as SocketInternals;
        internals._inputStream = tlsConn.get_input_stream();
        internals._outputStream = tlsConn.get_output_stream();
        internals._connection = tlsConn as unknown as Gio.SocketConnection;
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

    /** Get the negotiated TLS protocol version. */
    getProtocol(): string | null {
        if (!this._tlsConnection) return null;
        try {
            const proto = this._tlsConnection.get_protocol_version();
            switch (proto) {
                case Gio.TlsProtocolVersion.TLS_1_0: return 'TLSv1';
                case Gio.TlsProtocolVersion.TLS_1_1: return 'TLSv1.1';
                case Gio.TlsProtocolVersion.TLS_1_2: return 'TLSv1.2';
                case Gio.TlsProtocolVersion.TLS_1_3: return 'TLSv1.3';
                default: return null;
            }
        } catch {
            return null;
        }
    }

    /** Get the negotiated cipher suite name + version. */
    getCipher(): { name: string; version: string } | null {
        if (!this._tlsConnection) return null;
        try {
            const name = this._tlsConnection.get_ciphersuite_name();
            return { name: name || 'unknown', version: this.getProtocol() || 'unknown' };
        } catch {
            return null;
        }
    }

    /** Get the negotiated ALPN protocol (or false if none). */
    getAlpnProtocol(): string | false {
        if (!this._tlsConnection) return false;
        try {
            const proto = this._tlsConnection.get_negotiated_protocol();
            return proto || false;
        } catch {
            return false;
        }
    }
}
