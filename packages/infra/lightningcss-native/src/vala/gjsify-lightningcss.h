/*
 * Hand-written C header matching the Rust extern "C" surface of
 * the gjsify_lightningcss cdylib (src/rust/src/lib.rs).
 *
 * Vala includes this via [CCode (cheader_filename = "gjsify-lightningcss.h")]
 * to call into the Rust shim. We do NOT use cbindgen at build time —
 * the surface is small enough that a hand-maintained header is simpler
 * and avoids pulling cbindgen into the meson build.
 */

#ifndef GJSIFY_LIGHTNINGCSS_H
#define GJSIFY_LIGHTNINGCSS_H

#include <glib.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

G_BEGIN_DECLS

typedef struct {
  const char     *filename;       /* may be NULL → "" */
  const uint8_t  *code;
  size_t          code_len;
  const char     *browserslist;   /* may be NULL → no targets lowering */
  bool            minify;
  bool            source_map;
} GjsifyTransformOpts;

typedef struct {
  uint8_t   *code;
  size_t     code_len;
  size_t     code_cap;
  uint8_t   *map;        /* NULL if source_map was false */
  size_t     map_len;
  size_t     map_cap;
  char      *error;      /* NULL on success */
} GjsifyResult;

/* One-shot CSS transform. The returned struct owns its buffers — pass it
 * to gjsify_lightningcss_result_free() exactly once when done. */
GjsifyResult gjsify_lightningcss_transform (GjsifyTransformOpts opts);

void gjsify_lightningcss_result_free (GjsifyResult result);

G_END_DECLS

#endif /* GJSIFY_LIGHTNINGCSS_H */
