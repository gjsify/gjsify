/* gnutls-session.vapi — Vala 0.56's bundled gnutls.vapi covers most
 * of the session API (set_data / get_data / get_data2 / is_resumed),
 * but `gnutls_session_channel_binding` is missing. This sibling vapi
 * fills that gap.
 *
 * Same `.vapi` (vs `.vala`) reasoning as `gnutls-ocsp.vapi`: putting
 * `[CCode (cname = "struct …")]` bindings in a `.vala` file makes valac
 * try to *emit* the typedef, which collides with the typedef already
 * present in `gnutls/gnutls.h`. `.vapi` declarations are pure
 * mappings — no code emission.
 *
 * Loaded via meson's `vala_args: ['--vapidir=<srcdir>/src/vala']`.
 *
 * Used by: `session-access.vala` for the `tls-unique` / `tls-exporter`
 * channel-binding extraction required by SCRAM-SHA-* SASL (RFC 5929,
 * RFC 9266).
 */

[CCode (cheader_filename = "gnutls/gnutls.h", cprefix = "GNUTLS_CB_")]
namespace GjsifyTlsSession {

    /**
     * Channel-binding type per RFC 5929 §4 + RFC 9266.
     *
     * GnuTLS exposes this enum as `gnutls_channel_binding_t`.
     */
    [CCode (cname = "gnutls_channel_binding_t", has_type_id = false)]
    public enum ChannelBinding {
        /** `tls-unique` (RFC 5929 §3) — TLS 1.0–1.2 only. The first
         *  Finished message bytes from the handshake. */
        [CCode (cname = "GNUTLS_CB_TLS_UNIQUE")]
        TLS_UNIQUE,
        /** `tls-server-end-point` (RFC 5929 §4) — hash of the server cert. */
        [CCode (cname = "GNUTLS_CB_TLS_SERVER_END_POINT")]
        TLS_SERVER_END_POINT,
        /** `tls-exporter` (RFC 9266) — TLS 1.3 replacement for `tls-unique`. */
        [CCode (cname = "GNUTLS_CB_TLS_EXPORTER")]
        TLS_EXPORTER,
    }

    /**
     * `gnutls_session_channel_binding(session, cbtype, &cb)` — extract
     * the negotiated channel-binding bytes from a live session.
     *
     * @session  raw `gnutls_session_t` pointer (opaque to Vala)
     * @cbtype   one of the {@link ChannelBinding} values
     * @cb       out: filled with the channel-binding bytes
     * @returns  0 on success, a GnuTLS error code on failure (e.g.
     *           `GNUTLS_E_INVALID_REQUEST` for a binding type that
     *           the negotiated TLS version doesn't support).
     */
    [CCode (cname = "gnutls_session_channel_binding")]
    public int session_channel_binding (void* session, ChannelBinding cbtype, out GnuTLS.Datum cb);
}
