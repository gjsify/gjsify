/*
 * GLib-friendly wrapper around the Rust rolldown shim. Same pattern
 * as @gjsify/lightningcss-native: copy the Rust-allocated buffer into
 * GBytes (refcount-friendly for SpiderMonkey GC) and free the Rust
 * result immediately. Errors become GError on the GJSIFY_ROLLDOWN quark.
 */

#ifndef GJSIFY_ROLLDOWN_GLUE_H
#define GJSIFY_ROLLDOWN_GLUE_H

#include <glib.h>
#include "gjsify-rolldown.h"

G_BEGIN_DECLS

#define GJSIFY_ROLLDOWN_ERROR (gjsify_rolldown_error_quark ())

typedef enum {
  GJSIFY_ROLLDOWN_ERROR_FAILED = 0,
} GjsifyRolldownError;

GQuark gjsify_rolldown_error_quark (void);

/**
 * gjsify_rolldown_glue_bundle:
 * @options_json: (transfer none): UTF-8 JSON document matching
 *                rolldown's BundlerOptions serde shape (camelCase).
 * @error: (out)(optional): GError on failure
 *
 * Returns: (transfer full): output JSON as GBytes, or NULL on error.
 */
GBytes *gjsify_rolldown_glue_bundle (GBytes  *options_json,
                                     GError **error);

/* ----------------------------------------------------------------- */
/* Phase B.1+: plugin-callback bridge.                                */
/* ----------------------------------------------------------------- */

/* Start a session. @args_json shape: `{"options": ..., "plugins": [...]}`.
 * Returns NULL on error (sets *error). Session must be freed via
 * gjsify_rolldown_session_free (the Rust extern, not a glue wrapper). */
BundleSession *gjsify_rolldown_glue_session_start (GBytes  *args_json,
                                                   GError **error);

/* Drain one pending hook request as GBytes. Returns NULL when the
 * channel is empty (NOT an error — just means caller should wait
 * for the next request_fd wake). */
GBytes *gjsify_rolldown_glue_session_next_request (BundleSession *session);

/* Forward the JS-side response. */
gboolean gjsify_rolldown_glue_session_respond (BundleSession *session,
                                               guint64        req_id,
                                               GBytes        *response_json);

/* Read the bundle result. Returns NULL while still in flight. On
 * completion: GBytes with BundleOutputJson on success, or NULL +
 * GError set on build failure. */
GBytes *gjsify_rolldown_glue_session_try_result (BundleSession *session,
                                                 GError       **error);

G_END_DECLS

#endif /* GJSIFY_ROLLDOWN_GLUE_H */
