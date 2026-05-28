// @gjsify/tls-native — optional GjsifyTls GI module loader.
//
// Uses GJS's legacy `imports.gi` API (synchronous) rather than `gi://` ESM
// so the loader stays usable from both library code and runtime entry points.
// The try/catch provides graceful degradation: if the typelib is not in
// `GI_TYPELIB_PATH` the module simply isn't available — `hasNativeTls()`
// returns `false` and callers fall back to whatever the GnuTLS-less code
// path is (typically: feature unsupported, raise a clear error).

/** Parsed OCSP response from `Tls.parse_ocsp_response`. Mirrors the
 *  GObject properties exposed by `GjsifyTls.OcspResponseInfo`. */
export interface OcspResponseInfo {
    /**
     * `responseStatus` per RFC 6960 §4.2.1.
     *   0 = successful
     *   1 = malformedRequest
     *   2 = internalError
     *   3 = tryLater
     *   5 = sigRequired
     *   6 = unauthorized
     */
    responseStatus: number;

    /** `producedAt` (Unix seconds, 0 if unparseable). */
    producedAt: number;

    /**
     * `certStatus` per RFC 6960 §4.2.1.
     *   0 = good
     *   1 = revoked
     *   2 = unknown
     */
    certStatus: number;

    /** `thisUpdate` (Unix seconds). */
    thisUpdate: number;

    /** `nextUpdate` (Unix seconds, 0 if absent). */
    nextUpdate: number;

    /** `revocationTime` (Unix seconds, only meaningful when certStatus=1). */
    revocationTime: number;

    /** `revocationReason` per RFC 5280 §5.3.1 CRL reason codes; meaningful
     *  only when certStatus=1. */
    revocationReason: number;
}

/** Native handle returned by `imports.gi.GjsifyTls`. The shape mirrors
 *  the GIR — `OcspResponseInfo` properties are exposed in camelCase via
 *  GObject's automatic property accessor lowering on the GJS side. */
export interface NativeTls {
    /**
     * Parse a DER-encoded OCSP response (RFC 6960). Returns `null` when
     * the bytes are not a valid response (init / import errors).
     */
    parse_ocsp_response(bytes: Uint8Array): OcspResponseInfo | null;
}

/**
 * Symbolic channel-binding type per RFC 5929 / RFC 9266.
 *
 * Mirrors `GjsifyTls.ChannelBindingType` in the GIR. Values are stable
 * across GnuTLS / OpenSSL / Node — the RFCs assign them implicitly via
 * the wire-protocol identifier ("tls-unique", "tls-server-end-point",
 * "tls-exporter").
 */
export const TlsChannelBindingType = {
    /** `tls-unique` (RFC 5929 §3) — TLS 1.0–1.2 only. */
    TLS_UNIQUE: 0,
    /** `tls-server-end-point` (RFC 5929 §4) — hash of the server cert. */
    TLS_SERVER_END_POINT: 1,
    /** `tls-exporter` (RFC 9266) — TLS 1.3 replacement for `tls-unique`. */
    TLS_EXPORTER: 2,
} as const;
export type TlsChannelBindingType = (typeof TlsChannelBindingType)[keyof typeof TlsChannelBindingType];

/**
 * Minimal Gio.TlsConnection shape — typed structurally so this module
 * doesn't take a value-level dep on `@girs/gio-2.0` (would force every
 * consumer to install the GIR-types package even on Node). Real
 * connections come from `@gjsify/tls`'s `TLSSocket._tlsConnection`.
 */
export interface TlsConnectionHandle {
    /** Tag for type-narrowing — present on real Gio.TlsConnection. */
    __isTlsConnection?: never;
}

/**
 * Native SessionAccess wrapper (Phase 2 POC).
 *
 * Mirrors `GjsifyTls.SessionAccess` from the GIR. Every method currently
 * throws a GLib.Error with domain `gjsify-tls-session-access-error-quark`
 * and code `NOT_SUPPORTED` — see `docs/poc/tls-phase2-session-access.md`
 * for the open struct-layout question gating the real implementation.
 *
 * The shape is locked in now so flipping the native side from
 * throw → real is a transparent change for JS callers.
 */
export interface NativeSessionAccess {
    /** `gnutls_session_is_resumed` — true if the session was resumed. */
    is_session_reused(): boolean;
    /** `gnutls_session_get_data2` — serialized session blob. */
    get_session_data(): unknown;
    /** `gnutls_session_set_data` — inject a session blob before handshake. */
    set_session_data(data: unknown): void;
    /** `gnutls_session_channel_binding` for a specific binding type. */
    get_channel_binding(binding: TlsChannelBindingType): unknown;
    /** Convenience: TLS-Finished bytes we sent (Node compat). */
    get_finished(): unknown;
    /** Convenience: TLS-Finished bytes the peer sent (Node compat). */
    get_peer_finished(): unknown;
    /** Negotiated protocol version as a stable string. */
    get_negotiated_protocol_version(): string;
}

