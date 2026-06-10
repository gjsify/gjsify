/*
 * GLib-friendly glue for gjsify_oxfmt. See gjsify-oxfmt-glue.h.
 */

#include "gjsify-oxfmt-glue.h"

GQuark
gjsify_oxfmt_error_quark (void)
{
  return g_quark_from_static_string ("gjsify-oxfmt-error-quark");
}

GBytes *
gjsify_oxfmt_glue_format (const char  *filename,
                          GBytes      *code,
                          GError     **error)
{
  if (code == NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_OXFMT_ERROR,
                           GJSIFY_OXFMT_ERROR_FAILED,
                           "oxfmt: NULL input bytes");
      return NULL;
    }

  gsize code_len = 0;
  const guint8 *code_data = g_bytes_get_data (code, &code_len);

  GjsifyFormatOpts opts;
  opts.filename = filename;
  opts.code     = code_data;
  opts.code_len = code_len;

  GjsifyResult res = gjsify_oxfmt_format (opts);

  if (res.error != NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_OXFMT_ERROR,
                           GJSIFY_OXFMT_ERROR_FAILED,
                           res.error);
      gjsify_oxfmt_result_free (res);
      return NULL;
    }

  /* Copy the Rust-allocated buffer into GBytes (GLib heap), then free the
   * Rust result — keeps the ownership boundary clean; formatted source is
   * typically small. */
  GBytes *out = g_bytes_new (res.code, res.code_len);
  gjsify_oxfmt_result_free (res);
  return out;
}

int
gjsify_oxfmt_glue_run (char **args,
                       int    n_args)
{
  if (n_args < 0)
    n_args = 0;

  return gjsify_oxfmt_run ((const char * const *) args, (size_t) n_args);
}
