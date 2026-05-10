/*
 * Hand-written C header matching the Rust extern "C" surface of
 * the gjsify_rolldown cdylib (src/rust/src/lib.rs).
 */

#ifndef GJSIFY_ROLLDOWN_H
#define GJSIFY_ROLLDOWN_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  char    *output;       /* NUL-terminated UTF-8 JSON, NULL on error */
  size_t   output_len;
  char    *error;        /* NUL-terminated UTF-8 message, NULL on success */
} GjsifyRolldownResult;

GjsifyRolldownResult gjsify_rolldown_bundle (const char *options_json,
                                             size_t      options_json_len);

void gjsify_rolldown_result_free (GjsifyRolldownResult result);

/* ----------------------------------------------------------------- */
/* Phase B.1+: plugin-callback bridge.                                */
/* ----------------------------------------------------------------- */

typedef struct _BundleSession BundleSession;

/* Start a new bundle session. JSON payload shape is
 * `{"options": <BundlerOptions>, "plugins": [{"name": "...", "hooks": [...]}]}`.
 *
 * Returns NULL on error and sets *err_out to a heap-allocated
 * NUL-terminated message (caller frees via
 * gjsify_rolldown_session_free_error). Otherwise returns an opaque
 * BundleSession handle owned by the caller — must be freed via
 * gjsify_rolldown_session_free when done. */
BundleSession *gjsify_rolldown_session_start (const char  *args_json,
                                              size_t       args_json_len,
                                              char       **err_out);

/* Eventfd that the GLib main loop should watch with G_IO_IN. Wakes
 * whenever a hook request is queued. Caller MUST NOT close it. */
int  gjsify_rolldown_session_request_fd  (BundleSession *session);

/* Eventfd that wakes when the bundle task is fully done. */
int  gjsify_rolldown_session_complete_fd (BundleSession *session);

/* Drain one request as JSON. Returns NULL when the channel is empty
 * (out_len set to 0). Caller frees via
 * gjsify_rolldown_session_free_string. */
char *gjsify_rolldown_session_next_request (BundleSession *session,
                                            size_t        *out_len);

/* Submit the JS-side response for a previously-pulled request. */
bool  gjsify_rolldown_session_respond      (BundleSession *session,
                                            uint64_t       req_id,
                                            const char    *response_json,
                                            size_t         response_json_len);

/* Returns NULL while the build is still running. On completion: a
 * JSON document (BundleOutputJson on success or {"error": "..."} on
 * failure; *is_error tells which). Caller frees via
 * gjsify_rolldown_session_free_string. */
char *gjsify_rolldown_session_try_result   (BundleSession *session,
                                            size_t        *out_len,
                                            bool          *is_error);

void  gjsify_rolldown_session_cancel       (BundleSession *session);
void  gjsify_rolldown_session_free         (BundleSession *session);
void  gjsify_rolldown_session_free_string  (char *s);
void  gjsify_rolldown_session_free_error   (char *s);

#ifdef __cplusplus
}
#endif

#endif /* GJSIFY_ROLLDOWN_H */
