/*
 * GLib-friendly wrapper around the Rust format shim.
 *
 * The Rust side returns its own struct with malloc'd buffers. This glue
 * layer copies the formatted code into GBytes (so GLib's refcount controls
 * lifetime — friendly to SpiderMonkey GC) and frees the Rust result
 * immediately. Errors become GError on the GJSIFY_OXFMT quark.
 */

#ifndef GJSIFY_OXFMT_GLUE_H
#define GJSIFY_OXFMT_GLUE_H

#include <glib.h>
#include <stdbool.h>
#include "gjsify-oxfmt.h"

G_BEGIN_DECLS

#define GJSIFY_OXFMT_ERROR (gjsify_oxfmt_error_quark ())

typedef enum {
  GJSIFY_OXFMT_ERROR_FAILED = 0,
} GjsifyOxfmtError;

GQuark gjsify_oxfmt_error_quark (void);

/**
 * gjsify_oxfmt_glue_format:
 * @filename:  logical filename — its extension selects JS/TS/JSX (NULL OK)
 * @code:      input source bytes (UTF-8)
 * @error:     (out)(optional): GError on failure
 *
 * Returns: (transfer full): formatted source as GBytes, or NULL on error.
 */
GBytes *gjsify_oxfmt_glue_format (const char  *filename,
                                  GBytes      *code,
                                  GError     **error);

G_END_DECLS

#endif /* GJSIFY_OXFMT_GLUE_H */
