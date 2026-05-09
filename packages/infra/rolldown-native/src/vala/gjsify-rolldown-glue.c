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
