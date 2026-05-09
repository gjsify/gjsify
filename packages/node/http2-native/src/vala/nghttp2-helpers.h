/*
 * Tiny C shim around libnghttp2's HPACK encoder + frame helpers.
 *
 * Vala can bind nghttp2 directly, but the calling conventions for opaque
 * out-pointer constructors (nghttp2_hd_deflate_new) and pointer-array
 * structs (nghttp2_nv) are awkward to express across a VAPI we have to
 * maintain by hand. Wrapping them in plain C functions returning GBytes
 * is far simpler — and keeps every pointer hand-off inside C, which is
 * exactly the pattern @gjsify/http-soup-bridge / @gjsify/webrtc-native
 * use to keep SpiderMonkey GC out of the libnghttp2 boxed lifecycle.
 *
 * Reference: nghttp2/nghttp2.h (libnghttp2 ≥ 1.40).
 */

#ifndef GJSIFY_HTTP2_NGHTTP2_HELPERS_H
#define GJSIFY_HTTP2_NGHTTP2_HELPERS_H

#include <glib.h>
#include <nghttp2/nghttp2.h>

G_BEGIN_DECLS

/**
 * gjsify_http2_hpack_encode:
 * @names:      flat name array  (length = n_pairs)
 * @values:     flat value array (length = n_pairs)
 * @n_pairs:    number of header pairs
 *
 * HPACK-encode @n_pairs name/value strings using a fresh nghttp2 deflater
 * (default 4096-byte dynamic table). Returns a freshly-allocated #GBytes
 * containing the encoded header block, or %NULL on error.
 *
 * Lower-cases nothing — caller is responsible for HTTP/2 lowercase rules.
 */
GBytes *gjsify_http2_hpack_encode (char **names,
                                   char **values,
                                   gsize  n_pairs);

/**
 * gjsify_http2_pack_frame:
 * @type:        nghttp2 frame type (1=HEADERS, 5=PUSH_PROMISE, 0=DATA, ...)
 * @flags:       frame flags (END_STREAM=0x01, END_HEADERS=0x04, ...)
 * @stream_id:   stream identifier (31-bit)
 * @payload:     frame payload bytes (already HPACK-encoded for header frames,
 *               raw bytes for DATA / PUSH_PROMISE-with-promised-id-prefix)
 *
 * Builds a complete HTTP/2 frame: 9-byte fixed header (length, type, flags,
 * stream-id) followed by @payload. Returns a freshly-allocated #GBytes.
 *
 * Caller is responsible for splitting payloads larger than 16384 bytes
 * across CONTINUATION frames if needed (this helper does NOT segment).
 */
GBytes *gjsify_http2_pack_frame (guint8       type,
                                 guint8       flags,
                                 guint32      stream_id,
                                 GBytes      *payload);

/**
 * gjsify_http2_pack_push_promise:
 * @associated_stream_id: the parent stream the push is associated with
 * @promised_stream_id:   the new even-numbered stream-id the server reserves
 * @header_block:         HPACK-encoded request headers for the push
 *
 * Convenience wrapper combining the 4-byte promised-stream-id prefix that
 * PUSH_PROMISE requires with @header_block, then frames it. Sets
 * END_HEADERS flag (single-frame header block — caller must keep
 * @header_block ≤ remote SETTINGS_MAX_FRAME_SIZE − 4).
 */
GBytes *gjsify_http2_pack_push_promise (guint32  associated_stream_id,
                                        guint32  promised_stream_id,
                                        GBytes  *header_block);

/**
 * gjsify_http2_nghttp2_version:
 *
 * Returns the libnghttp2 runtime version string ("1.62.0", ...).
 */
const char *gjsify_http2_nghttp2_version (void);

G_END_DECLS

#endif /* GJSIFY_HTTP2_NGHTTP2_HELPERS_H */
