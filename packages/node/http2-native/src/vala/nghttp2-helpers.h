/*
 * Tiny C shim around libnghttp2's HPACK encoder + frame helpers + session API.
 *
 * Vala can bind nghttp2 directly, but the calling conventions for opaque
 * out-pointer constructors (nghttp2_hd_deflate_new), pointer-array structs
 * (nghttp2_nv) and the session-callback machinery are awkward to express
 * across a VAPI we have to maintain by hand. Wrapping them in plain C
 * functions returning GBytes / opaque pointers is far simpler — and keeps
 * every pointer hand-off inside C, which is exactly the pattern
 * @gjsify/http-soup-bridge / @gjsify/webrtc-native use to keep
 * SpiderMonkey GC out of the libnghttp2 boxed lifecycle.
 *
 * Reference: nghttp2/nghttp2.h (libnghttp2 ≥ 1.40).
 */

#ifndef GJSIFY_HTTP2_NGHTTP2_HELPERS_H
#define GJSIFY_HTTP2_NGHTTP2_HELPERS_H

#include <glib.h>
#include <glib-object.h>
#include <nghttp2/nghttp2.h>

G_BEGIN_DECLS

/* ────────────────────────────────────────────────────────────────────── *
 * HPACK + standalone frame builders (used by FrameEncoder)
 * ────────────────────────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────────────────────── *
 * Session API — opaque wrapper around an nghttp2_session + event queue.
 *
 * Events are captured C-side via nghttp2 callbacks and stored in a GQueue.
 * The Vala-side wrapper drains the queue (gjsify_http2_session_drain_events)
 * and re-emits each entry as a GLib signal via GLib.Idle.add() so JS-visible
 * dispatch happens on the main loop thread, matching the webrtc-native
 * streaming-thread → main-thread pattern.
 *
 * Threading model: nghttp2 callbacks run inside `gjsify_http2_session_recv`
 * (called on the main loop in this codebase since I/O is GLib-driven), so
 * we never need a cross-thread queue; the Idle.add() hop is purely to
 * decouple JS dispatch from active I/O frames (avoid re-entrancy).
 * ────────────────────────────────────────────────────────────────────── */

/* Opaque session handle. */
typedef struct _GjsifyHttp2Session GjsifyHttp2Session;

/* Mode flags for session_new. */
typedef enum {
    GJSIFY_HTTP2_SESSION_MODE_SERVER = 0,
    GJSIFY_HTTP2_SESSION_MODE_CLIENT = 1
} GjsifyHttp2SessionMode;

/* Event kinds — kept stable across versions; appended only. */
typedef enum {
    GJSIFY_HTTP2_EVENT_HEADERS       = 1,   /* request/response HEADERS complete */
    GJSIFY_HTTP2_EVENT_DATA          = 2,   /* DATA chunk for a stream */
    GJSIFY_HTTP2_EVENT_STREAM_CLOSED = 3,   /* stream finished (after END_STREAM or RST_STREAM) */
    GJSIFY_HTTP2_EVENT_GOAWAY        = 4,   /* GOAWAY frame received */
    GJSIFY_HTTP2_EVENT_SETTINGS      = 5,   /* SETTINGS frame received */
    GJSIFY_HTTP2_EVENT_PUSH_PROMISE  = 6    /* PUSH_PROMISE received (client side) */
} GjsifyHttp2EventKind;

/**
 * GjsifyHttp2Event:
 *
 * Opaque event record drained out of the session via
 * gjsify_http2_session_drain_events(). Definition lives in
 * nghttp2-helpers.c — accessed exclusively through the
 * gjsify_http2_event_get_*() accessors below.
 *
 * Keeping the tag visible (forward declared here, full struct in .c)
 * is what lets Vala emit a matching `typedef struct _GjsifyHttp2Event
 * GjsifyHttp2Event;` forward declaration in its own generated header
 * without redefining the tag.
 */
typedef struct _GjsifyHttp2Event GjsifyHttp2Event;

void  gjsify_http2_event_free (GjsifyHttp2Event *event);