/** Native `SessionAccess` class constructor surface (GIR static methods). */
export interface NativeSessionAccessClass {
    /**
     * Returns whether the native session access layer is functional.
     * Currently always `false` — see `hasTlsSessionAccess()` for the
     * preferred predicate that callers should use.
     */
    is_supported(): boolean;
    /**
     * Build a SessionAccess for a live `Gio.TlsConnection`. Returns
     * `null` if @connection is `null`.
     */
    for_connection(connection: TlsConnectionHandle | null): NativeSessionAccess | null;
}

export interface GjsifyTlsModule {
    Tls: NativeTls;
    SessionAccess: NativeSessionAccessClass;
    ChannelBindingType: typeof TlsChannelBindingType;
}

// Synchronous optional load via GJS legacy imports API.
let _mod: GjsifyTlsModule | null = null;

/** Module-local typed view of the GJS legacy `imports.gi` host slot. */
interface _GjsImportsHost {
    imports?: { gi?: Record<string, unknown> };
}

const _gi: Record<string, unknown> | undefined = (globalThis as unknown as _GjsImportsHost).imports?.gi;
if (_gi) {
    try {
        _mod = _gi['GjsifyTls'] as GjsifyTlsModule;
    } catch {
        // GjsifyTls typelib not installed — feature unsupported by this
        // runtime; consumers should check `hasNativeTls()` before calling.
    }
}

/** The native GjsifyTls module, or `null` if not installed. */
export const nativeTls: GjsifyTlsModule | null = _mod;

/** Returns `true` when the GjsifyTls native library is available. */
export function hasNativeTls(): boolean {
    return _mod !== null;
}

/**
 * Parse a DER-encoded OCSP response (RFC 6960).
 *
 * Throws when `@gjsify/tls-native`'s typelib is not loaded — callers can
 * gate with `hasNativeTls()` and fall back to a pure-JS path (no such path
 * exists today; OCSP parsing requires either the GnuTLS bridge here or a
 * full RFC 6960 ASN.1 decoder).
 *
 * @param bytes  DER-encoded OCSPResponse bytes (typically the body of a
 *               POST response from the cert's AIA OCSP responder URL).
 * @returns      Parsed response on success, `null` when the bytes don't
 *               parse as an OCSPResponse.
 */
export function parseOcspResponse(bytes: Uint8Array): OcspResponseInfo | null {
    if (!_mod) {
        throw new Error('@gjsify/tls-native: native typelib not loaded. Check hasNativeTls() first.');
    }
    return _mod.Tls.parse_ocsp_response(bytes);
}

/**
 * Symbolic OCSP cert-status values per RFC 6960 §4.2.1. Use as
 * `OcspCertStatus.GOOD` for readable comparisons.
 */
export const OcspCertStatus = {
    GOOD: 0,
    REVOKED: 1,
    UNKNOWN: 2,
} as const;
export type OcspCertStatus = (typeof OcspCertStatus)[keyof typeof OcspCertStatus];

/**
 * Symbolic OCSP responseStatus values per RFC 6960 §4.2.1.
 */
export const OcspResponseStatus = {
    SUCCESSFUL: 0,
    MALFORMED_REQUEST: 1,
    INTERNAL_ERROR: 2,
    TRY_LATER: 3,
    SIG_REQUIRED: 5,
    UNAUTHORIZED: 6,
} as const;
export type OcspResponseStatus = (typeof OcspResponseStatus)[keyof typeof OcspResponseStatus];

// ─── Phase 2: SessionAccess (POC scaffold) ─────────────────────────────────

/**
 * Returns `true` when the Phase 2 session-access bridge is functional.
 *
 * Today this always returns `false` even when the native typelib is
 * loaded — the underlying gnutls_session_t extraction from
 * `Gio.TlsConnection` is not yet implemented. See
 * `docs/poc/tls-phase2-session-access.md` for the open question.
 *
 * Callers (e.g. `@gjsify/tls`'s `TLSSocket.getFinished()`) should gate
 * with this predicate so consumers can detect "not supported on this
 * platform / version" without triggering a thrown error.
 *
 * When the native side becomes functional this predicate flips to
 * `true` automatically (it reads `GjsifyTls.SessionAccess.is_supported()`).
 */
export function hasTlsSessionAccess(): boolean {
    if (!_mod) return false;
    try {
        return _mod.SessionAccess.is_supported();
    } catch {
        return false;
    }
}

/**
 * Build a {@link NativeSessionAccess} wrapper around a live
 * `Gio.TlsConnection`. Returns `null` if @connection is `null` or
 * the native typelib is unavailable.
 *
 * The returned object's methods THROW until {@link hasTlsSessionAccess}
 * starts returning `true` — surface stays stable across the impl flip.
 */
export function createSessionAccess(connection: TlsConnectionHandle | null): NativeSessionAccess | null {
    if (!_mod) return null;
    return _mod.SessionAccess.for_connection(connection);
}
