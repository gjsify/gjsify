/*
 * Hand-written C header matching the Rust extern "C" surface of the
 * gjsify_oxfmt cdylib (src/rust/src/lib.rs).
 *
 * Vala includes this via [CCode (cheader_filename = "gjsify-oxfmt.h")] to
 * call into the Rust shim. The surface is tiny (one format call + a free),
 * so a hand-maintained header is simpler than pulling cbindgen into meson.
 */

#ifndef GJSIFY_OXFMT_H
#define GJSIFY_OXFMT_H

#include <glib.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

G_BEGIN_DECLS

typedef struct {
  const char    *filename;   /* extension selects JS/TS/JSX; NULL → "input.ts" */
  const uint8_t *code;
  size_t         code_len;
} GjsifyFormatOpts;

typedef struct {
  uint8_t *code;        /* formatted source; NULL on error */
  size_t   code_len;
  size_t   code_cap;
  char    *error;       /* NUL-terminated message; NULL on success */
} GjsifyResult;

/* One-shot format. The returned struct owns its buffers — pass it to
 * gjsify_oxfmt_result_free() exactly once when done. */
GjsifyResult gjsify_oxfmt_format (GjsifyFormatOpts opts);

void gjsify_oxfmt_result_free (GjsifyResult result);

/* Run the oxfmt CLI in-process. argv = the CLI arguments WITHOUT the
 * program name (process.argv.slice(2) shaped). Prints to stdout/stderr
 * like the oxfmt binary; returns the process exit code. */
int gjsify_oxfmt_run (const char * const *argv, size_t argc);

G_END_DECLS

#endif /* GJSIFY_OXFMT_H */