/* ── Event getters — Vala bindings call these instead of accessing struct
 *    fields directly, so the Vala C generator never needs to emit a
 *    typedef for GjsifyHttp2Event (which would clash with this header).
 *
 *    Header arrays are returned as plain `char**` whose lifetime stays
 *    pinned to the event itself; do NOT free them — they vanish when the
 *    enclosing event is freed via gjsify_http2_event_free(). The data
 *    GBytes return retains a ref from inside the event; if the caller
 *    needs to outlive the event, take an explicit ref.
 * ───────────────────────────────────────────────────────────────────── */
guint32      gjsify_http2_event_get_kind                (GjsifyHttp2Event *event);
guint32      gjsify_http2_event_get_stream_id           (GjsifyHttp2Event *event);
guint32      gjsify_http2_event_get_error_code          (GjsifyHttp2Event *event);
guint32      gjsify_http2_event_get_last_stream_id      (GjsifyHttp2Event *event);
gboolean     gjsify_http2_event_get_end_stream          (GjsifyHttp2Event *event);
guint32      gjsify_http2_event_get_promised_stream_id  (GjsifyHttp2Event *event);
gsize        gjsify_http2_event_get_header_count        (GjsifyHttp2Event *event);
const char * gjsify_http2_event_get_header_name         (GjsifyHttp2Event *event, gsize index);
const char * gjsify_http2_event_get_header_value        (GjsifyHttp2Event *event, gsize index);
GBytes     * gjsify_http2_event_get_data                (GjsifyHttp2Event *event);

/**
 * gjsify_http2_session_new:
 * @mode: server or client
 *
 * Creates a new session. Returns NULL on allocation failure. Free with
 * gjsify_http2_session_free().
 *
 * The session is created with default settings; the caller is expected
 * to call gjsify_http2_session_submit_settings_local() with whatever
 * server/client SETTINGS frame is appropriate (we always send a
 * default-shaped SETTINGS on the next drain).
 */
GjsifyHttp2Session *gjsify_http2_session_new (GjsifyHttp2SessionMode mode);

void                gjsify_http2_session_free (GjsifyHttp2Session *session);

/**
 * gjsify_http2_session_feed:
 * @session: the session
 * @input:   bytes received from the peer (may be %NULL only if len==0)
 *
 * Feed received bytes into nghttp2_session_mem_recv(). Returns the number
 * of bytes consumed (always equal to the input length on success) or a
 * negative nghttp2 error code on protocol/parse error.
 *
 * Side effect: events are appended to the internal event queue; drain
 * via gjsify_http2_session_drain_events(). The function does NOT emit
 * any output — call gjsify_http2_session_drain_output() afterwards.
 */
gssize gjsify_http2_session_feed (GjsifyHttp2Session *session,
                                  GBytes             *input);

/**
 * gjsify_http2_session_drain_output:
 * @session: the session
 *
 * Returns a #GBytes containing all pending output frames (concatenated)
 * that nghttp2 wants to send. Empty bytes are returned if nothing is
 * pending. Caller MUST write these bytes to the socket; only after the
 * write completes should further frames be drained.
 */
GBytes *gjsify_http2_session_drain_output (GjsifyHttp2Session *session);

/**
 * gjsify_http2_session_drain_events:
 * @session: the session
 *
 * Drains every queued event into a NULL-terminated array of
 * #GjsifyHttp2Event pointers. Caller owns the array AND each element
 * (use gjsify_http2_event_free + g_free for the array container).
 *
 * Returns %NULL when the queue is empty.
 */
GjsifyHttp2Event **gjsify_http2_session_drain_events (GjsifyHttp2Session *session,
                                                     gsize              *out_n);

/**
 * gjsify_http2_session_submit_settings:
 * @session: the session
 *
 * Queues a SETTINGS frame with the default values. Idempotent: calling
 * twice queues two SETTINGS frames (rare; for the server-side initial
 * handshake we call it once right after session creation).
 *
 * Returns 0 on success, < 0 nghttp2 error code.
 */
