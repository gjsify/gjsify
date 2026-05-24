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

export interface GjsifyTlsModule {
    Tls: NativeTls;
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
