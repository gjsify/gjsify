/* gjsify-tls-private.h — C shim that reaches into glib-networking's
 * GnuTLS backend to expose `gnutls_session_t`-dependent APIs that
 * `Gio.TlsConnection` keeps internal. Backs `SessionAccess` in
 * `session-access.vala`.
 *
 * The struct layout reached into here is vendored from
 * `refs/glib-networking/tls/gnutls/gtlsconnection-gnutls.c` and held
 * stable by the runtime type-name + g_type_instance_get_private()
 * pair documented in `docs/poc/tls-phase2-session-access.md`. The
 * resolver short-circuits cleanly to `NOT_SUPPORTED` if either the
 * type is not registered or the connection is from a non-GnuTLS
 * backend — no UB, no segfault, no false positives.
 */

#pragma once

#include <glib.h>
#include <gio/gio.h>

G_BEGIN_DECLS

#define GJSIFY_TLS_PRIVATE_ERROR (gjsify_tls_private_error_quark())

GQuark gjsify_tls_private_error_quark(void);

typedef enum {
    /* glib-networking GnuTLS backend not loaded, or the connection
     * is from a non-GnuTLS backend (e.g. a hypothetical OpenSSL
     * GIO backend, or a mock connection from tests). */
    GJSIFY_TLS_PRIVATE_ERROR_NOT_SUPPORTED,
    /* The GnuTLS API returned a non-zero error code. The GError
     * message includes `gnutls_strerror()` output. */
    GJSIFY_TLS_PRIVATE_ERROR_GNUTLS_FAILED,
} GjsifyTlsPrivateError;

/* True when glib-networking's GnuTLS backend is the active TLS
 * provider (i.e. `GTlsConnectionGnutls` type is registered). The
 * predicate is cheap (single g_type_from_name lookup) and is the
 * gate every other call here goes through. */
gboolean gjsify_tls_private_is_supported(void);

/* True when @conn is a GnuTLS-backend instance, false otherwise
 * (including for null). Useful for branching at the JS layer
 * without touching the session. */
gboolean gjsify_tls_private_is_gnutls_connection(GTlsConnection *conn);

/* `gnutls_session_is_resumed()` — true if the current session was
 * resumed (via ticket or session-id) rather than a fresh handshake. */
gboolean gjsify_tls_private_is_session_reused(GTlsConnection *conn, GError **error);

/* `gnutls_session_get_data2()` — serialize the current session into
 * a GBytes for later resumption. The caller takes ownership of the
 * returned GBytes (free with g_bytes_unref). */
GBytes *gjsify_tls_private_get_session_data(GTlsConnection *conn, GError **error);

/* `gnutls_session_set_data()` — inject a previously-serialized
 * session blob to attempt resumption on the next handshake. Call
 * before handshake_async(). */
gboolean gjsify_tls_private_set_session_data(GTlsConnection *conn, GBytes *data, GError **error);

/* `gnutls_session_channel_binding()` — extract the negotiated
 * channel-binding bytes for SCRAM-SHA-* SASL. @binding_type maps to
 * `gnutls_channel_binding_t` (0=tls-unique, 1=tls-server-end-point,
 * 2=tls-exporter). The caller takes ownership of the returned
 * GBytes. */
GBytes *gjsify_tls_private_get_channel_binding(GTlsConnection *conn, int binding_type, GError **error);

G_END_DECLS
