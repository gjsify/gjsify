/* gjsify-tls-private.vapi — Vala binding for the local C shim that
 * exposes `Gio.TlsConnection` GnuTLS-session-t-backed APIs (session
 * resumption, channel binding). See `src/c/gjsify-tls-private.h` for
 * the documented surface.
 *
 * Loaded via meson's `vala_args: ['--vapidir=<srcdir>/src/vala']`.
 *
 * Used by: `session-access.vala` Path-A implementation (replacing
 * the POC NOT_SUPPORTED throws with real GnuTLS-backed calls).
 */

[CCode (cheader_filename = "gjsify-tls-private.h", cprefix = "gjsify_tls_private_")]
namespace GjsifyTlsPrivate {

    [CCode (cname = "GjsifyTlsPrivateError", cprefix = "GJSIFY_TLS_PRIVATE_ERROR_", has_type_id = false)]
    public errordomain Error {
        NOT_SUPPORTED,
        GNUTLS_FAILED;
        public static GLib.Quark quark ();
    }

    [CCode (cname = "gjsify_tls_private_is_supported")]
    public bool is_supported ();

    [CCode (cname = "gjsify_tls_private_is_gnutls_connection")]
    public bool is_gnutls_connection (GLib.TlsConnection conn);

    [CCode (cname = "gjsify_tls_private_is_session_reused")]
    public bool is_session_reused (GLib.TlsConnection conn) throws GjsifyTlsPrivate.Error;

    [CCode (cname = "gjsify_tls_private_get_session_data")]
    public GLib.Bytes get_session_data (GLib.TlsConnection conn) throws GjsifyTlsPrivate.Error;

    [CCode (cname = "gjsify_tls_private_set_session_data")]
    public bool set_session_data (GLib.TlsConnection conn, GLib.Bytes data) throws GjsifyTlsPrivate.Error;

    [CCode (cname = "gjsify_tls_private_get_channel_binding")]
    public GLib.Bytes get_channel_binding (GLib.TlsConnection conn, int binding_type) throws GjsifyTlsPrivate.Error;
}
