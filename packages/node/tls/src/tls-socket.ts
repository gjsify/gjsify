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
import { Buffer } from 'node:buffer';
import { Socket } from 'node:net';
import { tlsCertToPeerCert, type PeerCertificate } from './internal/cert-utils.js';
import type { SecureContext, SecureContextOptions } from './secure-context.js';
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

    // ──── Phase 2: session resumption + channel binding ────
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

// ─── Phase 2 helpers ──────────────────────────────────────────────────────

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
