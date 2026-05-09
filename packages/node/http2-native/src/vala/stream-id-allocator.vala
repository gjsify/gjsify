/*
 * StreamIdAllocator — server-side HTTP/2 stream-id sequencer.
 *
 * Per RFC 7540 §5.1.1:
 *   • Client-initiated streams use odd ids (1, 3, 5, ...)
 *   • Server-initiated (push) streams use even ids (2, 4, 6, ...)
 *
 * The next-id pointer is monotonically increasing per session and must
 * never wrap. Once we exhaust the 31-bit id space we MUST send a GOAWAY
 * with NGHTTP2_NO_ERROR and let a fresh connection take over.
 *
 * One allocator instance per ServerHttp2Session.
 */

namespace GjsifyHttp2 {

    public class StreamIdAllocator : GLib.Object {

        /* Max valid stream id (31-bit). Anything >= this is exhausted. */
        public const uint32 MAX_STREAM_ID = 0x7fffffffu;

        private uint32 _next_promised = 2;
        private uint32 _last_client = 0;

        /**
         * next_promised:
         *
         * Returns the next even stream-id to use for a PUSH_PROMISE.
         * Returns 0 if the id space is exhausted — caller MUST then
         * send GOAWAY and refuse further pushes.
         */
        public uint32 next_promised () {
            if (_next_promised > MAX_STREAM_ID) return 0;
            uint32 id = _next_promised;
            _next_promised += 2;
            return id;
        }

        /**
         * record_client_stream:
         * @id: client-initiated odd stream-id observed on this session
         *
         * Track the highest client stream-id seen — needed for the
         * `last-stream-id` field of a GOAWAY frame.
         */
        public void record_client_stream (uint32 id) {
            if ((id & 1u) == 1u && id > _last_client) {
                _last_client = id;
            }
        }

        public uint32 last_client_stream_id { get { return _last_client; } }

        /** Number of pushes that can still be issued (count, not id). */
        public uint32 remaining_pushes {
            get {
                if (_next_promised > MAX_STREAM_ID) return 0;
                return (MAX_STREAM_ID - _next_promised) / 2u + 1u;
            }
        }
    }
}
