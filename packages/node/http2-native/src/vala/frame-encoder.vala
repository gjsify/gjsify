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
        public const uint8 TYPE_PRIORITY      = 0x02;
        public const uint8 TYPE_RST_STREAM    = 0x03;
        public const uint8 TYPE_SETTINGS      = 0x04;
        public const uint8 TYPE_PUSH_PROMISE  = 0x05;
        public const uint8 TYPE_PING          = 0x06;
        public const uint8 TYPE_GOAWAY        = 0x07;
        public const uint8 TYPE_WINDOW_UPDATE = 0x08;

        public const uint8 FLAG_END_STREAM  = 0x01;
        public const uint8 FLAG_ACK         = 0x01;   /* SETTINGS/PING share value */
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
         * build_settings_frame:
         * @ack: %TRUE to emit SETTINGS-ACK (empty payload).
         * @ids: SETTINGS identifier array (e.g. SETTINGS_MAX_CONCURRENT_STREAMS=3)
         * @values: matching values array
         *
         * Builds a SETTINGS frame. Length of @ids must equal @values.
         * RFC 7540 §6.5: payload is N × (16-bit id || 32-bit value).
         */
        public GLib.Bytes build_settings_frame (bool ack, uint16[] ids, uint32[] values) {
            if (ack) {
                return _pack_frame (TYPE_SETTINGS, FLAG_ACK, 0,
                                    new GLib.Bytes (null));
            }
            int n = (ids.length < values.length) ? ids.length : values.length;
            uint8[] payload = new uint8[n * 6];
            for (int i = 0; i < n; i++) {
                payload[i * 6 + 0] = (uint8)((ids[i] >> 8) & 0xff);
                payload[i * 6 + 1] = (uint8)( ids[i]       & 0xff);
                payload[i * 6 + 2] = (uint8)((values[i] >> 24) & 0xff);
                payload[i * 6 + 3] = (uint8)((values[i] >> 16) & 0xff);
                payload[i * 6 + 4] = (uint8)((values[i] >>  8) & 0xff);
                payload[i * 6 + 5] = (uint8)( values[i]        & 0xff);
            }
            return _pack_frame (TYPE_SETTINGS, 0, 0, new GLib.Bytes (payload));
        }

        /**
         * build_window_update_frame:
         * @stream_id:   0 for connection-level, > 0 for per-stream
         * @increment:   31-bit window-size increment
         */
        public GLib.Bytes build_window_update_frame (uint32 stream_id, uint32 increment) {
            uint32 inc = increment & 0x7fffffffu;
            uint8[] payload = new uint8[4];
            payload[0] = (uint8)((inc >> 24) & 0xff);
            payload[1] = (uint8)((inc >> 16) & 0xff);
            payload[2] = (uint8)((inc >>  8) & 0xff);
            payload[3] = (uint8)( inc        & 0xff);
            return _pack_frame (TYPE_WINDOW_UPDATE, 0, stream_id, new GLib.Bytes (payload));
        }

        /**
         * build_ping_frame:
         * @ack:     %TRUE to emit PING-ACK (caller MUST echo the payload).
         * @payload: 8-byte opaque data (will be padded/truncated to 8 bytes).
         */
        public GLib.Bytes build_ping_frame (bool ack, GLib.Bytes? payload) {
            uint8[] data = new uint8[8];
            if (payload != null) {
                unowned uint8[] src = payload.get_data ();
                int copy = (src.length < 8) ? src.length : 8;
                for (int i = 0; i < copy; i++) data[i] = src[i];
            }
            return _pack_frame (TYPE_PING, ack ? FLAG_ACK : 0, 0, new GLib.Bytes (data));
        }

        /**
         * build_rst_stream_frame:
         * @stream_id:   stream to reset
         * @error_code:  RFC 7540 error code (NO_ERROR=0, PROTOCOL_ERROR=1, ...)
         */
        public GLib.Bytes build_rst_stream_frame (uint32 stream_id, uint32 error_code) {
            uint8[] payload = new uint8[4];
            payload[0] = (uint8)((error_code >> 24) & 0xff);
            payload[1] = (uint8)((error_code >> 16) & 0xff);
            payload[2] = (uint8)((error_code >>  8) & 0xff);
            payload[3] = (uint8)( error_code        & 0xff);
            return _pack_frame (TYPE_RST_STREAM, 0, stream_id, new GLib.Bytes (payload));
        }

        /**
         * build_goaway_frame:
         * @last_stream_id: highest stream id processed (caller tracks)
         * @error_code:     RFC 7540 error code
         * @debug_data:     optional debug info (often empty)
         */
        public GLib.Bytes build_goaway_frame (uint32 last_stream_id,
                                              uint32 error_code,
                                              GLib.Bytes? debug_data) {
            unowned uint8[] dbg = (debug_data != null) ? debug_data.get_data () : new uint8[0];
            uint8[] payload = new uint8[8 + dbg.length];
            uint32 lsi = last_stream_id & 0x7fffffffu;
            payload[0] = (uint8)((lsi >> 24) & 0xff);
            payload[1] = (uint8)((lsi >> 16) & 0xff);
            payload[2] = (uint8)((lsi >>  8) & 0xff);
            payload[3] = (uint8)( lsi        & 0xff);
            payload[4] = (uint8)((error_code >> 24) & 0xff);
            payload[5] = (uint8)((error_code >> 16) & 0xff);
            payload[6] = (uint8)((error_code >>  8) & 0xff);
            payload[7] = (uint8)( error_code        & 0xff);
            for (int i = 0; i < dbg.length; i++) payload[8 + i] = dbg[i];
            return _pack_frame (TYPE_GOAWAY, 0, 0, new GLib.Bytes (payload));
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
