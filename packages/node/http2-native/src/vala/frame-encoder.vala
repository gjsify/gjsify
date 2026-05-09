/*
 * Http2FrameEncoder — HPACK + frame-builder bridge backed by libnghttp2.
 *
 * Why this exists
 * ───────────────
 * libsoup ≥ 3 speaks HTTP/2 internally, but its high-level GIR API
 * (`Soup.Server` / `Soup.ServerMessage`) does not expose the underlying
 * nghttp2 session — so things like PUSH_PROMISE frames, fine-grained
 * flow-control window updates, and explicit stream-IDs are unreachable
 * from JS. nghttp2 itself has no Vala VAPI, and its callback-driven
 * session API is awkward to bind directly.
 *
 * This bridge wraps just the pieces JS-side `@gjsify/http2` needs:
 *   • encode_headers()   — HPACK-deflate a flat name/value pair array
 *   • build_data_frame() — wrap arbitrary bytes in a DATA frame
 *   • build_push_promise() — emit a complete PUSH_PROMISE frame
 *
 * All buffer ownership stays C-side via `GLib.Bytes` to keep the
 * SpiderMonkey GC out of nghttp2's allocations — same pattern as
 * `@gjsify/http-soup-bridge` and `@gjsify/webrtc-native`.
 */

namespace GjsifyHttp2 {

    [CCode (cname = "gjsify_http2_hpack_encode",
            cheader_filename = "nghttp2-helpers.h")]
    private extern GLib.Bytes? _hpack_encode (
        [CCode (array_length = false, array_null_terminated = false)]
        string[] names,
        [CCode (array_length = false, array_null_terminated = false)]
        string[] values,
        size_t n_pairs);

    [CCode (cname = "gjsify_http2_pack_frame",
            cheader_filename = "nghttp2-helpers.h")]
    private extern GLib.Bytes _pack_frame (uint8 type,
                                           uint8 flags,
                                           uint32 stream_id,
                                           GLib.Bytes payload);

    [CCode (cname = "gjsify_http2_pack_push_promise",
            cheader_filename = "nghttp2-helpers.h")]
    private extern GLib.Bytes _pack_push_promise (uint32 associated_stream_id,
                                                  uint32 promised_stream_id,
                                                  GLib.Bytes header_block);

    [CCode (cname = "gjsify_http2_nghttp2_version",
            cheader_filename = "nghttp2-helpers.h")]
    private extern unowned string _nghttp2_version ();

    /**
     * FrameEncoder — stateless HPACK / frame builder.
     *
     * Each call constructs a fresh nghttp2 deflater (4 KiB dynamic table)
     * for the header block, so callers don't need to track encoder state
     * across multiple pushes. This trades a few microseconds of HPACK
     * setup for simplicity — server-push is not a hot path.
     */
    public class FrameEncoder : GLib.Object {

        /* Frame types (RFC 7540 §11.2) — exposed as constants so JS
         * code doesn't have to hard-code magic numbers. */
        public const uint8 TYPE_DATA          = 0x00;
        public const uint8 TYPE_HEADERS       = 0x01;
        public const uint8 TYPE_PUSH_PROMISE  = 0x05;
        public const uint8 TYPE_GOAWAY        = 0x07;
        public const uint8 TYPE_WINDOW_UPDATE = 0x08;

        public const uint8 FLAG_END_STREAM  = 0x01;
        public const uint8 FLAG_END_HEADERS = 0x04;

        /**
         * encode_headers:
         * @names:  array of header names (must already be HTTP/2-lowercase)
         * @values: array of header values, same length as @names
         *
         * HPACK-encode the given name/value pairs. Returns the encoded
         * header block as a #GLib.Bytes, or %NULL on error.
         */
        public GLib.Bytes? encode_headers (string[] names, string[] values) {
            if (names.length != values.length) return null;
            return _hpack_encode (names, values, names.length);
        }

        /**
         * build_data_frame:
         * @stream_id:  stream this DATA frame belongs to
         * @end_stream: %TRUE to set END_STREAM flag (last DATA on the stream)
         * @payload:    payload bytes (caller must keep ≤ remote MAX_FRAME_SIZE)
         */
        public GLib.Bytes build_data_frame (uint32 stream_id,
                                            bool end_stream,
                                            GLib.Bytes payload) {
            uint8 flags = end_stream ? FLAG_END_STREAM : 0;
            return _pack_frame (TYPE_DATA, flags, stream_id, payload);
        }

        /**
         * build_headers_frame:
         * @stream_id:    target stream id
         * @end_stream:   set END_STREAM (response with empty body)
         * @end_headers:  set END_HEADERS (single-frame header block)
         * @header_block: HPACK-encoded headers from encode_headers()
         */
        public GLib.Bytes build_headers_frame (uint32 stream_id,
                                               bool end_stream,
                                               bool end_headers,
                                               GLib.Bytes header_block) {
            uint8 flags = 0;
            if (end_stream)  flags |= FLAG_END_STREAM;
            if (end_headers) flags |= FLAG_END_HEADERS;
            return _pack_frame (TYPE_HEADERS, flags, stream_id, header_block);
        }

        /**
         * build_push_promise:
         * @associated_stream_id: the request stream this push is associated with
         * @promised_stream_id:   the new even-numbered server stream-id (use
         *                        StreamIdAllocator.next_promised())
         * @header_block:         HPACK-encoded request pseudo-headers for the push
         *                        (`:method`, `:scheme`, `:authority`, `:path` etc.)
         *
         * Builds a complete PUSH_PROMISE frame with END_HEADERS set.
         */
        public GLib.Bytes build_push_promise (uint32 associated_stream_id,
                                              uint32 promised_stream_id,
                                              GLib.Bytes header_block) {
            return _pack_push_promise (associated_stream_id, promised_stream_id, header_block);
        }

        /**
         * nghttp2_version:
         *
         * Returns the libnghttp2 version string the bridge is linked against.
         * Useful for diagnostics + version pinning in error messages.
         */
        public unowned string nghttp2_version () {
            return _nghttp2_version ();
        }
    }
}
