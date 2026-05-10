/*
 * GLib-friendly glue for gjsify_rolldown. See gjsify-rolldown-glue.h.
 */

#include "gjsify-rolldown-glue.h"
#include <stdbool.h>
#include <string.h>

GQuark
gjsify_rolldown_error_quark (void)
{
  return g_quark_from_static_string ("gjsify-rolldown-error-quark");
}

GBytes *
gjsify_rolldown_glue_bundle (GBytes  *options_json,
                             GError **error)
{
  if (options_json == NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_ROLLDOWN_ERROR,
                           GJSIFY_ROLLDOWN_ERROR_FAILED,
                           "rolldown: NULL options JSON");
      return NULL;
    }

  gsize opts_len = 0;
  const char *opts_data = (const char *) g_bytes_get_data (options_json, &opts_len);

  GjsifyRolldownResult res = gjsify_rolldown_bundle (opts_data, opts_len);

  if (res.error != NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_ROLLDOWN_ERROR,
                           GJSIFY_ROLLDOWN_ERROR_FAILED,
                           res.error);
      gjsify_rolldown_result_free (res);
      return NULL;
    }

  /* Copy out into GLib heap so the Rust result can be freed immediately. */
  GBytes *out = (res.output != NULL && res.output_len > 0)
                  ? g_bytes_new (res.output, res.output_len)
                  : g_bytes_new_static ("", 0);

  gjsify_rolldown_result_free (res);
  return out;
}

/* ----------------------------------------------------------------- */
/* Phase B.1+: plugin-callback bridge glue.                          */
/* ----------------------------------------------------------------- */

BundleSession *
gjsify_rolldown_glue_session_start (GBytes  *args_json,
                                    GError **error)
{
  if (args_json == NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_ROLLDOWN_ERROR,
                           GJSIFY_ROLLDOWN_ERROR_FAILED,
                           "rolldown: NULL args JSON");
      return NULL;
    }
  gsize len = 0;
  const char *data = (const char *) g_bytes_get_data (args_json, &len);
  char *err = NULL;
  BundleSession *session = gjsify_rolldown_session_start (data, len, &err);
  if (session == NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_ROLLDOWN_ERROR,
                           GJSIFY_ROLLDOWN_ERROR_FAILED,
                           err != NULL ? err : "rolldown: unknown session-start error");
      if (err != NULL) gjsify_rolldown_session_free_error (err);
      return NULL;
    }
  return session;
}

GBytes *
gjsify_rolldown_glue_session_next_request (BundleSession *session)
{
  if (session == NULL) return NULL;
  size_t len = 0;
  char *json = gjsify_rolldown_session_next_request (session, &len);
  if (json == NULL || len == 0) return NULL;
  GBytes *out = g_bytes_new (json, len);
  gjsify_rolldown_session_free_string (json);
  return out;
}

gboolean
gjsify_rolldown_glue_session_respond (BundleSession *session,
                                      guint64        req_id,
                                      GBytes        *response_json)
{
  if (session == NULL || response_json == NULL) return FALSE;
  gsize len = 0;
  const char *data = (const char *) g_bytes_get_data (response_json, &len);
  return gjsify_rolldown_session_respond (session, req_id, data, len);
}

GBytes *
gjsify_rolldown_glue_session_try_result (BundleSession *session,
                                         GError       **error)
{
  if (session == NULL) return NULL;
  size_t len = 0;
  bool is_error = false;
  char *json = gjsify_rolldown_session_try_result (session, &len, &is_error);
  if (json == NULL) return NULL;          /* still building */
  if (is_error)
    {
      g_set_error_literal (error,
                           GJSIFY_ROLLDOWN_ERROR,
                           GJSIFY_ROLLDOWN_ERROR_FAILED,
                           json);
      gjsify_rolldown_session_free_string (json);
      return NULL;
    }
  GBytes *out = g_bytes_new (json, len);
  gjsify_rolldown_session_free_string (json);
  return out;
}
