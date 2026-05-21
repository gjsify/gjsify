/* gnutls-ocsp.vapi — Vala 0.56's bundled gnutls.vapi has no OCSP bindings.
 * This sibling vapi declares the minimal subset we need to wrap
 * `gnutls_ocsp_resp_*` for OCSP-response parsing (RFC 6960).
 *
 * `.vapi` (vs `.vala`) is important: `.vapi` files are pure declarations
 * mapping to existing C types. Putting these `cname = "struct …"` bindings
 * in a `.vala` file makes valac try to *emit* the typedef, which collides
 * with the typedef already present in `gnutls/ocsp.h`.
 *
 * Loaded via meson's `vala_args: ['--vapidir=<srcdir>/src/vala']`.
 */

[CCode (cheader_filename = "gnutls/ocsp.h", lower_case_cprefix = "gnutls_ocsp_")]
namespace GjsifyTlsOcsp {

    [Compact]
    [CCode (cname = "struct gnutls_ocsp_resp_int", free_function = "gnutls_ocsp_resp_deinit")]
    public class Resp {
        [CCode (cname = "gnutls_ocsp_resp_init")]
        public static int init(out Resp resp);

        [CCode (cname = "gnutls_ocsp_resp_import")]
        public int import(ref GnuTLS.Datum data);

        [CCode (cname = "gnutls_ocsp_resp_get_status")]
        public int get_status();

        [CCode (cname = "gnutls_ocsp_resp_get_produced")]
        public time_t get_produced();

        [CCode (cname = "gnutls_ocsp_resp_get_single")]
        public int get_single(
            uint indx,
            out int digest,
            out GnuTLS.Datum issuer_name_hash,
            out GnuTLS.Datum issuer_key_hash,
            out GnuTLS.Datum serial_number,
            out uint cert_status,
            out time_t this_update,
            out time_t next_update,
            out time_t revocation_time,
            out uint revocation_reason);
    }
}
