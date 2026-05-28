/* gjsify-tls-private.c — see gjsify-tls-private.h for the surface.
 *
 * Implementation notes
 * ────────────────────
 *
 * Why C and not Vala: the struct-private layout we vendor here
 * (`GTlsConnectionGnutlsPrivate`) is a plain C struct living inside
 * glib-networking's `gio-tls-gnutls.so` module. Modeling it from
 * Vala would require either a `.vapi` typedef (which valac then
 * emits in generated C, colliding with the real one if both ever
 * end up in the same translation unit) or pointer arithmetic on
 * an opaque `void**` (correct, but obscures intent). One C file
 * keeps the layout assumption local and reviewable.
 *
 * Why g_type_instance_get_private + g_type_from_name and not
 * dlsym(): `g_type_instance_get_private` (GLib 2.38+, public API,
 * GIR_AVAILABLE_IN_2_38) is the canonical accessor for `G_ADD_PRIVATE`-
 * registered private structs. It deals with the per-class offset
 * GLib computes at class-init time, so a glib-networking version
 * that changes private-struct order won't silently mis-read — it'll
 * just yield a different field at `priv->session`. We catch that by
 * keeping the layout vendored in `vendored_private_layout_t` below
 * AND re-extracting from `refs/glib-networking` whenever the
 * submodule pin moves (the policy doc lives next to the source).
 *
 * Layout source of truth
 * ──────────────────────
 *
 * Vendored from `refs/glib-networking/tls/gnutls/gtlsconnection-gnutls.c`
 * @ commit `be1c87027ca86c356fc2a0c2f86dcf116412d7d1` (= tag
 * `2.80.0.97-45-gbe1c870`, master HEAD at submodule add time). The
 * relevant block (lines 75-81 at that commit):
 *
 *     typedef struct {
 *       GGnutlsCertificateCredentials *credentials;     // index 0
 *       gnutls_session_t              session;           // index 1
 *       gchar                        *interaction_id;    // index 2
 *       GCancellable                 *cancellable;       // index 3
 *     } GTlsConnectionGnutlsPrivate;
 *
 * All four fields are pointer-sized. When bumping the submodule pin
 * to a glib-networking release where these change, mirror the change
 * in `vendored_private_layout_t` below and bump `LAYOUT_VERSION` so
 * the runtime check at init time can refuse unknown ABIs cleanly.
 *
 * Supported window
 * ────────────────
 *
 * - glib-networking 2.74.x through 2.84.x have the same 4-pointer
 *   layout (the credentials field was added in 2.74 and is still the
 *   first field as of 2.84). Verified by spot-reading the matching
 *   tagged sources in `refs/glib-networking`.
 * - Fedora 43 (gjs 1.86) ships glib-networking 2.80.x.
 * - Fedora 44 (gjs 1.88) ships glib-networking 2.82.x.
 * - Both inside the supported window; one vendored layout covers
 *   both runtimes.
 */

#include "gjsify-tls-private.h"
#include <gnutls/gnutls.h>
#include <string.h>

G_DEFINE_QUARK(gjsify-tls-private-error-quark, gjsify_tls_private_error)

/* Vendored layout — see file-header comment for source and version. */
typedef struct {
    gpointer credentials;       /* GGnutlsCertificateCredentials* */
    gnutls_session_t session;
    gpointer interaction_id;    /* gchar* */
    gpointer cancellable;       /* GCancellable* */
} vendored_private_layout_t;

/* Single source of truth for the glib-networking GnuTLS connection
 * GType name. Used by every entry point through resolve_session(). */
static const char GNUTLS_TYPE_NAME[] = "GTlsConnectionGnutls";

/* Force-load the GIO TLS backend so its dynamic GTypes (including
 * GTlsConnectionGnutls + its concrete client/server subclasses)
 * register with GLib. Until something requests the backend's
 * connection types, `g_type_from_name("GTlsConnectionGnutls")`
 * returns 0 — glib-networking uses `G_DEFINE_DYNAMIC_TYPE` which
 * only fires `_get_type()` on first reference. Calling
 * `g_tls_backend_get_client_connection_type` is the cheapest way
 * to trip both the subclass + abstract parent registration in one
 * call. Idempotent — safe to call from every entry point. */
