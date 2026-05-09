/*
 * GLib-friendly wrapper around the Rust transform shim.
 *
 * The Rust side returns its own struct with malloc'd buffers. This glue
 * layer copies those buffers into GBytes (so GLib's refcount controls
 * lifetime — friendly to SpiderMonkey GC) and frees the Rust result
 * immediately. Errors become GError on the GJSIFY_LIGHTNINGCSS quark.
 */

#ifndef GJSIFY_LIGHTNINGCSS_GLUE_H
#define GJSIFY_LIGHTNINGCSS_GLUE_H

#include <glib.h>
#include <stdbool.h>
#include "gjsify-lightningcss.h"

G_BEGIN_DECLS

#define GJSIFY_LIGHTNINGCSS_ERROR (gjsify_lightningcss_error_quark ())

typedef enum {
  GJSIFY_LIGHTNINGCSS_ERROR_FAILED = 0,
} GjsifyLightningcssError;

GQuark gjsify_lightningcss_error_quark (void);

/**
 * gjsify_lightningcss_glue_transform:
 * @filename:      logical filename for diagnostics (NULL OK)
 * @code:          input CSS bytes
 * @browserslist:  browserslist query (NULL = no targets lowering)
 * @minify:        TRUE to minify the output
 * @source_map:    TRUE to also compute a source map
 * @out_map:       (out)(transfer full)(nullable): JSON source map, set
 *                 only when @source_map is TRUE
 * @error:         (out)(optional): GError on failure
 *
 * Returns: (transfer full): output CSS as GBytes, or NULL on error.
 */
GBytes *gjsify_lightningcss_glue_transform (const char  *filename,
                                            GBytes      *code,
                                            const char  *browserslist,
                                            gboolean     minify,
                                            gboolean     source_map,
                                            GBytes     **out_map,
                                            GError     **error);

/**
 * gjsify_lightningcss_glue_bundle:
 * @filename:        entry CSS path (must not be NULL)
 * @browserslist:    targets query (NULL = no lowering)
 * @minify:          minify the output
 * @source_map:      compute a source map for the entry file
 * @error_recovery:  continue on parse errors (lightningcss
 *                   `errorRecovery: true` semantics)
 * @out_map:         (out)(transfer full)(nullable): JSON source map
 * @error:           (out)(optional)
 *
 * Returns: (transfer full): bundled output CSS as GBytes. The bundler
 * resolves @import chains via lightningcss's built-in `FileProvider`
 * (filesystem-backed).
 */
GBytes *gjsify_lightningcss_glue_bundle (const char  *filename,
                                         const char  *browserslist,
                                         gboolean     minify,
                                         gboolean     source_map,
                                         gboolean     error_recovery,
                                         GBytes     **out_map,
                                         GError     **error);

G_END_DECLS

#endif /* GJSIFY_LIGHTNINGCSS_GLUE_H */
