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

G_END_DECLS

#endif /* GJSIFY_ROLLDOWN_GLUE_H */
