/*
 * GjsifyTls — Vala/GObject bridge for GnuTLS APIs that Gio.TlsConnection
 * does not surface to JS.
 *
 * Phase 1 scope (this file): OCSP-response parsing (RFC 6960).
 *
 *   Status of GnuTLS bindings in Vala 0.56:
 *     - `gnutls.vapi` covers the core handshake / X.509 / pubkey surface
 *       but has *no* `gnutls_ocsp_*` declarations. We supply them in a
 *       sibling `gnutls-ocsp.vapi`, which the meson rule loads via
 *       `--vapidir`. `.vapi` files (vs `.vala`) declare existing C types
 *       without re-emitting the typedef — the `cname = "struct gnutls_…"`
 *       pattern that works in vapi headers crashes in `.vala` because
 *       valac there tries to define the type.
 *
 * Future scope (not in this file yet):
 *   - Session resumption: `gnutls_session_get_data2` / `set_data` —
 *     blocked on extracting the live `gnutls_session_t` from
 *     `Gio.TlsConnection`. Tracked in STATUS.md.
 *   - Channel binding: `gnutls_session_channel_binding` (TLS-Finished bytes
 *     for SCRAM-SHA-* SASL). Same gnutls_session_t blocker.
 *
 * The OCSP-response parser works on raw DER bytes (a Uint8Array on the
 * JS side) and returns a plain GObject with the parsed fields. Consumers
 * can fetch OCSP responses themselves (e.g. via @gjsify/fetch against the
 * cert's Authority Information Access OCSP responder URL) and pass them
 * here for validation.
 */

using GLib;

namespace GjsifyTls {

    /**
     * OcspResponseInfo — parsed result of {@link Tls.parse_ocsp_response}.
     *
     * Fields mirror the subset of RFC 6960 OCSPResponse we extract.
     */
    public class OcspResponseInfo : GLib.Object {
        /**
         * `responseStatus` per RFC 6960 §4.2.1:
         *   0 = successful
         *   1 = malformedRequest
         *   2 = internalError
         *   3 = tryLater
         *   5 = sigRequired
         *   6 = unauthorized
         */
        public int response_status { get; internal set; }

        /** `producedAt` field (Unix seconds, 0 if unparseable). */
        public int64 produced_at { get; internal set; }

        /**
         * `certStatus` per RFC 6960 §4.2.1:
         *   0 = good
         *   1 = revoked
         *   2 = unknown
         */
        public int cert_status { get; internal set; }

        /** `thisUpdate` field (Unix seconds). */
        public int64 this_update { get; internal set; }

        /** `nextUpdate` field (Unix seconds, 0 if absent). */
        public int64 next_update { get; internal set; }

        /** `revocationTime` (Unix seconds, only when cert_status = 1). */
        public int64 revocation_time { get; internal set; }

        /**
         * `revocationReason` per RFC 5280 §5.3.1 CRL reason codes.
         * Only meaningful when cert_status = 1.
         */
        public int revocation_reason { get; internal set; }
    }

    /**
     * Tls — static helpers wrapping GnuTLS APIs not exposed by Gio.
     */
    public class Tls : GLib.Object {

        /**
         * parse_ocsp_response:
         * @bytes: DER-encoded OCSPResponse (RFC 6960)
         *
         * Parse an OCSP response and return its key fields. Returns %null
         * if the bytes are not a valid OCSPResponse (init or import fails).
         *
         * On success the returned object's @response_status is filled even
         * when @response_status != 0 (i.e. error responses); the per-cert
         * fields (@cert_status, @this_update, …) are filled only when
         * @response_status == 0 AND the response contains at least one
         * SingleResponse — otherwise they are zero-initialised.
         */
        public static OcspResponseInfo? parse_ocsp_response(uint8[] bytes) {
            GjsifyTlsOcsp.Resp? resp = null;
            if (GjsifyTlsOcsp.Resp.init(out resp) != 0 || resp == null) {
                return null;
            }

            GnuTLS.Datum data = { (void*) bytes, (uint) bytes.length };

            if (resp.import(ref data) != 0) {
                return null;
            }

            var info = new OcspResponseInfo();
            info.response_status = resp.get_status();

            if (info.response_status != 0) {
                // Non-successful response — per-cert fields not available.
                return info;
            }

            info.produced_at = (int64) resp.get_produced();

            int digest;
            GnuTLS.Datum issuer_name_hash;
            GnuTLS.Datum issuer_key_hash;
            GnuTLS.Datum serial_number;
            uint cert_status;
            time_t this_update;
            time_t next_update;
            time_t revocation_time;
            uint revocation_reason;

            // Read the first SingleResponse (index 0). Multi-cert
            // responses are rare in OCSP-stapling contexts.
            int rc = resp.get_single(
                0,
                out digest,
                out issuer_name_hash,
                out issuer_key_hash,
                out serial_number,
                out cert_status,
                out this_update,
                out next_update,
                out revocation_time,
                out revocation_reason);

            if (rc == 0) {
                info.cert_status = (int) cert_status;
                info.this_update = (int64) this_update;
                info.next_update = (int64) next_update;
                info.revocation_time = (int64) revocation_time;
                info.revocation_reason = (int) revocation_reason;
            }

            // Touch the out-only datums once so valac doesn't drop them as
            // unused; we don't surface them to JS yet — callers extract
            // serial / issuer from the cert directly.
            int _sink = digest;
            if (_sink == -1) info.cert_status = info.cert_status;

            return info;
        }
    }
}
