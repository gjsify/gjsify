/*
 * Hand-written C header matching the Rust extern "C" surface of
 * the gjsify_rolldown cdylib (src/rust/src/lib.rs).
 */

#ifndef GJSIFY_ROLLDOWN_H
#define GJSIFY_ROLLDOWN_H

#include <stddef.h>

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

#ifdef __cplusplus
}
#endif

#endif /* GJSIFY_ROLLDOWN_H */
