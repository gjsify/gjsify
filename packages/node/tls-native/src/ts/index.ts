// @gjsify/tls-native — optional GjsifyTls GI module loader.
//
// Loads via the legacy synchronous `imports.gi` rather than `gi://` ESM so the
// loader works from both library code and runtime entry points. Absent typelib
// is not an error: `hasNativeTls()` returns `false` and callers degrade.

/** Parsed OCSP response from `Tls.parse_ocsp_response`. */
export interface OcspResponseInfo {
    /** `responseStatus` per RFC 6960 §4.2.1 — see {@link OcspResponseStatus}. */
    responseStatus: number;

    /** `producedAt` (Unix seconds, 0 if unparseable). */
    producedAt: number;

    /** `certStatus` per RFC 6960 §4.2.1 — see {@link OcspCertStatus}. */
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

/** Native handle from `imports.gi.GjsifyTls`. `OcspResponseInfo` properties
 *  arrive camelCased via GObject's property-accessor lowering in GJS. */
export interface NativeTls {
    /** Returns `null` when the bytes are not a valid OCSP response. */
    parse_ocsp_response(bytes: Uint8Array): OcspResponseInfo | null;
}

/** Channel-binding type per RFC 5929 / RFC 9266; mirrors
 *  `GjsifyTls.ChannelBindingType`. */
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
 * Minimal Gio.TlsConnection shape — typed structurally so this module takes no
 * value-level dep on `@girs/gio-2.0`, which would force the GIR-types package
 * on every consumer, Node included. Real connections come from `@gjsify/tls`'s
 * `TLSSocket._tlsConnection`.
 */
export interface TlsConnectionHandle {
    /** Tag for type-narrowing — present on real Gio.TlsConnection. */
    __isTlsConnection?: never;
}

/**
 * Native SessionAccess wrapper, mirroring `GjsifyTls.SessionAccess`.
 *
 * On a non-GnuTLS GIO TLS backend every method throws a GLib.Error with
 * domain `gjsify-tls-session-access-error-quark`, code `NOT_SUPPORTED`.
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
    /** True when the GnuTLS session bridge works here; prefer the
     *  {@link hasTlsSessionAccess} wrapper, which tolerates a missing typelib. */
    is_supported(): boolean;
    /** Returns `null` if @connection is `null`. */
    for_connection(connection: TlsConnectionHandle | null): NativeSessionAccess | null;
}

export interface GjsifyTlsModule {
    Tls: NativeTls;
    SessionAccess: NativeSessionAccessClass;
    ChannelBindingType: typeof TlsChannelBindingType;
}

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
        // Typelib not installed — consumers gate on `hasNativeTls()`.
    }
}

/** The native GjsifyTls module, or `null` if not installed. */
export const nativeTls: GjsifyTlsModule | null = _mod;

/** Returns `true` when the GjsifyTls native library is available. */
export function hasNativeTls(): boolean {
    return _mod !== null;
}

/**
 * Parse a DER-encoded OCSPResponse (RFC 6960) — typically the body of a POST to
 * the cert's AIA responder URL. `null` when the bytes do not parse.
 *
 * Throws without the typelib; gate on `hasNativeTls()`. There is no pure-JS
 * fallback — the alternative would be a full RFC 6960 ASN.1 decoder.
 */
export function parseOcspResponse(bytes: Uint8Array): OcspResponseInfo | null {
    if (!_mod) {
        throw new Error('@gjsify/tls-native: native typelib not loaded. Check hasNativeTls() first.');
    }
    return _mod.Tls.parse_ocsp_response(bytes);
}

/** OCSP cert-status values per RFC 6960 §4.2.1. */
export const OcspCertStatus = {
    GOOD: 0,
    REVOKED: 1,
    UNKNOWN: 2,
} as const;
export type OcspCertStatus = (typeof OcspCertStatus)[keyof typeof OcspCertStatus];

/** OCSP responseStatus values per RFC 6960 §4.2.1. */
export const OcspResponseStatus = {
    SUCCESSFUL: 0,
    MALFORMED_REQUEST: 1,
    INTERNAL_ERROR: 2,
    TRY_LATER: 3,
    SIG_REQUIRED: 5,
    UNAUTHORIZED: 6,
} as const;
export type OcspResponseStatus = (typeof OcspResponseStatus)[keyof typeof OcspResponseStatus];

/**
 * Returns `true` when the session-access bridge works on this host: it needs the
 * typelib AND glib-networking's GnuTLS backend, whose private struct the C shim
 * reads (`docs/poc/tls-phase2-session-access.md`).
 *
 * Callers such as `@gjsify/tls`'s `TLSSocket.getFinished()` gate on this so an
 * unsupported backend degrades to Node's no-session contract instead of throwing.
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
 * Wrap a live `Gio.TlsConnection`. `null` if @connection is `null` or the native
 * typelib is unavailable; the returned methods throw `NOT_SUPPORTED` unless
 * {@link hasTlsSessionAccess} is `true`.
 */
export function createSessionAccess(connection: TlsConnectionHandle | null): NativeSessionAccess | null {
    if (!_mod) return null;
    return _mod.SessionAccess.for_connection(connection);
}