static void
ensure_gnutls_types_loaded(void) {
    GTlsBackend *backend = g_tls_backend_get_default();
    if (backend != NULL) {
        (void) g_tls_backend_get_client_connection_type(backend);
    }
}

/* Resolve `conn` -> `gnutls_session_t`. Returns NULL with @error set
 * when the connection is not from the GnuTLS backend, or when
 * glib-networking's GnuTLS module is not loaded. */
static gnutls_session_t
resolve_session(GTlsConnection *conn, GError **error) {
    if (conn == NULL) {
        g_set_error_literal(error,
                            GJSIFY_TLS_PRIVATE_ERROR,
                            GJSIFY_TLS_PRIVATE_ERROR_NOT_SUPPORTED,
                            "TlsConnection is null");
        return NULL;
    }

    ensure_gnutls_types_loaded();

    GType gnutls_type = g_type_from_name(GNUTLS_TYPE_NAME);
    if (gnutls_type == 0) {
        g_set_error(error,
                    GJSIFY_TLS_PRIVATE_ERROR,
                    GJSIFY_TLS_PRIVATE_ERROR_NOT_SUPPORTED,
                    "%s type not registered (glib-networking GnuTLS "
                    "backend not loaded — set GIO_USE_TLS=gnutls or "
                    "install glib-networking)",
                    GNUTLS_TYPE_NAME);
        return NULL;
    }

    if (!G_TYPE_CHECK_INSTANCE_TYPE(conn, gnutls_type)) {
        g_set_error(error,
                    GJSIFY_TLS_PRIVATE_ERROR,
                    GJSIFY_TLS_PRIVATE_ERROR_NOT_SUPPORTED,
                    "TlsConnection is not a %s instance "
                    "(non-GnuTLS backend)",
                    GNUTLS_TYPE_NAME);
        return NULL;
    }

    /* `g_type_instance_get_private` (GLib 2.38+, public) returns the
     * pointer to the per-instance private block registered via
     * `G_ADD_PRIVATE(GTlsConnectionGnutls)`. */
    gpointer priv = g_type_instance_get_private((GTypeInstance *) conn, gnutls_type);
    if (priv == NULL) {
        g_set_error_literal(error,
                            GJSIFY_TLS_PRIVATE_ERROR,
                            GJSIFY_TLS_PRIVATE_ERROR_NOT_SUPPORTED,
                            "g_type_instance_get_private returned NULL");
        return NULL;
    }

    vendored_private_layout_t *layout = (vendored_private_layout_t *) priv;
    if (layout->session == NULL) {
        g_set_error_literal(error,
                            GJSIFY_TLS_PRIVATE_ERROR,
                            GJSIFY_TLS_PRIVATE_ERROR_NOT_SUPPORTED,
                            "gnutls_session_t is NULL — handshake not "
                            "started or connection torn down");
        return NULL;
    }

    return layout->session;
}

gboolean
gjsify_tls_private_is_supported(void) {
    ensure_gnutls_types_loaded();
    return g_type_from_name(GNUTLS_TYPE_NAME) != 0;
}

gboolean
gjsify_tls_private_is_gnutls_connection(GTlsConnection *conn) {
    if (conn == NULL) return FALSE;
    ensure_gnutls_types_loaded();
    GType gnutls_type = g_type_from_name(GNUTLS_TYPE_NAME);
    if (gnutls_type == 0) return FALSE;
    return G_TYPE_CHECK_INSTANCE_TYPE(conn, gnutls_type) ? TRUE : FALSE;
}

gboolean
gjsify_tls_private_is_session_reused(GTlsConnection *conn, GError **error) {
    gnutls_session_t s = resolve_session(conn, error);
    if (s == NULL) return FALSE;
    /* gnutls_session_is_resumed returns non-zero on resumption. */
    return gnutls_session_is_resumed(s) != 0;
}

