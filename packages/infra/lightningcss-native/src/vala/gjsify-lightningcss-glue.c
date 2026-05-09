/*
 * GLib-friendly glue for gjsify_lightningcss. See gjsify-lightningcss-glue.h.
 */

#include "gjsify-lightningcss-glue.h"
#include <string.h>

GQuark
gjsify_lightningcss_error_quark (void)
{
  return g_quark_from_static_string ("gjsify-lightningcss-error-quark");
}

GBytes *
gjsify_lightningcss_glue_transform (const char  *filename,
                                    GBytes      *code,
                                    const char  *browserslist,
                                    gboolean     minify,
                                    gboolean     source_map,
                                    GBytes     **out_map,
                                    GError     **error)
{
  if (out_map)
    *out_map = NULL;

  if (code == NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_LIGHTNINGCSS_ERROR,
                           GJSIFY_LIGHTNINGCSS_ERROR_FAILED,
                           "lightningcss: NULL input bytes");
      return NULL;
    }

  gsize code_len = 0;
  const guint8 *code_data = g_bytes_get_data (code, &code_len);

  GjsifyTransformOpts opts;
  opts.filename     = filename;
  opts.code         = code_data;
  opts.code_len     = code_len;
  opts.browserslist = browserslist;
  opts.minify       = minify ? true : false;
  opts.source_map   = source_map ? true : false;

  GjsifyResult res = gjsify_lightningcss_transform (opts);

  if (res.error != NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_LIGHTNINGCSS_ERROR,
                           GJSIFY_LIGHTNINGCSS_ERROR_FAILED,
                           res.error);
      gjsify_lightningcss_result_free (res);
      return NULL;
    }

  /* Copy Rust-allocated buffers into GBytes (GLib heap), then free the
   * Rust result. Could be optimized later by giving GBytes a destroy
   * notify that calls gjsify_lightningcss_result_free, but copying keeps
   * the boundary clean and the buffers are typically small. */
  GBytes *out_code = g_bytes_new (res.code, res.code_len);

  if (source_map && res.map != NULL && out_map != NULL)
    *out_map = g_bytes_new (res.map, res.map_len);

  gjsify_lightningcss_result_free (res);
  return out_code;
}

GBytes *
gjsify_lightningcss_glue_bundle (const char  *filename,
                                 const char  *browserslist,
                                 gboolean     minify,
                                 gboolean     source_map,
                                 gboolean     error_recovery,
                                 GBytes     **out_map,
                                 GError     **error)
{
  if (out_map)
    *out_map = NULL;

  if (filename == NULL || filename[0] == '\0')
    {
      g_set_error_literal (error,
                           GJSIFY_LIGHTNINGCSS_ERROR,
                           GJSIFY_LIGHTNINGCSS_ERROR_FAILED,
                           "lightningcss: bundle requires a filename");
      return NULL;
    }

  GjsifyBundleOpts opts;
  opts.filename       = filename;
  opts.browserslist   = browserslist;
  opts.minify         = minify ? true : false;
  opts.source_map     = source_map ? true : false;
  opts.error_recovery = error_recovery ? true : false;

  GjsifyResult res = gjsify_lightningcss_bundle (opts);

  if (res.error != NULL)
    {
      g_set_error_literal (error,
                           GJSIFY_LIGHTNINGCSS_ERROR,
                           GJSIFY_LIGHTNINGCSS_ERROR_FAILED,
                           res.error);
      gjsify_lightningcss_result_free (res);
      return NULL;
    }

  GBytes *out_code = g_bytes_new (res.code, res.code_len);
  if (source_map && res.map != NULL && out_map != NULL)
    *out_map = g_bytes_new (res.map, res.map_len);

  gjsify_lightningcss_result_free (res);
  return out_code;
}
