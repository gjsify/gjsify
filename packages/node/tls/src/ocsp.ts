// OCSP-response parsing re-exports from @gjsify/tls-native.
//
// Surface for the common consumer flow:
//   1. Fetch an OCSP response from the cert's Authority Information Access
//      (AIA) OCSP responder URL (typically via @gjsify/fetch HTTP POST with
//      Content-Type: application/ocsp-request, body = DER-encoded
//      OCSPRequest).
//   2. Parse the DER bytes via parseOcspResponse() to inspect status,
//      validity window, and (if revoked) revocation time + reason.
//
// The actual parsing runs in the @gjsify/tls-native Vala bridge, which
// wraps GnuTLS's gnutls_ocsp_resp_* APIs (not exposed by Gio.TlsConnection).
// On Node and on GJS without the native prebuild installed, hasOcspSupport()
// returns false and parseOcspResponse() throws a clear error — callers
// should gate with hasOcspSupport() and fall back to whatever the
// no-OCSP path is (typically: skip the extra revocation check).

export type {
    OcspResponseInfo,
} from '@gjsify/tls-native';

export {
    OcspCertStatus,
    OcspResponseStatus,
} from '@gjsify/tls-native';

import {
    parseOcspResponse as _parseOcspResponse,
    hasNativeTls as _hasNativeTls,
    type OcspResponseInfo as _OcspResponseInfo,
} from '@gjsify/tls-native';

/**
 * Returns true when OCSP-response parsing is available — i.e. when the
 * @gjsify/tls-native Vala+GnuTLS bridge is loaded. Always false on Node
 * (the native prebuild is GJS-only).
 */
export function hasOcspSupport(): boolean {
    return _hasNativeTls();
}

/**
 * Parse a DER-encoded OCSP response (RFC 6960).
 *
 * Returns null when the bytes don't parse as an OCSPResponse (init / import
 * errors inside GnuTLS). Throws when OCSP support is not available — gate
 * the call with hasOcspSupport() to detect that case at runtime.
 *
 * @param bytes  DER-encoded OCSPResponse bytes (typically the body of a
 *               POST response from the cert's AIA OCSP responder URL).
 */
export function parseOcspResponse(bytes: Uint8Array): _OcspResponseInfo | null {
    return _parseOcspResponse(bytes);
}