GBytes *
gjsify_tls_private_get_session_data(GTlsConnection *conn, GError **error) {
    gnutls_session_t s = resolve_session(conn, error);
    if (s == NULL) return NULL;

    gnutls_datum_t data = { 0, 0 };
    int ret = gnutls_session_get_data2(s, &data);
    if (ret != GNUTLS_E_SUCCESS) {
        g_set_error(error,
                    GJSIFY_TLS_PRIVATE_ERROR,
                    GJSIFY_TLS_PRIVATE_ERROR_GNUTLS_FAILED,
                    "gnutls_session_get_data2 failed: %s",
                    gnutls_strerror(ret));
        return NULL;
    }

    /* g_bytes_new copies — safe to free the gnutls-allocated buffer
     * immediately afterwards. gnutls_free() is the matching
     * deallocator for gnutls_session_get_data2's output buffer per
     * the GnuTLS manual §3.6. */
    GBytes *out = g_bytes_new(data.data, data.size);
    gnutls_free(data.data);
    return out;
}

gboolean
gjsify_tls_private_set_session_data(GTlsConnection *conn, GBytes *data, GError **error) {
    if (data == NULL) {
        g_set_error_literal(error,
                            GJSIFY_TLS_PRIVATE_ERROR,
                            GJSIFY_TLS_PRIVATE_ERROR_NOT_SUPPORTED,
                            "session data GBytes is NULL");
        return FALSE;
    }

    gnutls_session_t s = resolve_session(conn, error);
    if (s == NULL) return FALSE;

    gsize size = 0;
    gconstpointer ptr = g_bytes_get_data(data, &size);

    int ret = gnutls_session_set_data(s, ptr, size);
    if (ret != GNUTLS_E_SUCCESS) {
        g_set_error(error,
                    GJSIFY_TLS_PRIVATE_ERROR,
                    GJSIFY_TLS_PRIVATE_ERROR_GNUTLS_FAILED,
                    "gnutls_session_set_data failed: %s",
                    gnutls_strerror(ret));
        return FALSE;
    }
    return TRUE;
}

GBytes *
gjsify_tls_private_get_channel_binding(GTlsConnection *conn, int binding_type, GError **error) {
    gnutls_session_t s = resolve_session(conn, error);
    if (s == NULL) return NULL;

    /* Validate binding_type maps to a known gnutls_channel_binding_t.
     * Out-of-range values would otherwise reach GnuTLS as an enum
     * conversion and trigger GNUTLS_E_INVALID_REQUEST anyway, but
     * returning the precise NOT_SUPPORTED diagnostic earlier saves
     * an extra layer of GnuTLS-string unwrapping at the JS side. */
    if (binding_type < (int) GNUTLS_CB_TLS_UNIQUE ||
        binding_type > (int) GNUTLS_CB_TLS_EXPORTER) {
        g_set_error(error,
                    GJSIFY_TLS_PRIVATE_ERROR,
                    GJSIFY_TLS_PRIVATE_ERROR_NOT_SUPPORTED,
                    "channel binding type %d out of range "
                    "[%d..%d]",
                    binding_type,
                    (int) GNUTLS_CB_TLS_UNIQUE,
                    (int) GNUTLS_CB_TLS_EXPORTER);
        return NULL;
    }

    gnutls_datum_t cb = { 0, 0 };
    int ret = gnutls_session_channel_binding(s,
                                             (gnutls_channel_binding_t) binding_type,
                                             &cb);
    if (ret != GNUTLS_E_SUCCESS) {
        g_set_error(error,
                    GJSIFY_TLS_PRIVATE_ERROR,
                    GJSIFY_TLS_PRIVATE_ERROR_GNUTLS_FAILED,
                    "gnutls_session_channel_binding failed: %s",
                    gnutls_strerror(ret));
        return NULL;
    }

    /* GnuTLS allocates `cb.data` with its own allocator (gnutls_malloc),
     * which today routes to libc malloc — gnutls_free is the documented
     * deallocator. Per the manual, the buffer becomes the caller's
     * after a successful call. */
    GBytes *out = g_bytes_new(cb.data, cb.size);
    gnutls_free(cb.data);
    return out;
}