int gjsify_http2_session_submit_settings (GjsifyHttp2Session *session);

/**
 * gjsify_http2_session_submit_response:
 * @session:        server session
 * @stream_id:      client-initiated stream we're responding to
 * @names / @values: response header pairs (must include :status)
 * @n_pairs:        count of header pairs
 * @end_stream:     %TRUE if the response carries no body
 *
 * Submits HEADERS for the response. Returns 0 / < 0.
 */
int gjsify_http2_session_submit_response (GjsifyHttp2Session *session,
                                          guint32             stream_id,
                                          char              **names,
                                          char              **values,
                                          gsize               n_pairs,
                                          gboolean            end_stream);

/**
 * gjsify_http2_session_submit_request:
 * @session:        client session
 * @names / @values: request header pairs (must include :method/:scheme/:path)
 * @n_pairs:        count of header pairs
 * @end_stream:     %TRUE if the request carries no body
 *
 * Returns the freshly-allocated odd client stream id (1, 3, 5, ...), or
 * 0 on error. Symmetric to submit_response on the server side.
 */
guint32 gjsify_http2_session_submit_request (GjsifyHttp2Session *session,
                                             char              **names,
                                             char              **values,
                                             gsize               n_pairs,
                                             gboolean            end_stream);

/**
 * gjsify_http2_session_submit_data:
 * @session:    the session
 * @stream_id:  target stream
 * @data:       payload bytes (may be %NULL only if end_stream is %TRUE)
 * @end_stream: %TRUE marks last DATA on the stream
 *
 * Queues a DATA frame. Returns 0 on success, < 0 nghttp2 error code.
 *
 * Buffer ownership: nghttp2 reads via a data_source callback that the
 * implementation backs with @data; we hold a ref on @data until the
 * frame is fully transmitted (signalled via on_frame_send).
 */
int gjsify_http2_session_submit_data (GjsifyHttp2Session *session,
                                      guint32             stream_id,
                                      GBytes             *data,
                                      gboolean            end_stream);

/**
 * gjsify_http2_session_submit_push_promise:
 * @session:    server session
 * @parent_id:  client stream this push is associated with
 * @names / @values / @n_pairs: request headers for the push
 *
 * Returns the promised (server-allocated) stream id, or 0 on error.
 * The caller can then submit_response()/submit_data() on the returned id.
 */
guint32 gjsify_http2_session_submit_push_promise (GjsifyHttp2Session *session,
                                                  guint32             parent_id,
                                                  char              **names,
                                                  char              **values,
                                                  gsize               n_pairs);

/**
 * gjsify_http2_session_submit_goaway:
 * @session:        the session
 * @last_stream_id: last processed stream id (set this BEFORE close)
 * @error_code:     nghttp2 error code (NO_ERROR=0, PROTOCOL_ERROR=1, ...)
 *
 * Queues a GOAWAY. Returns 0 / < 0 nghttp2 error code.
 */
int gjsify_http2_session_submit_goaway (GjsifyHttp2Session *session,
                                        guint32             last_stream_id,
                                        guint32             error_code);

/**
 * gjsify_http2_session_submit_rst_stream:
 * @session:    the session
 * @stream_id:  stream to reset
 * @error_code: nghttp2 error code
 *
 * Queues a RST_STREAM. Returns 0 / < 0.
 */
int gjsify_http2_session_submit_rst_stream (GjsifyHttp2Session *session,
                                            guint32             stream_id,
                                            guint32             error_code);

/**
 * gjsify_http2_session_want_read / _want_write:
 *
 * Returns %TRUE if nghttp2 has more bytes to consume / emit. The driver
 * uses these to decide whether to keep watching the socket for IN / OUT.
 */
gboolean gjsify_http2_session_want_read  (GjsifyHttp2Session *session);
gboolean gjsify_http2_session_want_write (GjsifyHttp2Session *session);

G_END_DECLS

#endif /* GJSIFY_HTTP2_NGHTTP2_HELPERS_H */
