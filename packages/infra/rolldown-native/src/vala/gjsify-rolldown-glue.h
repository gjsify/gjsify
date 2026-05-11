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

/* ----------------------------------------------------------------- */
/* Phase B.3 — nested-protocol glue.                                  */
/* ----------------------------------------------------------------- */

/* Trigger ctx.resolve() for the JS plugin currently handling
 * @parent_req_id. Returns the child request ID immediately; the
 * sub-result lands on the context-response queue. Returns 0 on
 * error (parent unknown / args malformed). */
guint64 gjsify_rolldown_glue_session_context_resolve (BundleSession *session,
                                                      guint64        parent_req_id,
                                                      GBytes        *args_json);

/* Append a string to the build's warnings list. */
void    gjsify_rolldown_glue_session_context_warn (BundleSession *session,
                                                   GBytes        *message);

/* Drain one queued context-resolve sub-result. Returns NULL when
 * the queue is empty. */
GBytes *gjsify_rolldown_glue_session_next_context_response (BundleSession *session);

/* ----------------------------------------------------------------- */
/* Phase B.4 — bytes-payload side-channel.                            */
/* ----------------------------------------------------------------- */

/* Take the request-payload bytes Rust stashed for @req_id. Returns
 * NULL when empty. The returned GBytes is independent of Rust's
 * allocation (data was copied into a GLib heap buffer + the Rust
 * payload freed in-place). */
GBytes *gjsify_rolldown_glue_session_take_request_payload (BundleSession *session,
                                                           guint64        req_id);

/* Stash bytes Rust should read after the JS handler responds — the
 * transform hook's output code. */
gboolean gjsify_rolldown_glue_session_set_response_payload (BundleSession *session,
                                                            guint64        req_id,
                                                            GBytes        *bytes);

G_END_DECLS

#endif /* GJSIFY_ROLLDOWN_GLUE_H */
