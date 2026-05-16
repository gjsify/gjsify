/*
 * SessionBridge — owns an nghttp2 session and surfaces frames to JS as
 * GObject signals.
 *
 * Lifecycle
 * ─────────
 * One SessionBridge per accepted TCP connection. The JS-side dispatcher
 * (`@gjsify/http2`'s `native-dispatcher.ts`, landing in Phase 1) feeds
 * raw socket bytes via `feed_input()`, drains pending output via
 * `drain_output()`, and reads decoded events via the signals below.
 *
 * Signals always fire on the GLib main loop (same hop pattern as
 * @gjsify/webrtc-native): a single GLib.Idle.add() pass drains every
 * queued event from the C-side queue, so JS observers see a settled
 * sequence rather than partial frame state.
 *
 * Buffer ownership: every byte hand-off uses GLib.Bytes so SpiderMonkey
 * GC never races against nghttp2's allocator. The opaque session pointer
 * lives in private extern storage; only the destructor accesses it.
 */

namespace GjsifyHttp2 {

    /* ── Opaque pointer wrappers + C entry points ─────────────────────── *
     * We avoid [Compact] classes because Vala emits its own
     * `*_free` function definitions for them, clashing with the real
     * gjsify_http2_{session,event}_free in nghttp2-helpers.c. Instead the
     * session/event handles travel as `void*` (gpointer) across the FFI
     * boundary, and the destructor explicitly calls the C free function. */

    /* Enums live in the C header (nghttp2-helpers.h). We use plain
     * integer constants here so Vala doesn't try to re-emit the typedef
     * into its generated header (which causes a redeclaration clash
     * against the C-side definition). All session-mode + event-kind
     * arguments cross the FFI boundary as `int`. */

    private const int SESSION_MODE_SERVER = 0;
    private const int SESSION_MODE_CLIENT = 1;

    private const int EVENT_HEADERS       = 1;
    private const int EVENT_DATA          = 2;
    private const int EVENT_STREAM_CLOSED = 3;
    private const int EVENT_GOAWAY        = 4;
    private const int EVENT_SETTINGS      = 5;
    private const int EVENT_PUSH_PROMISE  = 6;

    /* Event accessors — operate on a raw `void*` so Vala does not need a
     * type definition for GjsifyHttp2Event. Pointers come from
     * _session_drain_events() (returned as a `void**` NULL-terminated
     * array). Lifetime: each event must be freed via _event_free() once
     * its data has been emitted. */
    [CCode (cname = "gjsify_http2_event_free",               cheader_filename = "nghttp2-helpers.h")]
    private extern void   _event_free                    (void* ev);
    [CCode (cname = "gjsify_http2_event_get_kind",           cheader_filename = "nghttp2-helpers.h")]
    private extern uint32 _event_get_kind                (void* ev);
    [CCode (cname = "gjsify_http2_event_get_stream_id",      cheader_filename = "nghttp2-helpers.h")]
    private extern uint32 _event_get_stream_id           (void* ev);
    [CCode (cname = "gjsify_http2_event_get_error_code",     cheader_filename = "nghttp2-helpers.h")]
    private extern uint32 _event_get_error_code          (void* ev);
    [CCode (cname = "gjsify_http2_event_get_last_stream_id", cheader_filename = "nghttp2-helpers.h")]
    private extern uint32 _event_get_last_stream_id      (void* ev);
    [CCode (cname = "gjsify_http2_event_get_end_stream",     cheader_filename = "nghttp2-helpers.h")]
    private extern bool   _event_get_end_stream          (void* ev);
    [CCode (cname = "gjsify_http2_event_get_promised_stream_id", cheader_filename = "nghttp2-helpers.h")]
    private extern uint32 _event_get_promised_stream_id  (void* ev);
    [CCode (cname = "gjsify_http2_event_get_header_count",   cheader_filename = "nghttp2-helpers.h")]
    private extern size_t _event_get_header_count        (void* ev);
    [CCode (cname = "gjsify_http2_event_get_header_name",    cheader_filename = "nghttp2-helpers.h")]
    private extern unowned string? _event_get_header_name  (void* ev, size_t index);
    [CCode (cname = "gjsify_http2_event_get_header_value",   cheader_filename = "nghttp2-helpers.h")]
    private extern unowned string? _event_get_header_value (void* ev, size_t index);
    [CCode (cname = "gjsify_http2_event_get_data",           cheader_filename = "nghttp2-helpers.h")]
    private extern unowned GLib.Bytes? _event_get_data (void* ev);

    [CCode (cname = "gjsify_http2_session_new",
            cheader_filename = "nghttp2-helpers.h")]
    private extern void* _session_new (int mode);

    [CCode (cname = "gjsify_http2_session_free",
            cheader_filename = "nghttp2-helpers.h")]
    private extern void _session_free (void* session);

    [CCode (cname = "gjsify_http2_session_feed",
            cheader_filename = "nghttp2-helpers.h")]
    private extern ssize_t _session_feed (void* session, GLib.Bytes input);

    [CCode (cname = "gjsify_http2_session_drain_output",
            cheader_filename = "nghttp2-helpers.h")]
    private extern GLib.Bytes _session_drain_output (void* session);

    [CCode (cname = "gjsify_http2_session_drain_events",
            cheader_filename = "nghttp2-helpers.h")]
    private extern void** _session_drain_events (void* session, out size_t n);

    [CCode (cname = "gjsify_http2_session_submit_settings",
            cheader_filename = "nghttp2-helpers.h")]
    private extern int _session_submit_settings (void* session);

    [CCode (cname = "gjsify_http2_session_submit_response",
            cheader_filename = "nghttp2-helpers.h")]
    private extern int _session_submit_response (
        void* session,
        uint32 stream_id,
        [CCode (array_length = false, array_null_terminated = true)] string[] names,
        [CCode (array_length = false, array_null_terminated = true)] string[] values,
        size_t n_pairs,
        bool end_stream);

    [CCode (cname = "gjsify_http2_session_submit_request",
            cheader_filename = "nghttp2-helpers.h")]
    private extern uint32 _session_submit_request (
        void* session,
        [CCode (array_length = false, array_null_terminated = true)] string[] names,
        [CCode (array_length = false, array_null_terminated = true)] string[] values,
        size_t n_pairs,
        bool end_stream);

    [CCode (cname = "gjsify_http2_session_submit_data",
            cheader_filename = "nghttp2-helpers.h")]
    private extern int _session_submit_data (
        void* session, uint32 stream_id, GLib.Bytes data, bool end_stream);

    [CCode (cname = "gjsify_http2_session_submit_push_promise",
            cheader_filename = "nghttp2-helpers.h")]
    private extern uint32 _session_submit_push_promise (
        void* session,
        uint32 parent_id,
        [CCode (array_length = false, array_null_terminated = true)] string[] names,
        [CCode (array_length = false, array_null_terminated = true)] string[] values,
        size_t n_pairs);

    [CCode (cname = "gjsify_http2_session_submit_goaway",
            cheader_filename = "nghttp2-helpers.h")]
    private extern int _session_submit_goaway (
        void* session, uint32 last_stream_id, uint32 error_code);

    [CCode (cname = "gjsify_http2_session_submit_rst_stream",
            cheader_filename = "nghttp2-helpers.h")]
    private extern int _session_submit_rst_stream (
        void* session, uint32 stream_id, uint32 error_code);

    [CCode (cname = "gjsify_http2_session_want_read",
            cheader_filename = "nghttp2-helpers.h")]
    private extern bool _session_want_read (void* session);

    [CCode (cname = "gjsify_http2_session_want_write",
            cheader_filename = "nghttp2-helpers.h")]
    private extern bool _session_want_write (void* session);

    /* ── SessionBridge ───────────────────────────────────────────────── */

    public class SessionBridge : GLib.Object {

        private void* _native = null;
        private bool _drain_scheduled = false;
        private bool _disposed = false;

        ~SessionBridge () {
            if (_native != null) {
                _session_free (_native);
                _native = null;
            }
        }

        /* Signals — fired from a GLib.Idle.add() pass after frame arrival.
         *
         * Header signals carry GLib.Variant of signature "a(ss)" (array
         * of name/value tuples) rather than `string[]`. Vala's signal
         * marshaller emits paired string-arrays as `gpointer` (not
         * G_TYPE_STRV) which trips a GJS assertion at signal-emit time;
         * GVariant marshals cleanly through introspection. JS-side code
         * unpacks via `variant.deep_unpack()` (returns nested arrays). */

        /**
         * headers_received:
         * @stream_id: client-initiated stream the HEADERS frame belongs to
         * @headers: GVariant "a(ss)" — array of (name, value) tuples
         *           (lower-cased names, pseudo-headers like ":method" included)
         * @end_stream: %TRUE when this HEADERS also carries END_STREAM
         */
        public signal void headers_received (uint32 stream_id,
                                             GLib.Variant headers,
                                             bool end_stream);

        /** data_received: chunk of a DATA frame. */
        public signal void data_received (uint32 stream_id,
                                          GLib.Bytes chunk,
                                          bool end_stream);

        /** stream_closed: stream finished (after END_STREAM or RST_STREAM). */
        public signal void stream_closed (uint32 stream_id, uint32 error_code);

        /** frame_send_ready: bytes were produced by nghttp2 (drain via drain_output). */
        public signal void frame_send_ready ();

        /** goaway_received: peer sent GOAWAY. */
        public signal void goaway_received (uint32 last_stream_id, uint32 error_code);

        /** settings_received: peer's SETTINGS frame (ACK'd by nghttp2 automatically). */
        public signal void settings_received ();

        /** push_promise_received: client-side only. */
        public signal void push_promise_received (uint32 stream_id,
                                                  uint32 promised_stream_id,
                                                  GLib.Variant headers);

        /* ── construction ────────────────────────────────────────────── */

        public static SessionBridge? new_server () {
            return _construct (SESSION_MODE_SERVER);
        }

        public static SessionBridge? new_client () {
            return _construct (SESSION_MODE_CLIENT);
        }

        private static SessionBridge? _construct (int mode) {
            var bridge = new SessionBridge ();
            void* native = _session_new (mode);
            if (native == null) return null;
            bridge._native = native;
            /* Queue the initial SETTINGS frame on construction — the
             * Phase-1 dispatcher will drain it onto the wire after the
             * preface (server) or client-preface write. */
            _session_submit_settings (bridge._native);
            return bridge;
        }

        /* ── client/preface helpers (kept from the original stub for
         *    backwards compat with anything that imported them) ──────── */

        public static bool is_client_preface (GLib.Bytes? bytes) {
            if (bytes == null) return false;
            const uint8 PREFACE[] = {
                0x50, 0x52, 0x49, 0x20, 0x2a, 0x20, 0x48, 0x54,
                0x54, 0x50, 0x2f, 0x32, 0x2e, 0x30, 0x0d, 0x0a,
                0x0d, 0x0a, 0x53, 0x4d, 0x0d, 0x0a, 0x0d, 0x0a
            };
            unowned uint8[] data = bytes.get_data ();
            if (data.length < 24) return false;
            for (int i = 0; i < 24; i++) {
                if (data[i] != PREFACE[i]) return false;
            }
            return true;
        }

        public static uint preface_length () {
            return 24;
        }

        /* ── public API ──────────────────────────────────────────────── */

        /**
         * feed_input:
         * @input: bytes received from the peer
         *
         * Returns the number of bytes nghttp2 consumed (always == input
         * length on success). Triggers event emission asynchronously
         * via GLib.Idle.add(); returns immediately. Also notifies
         * frame_send_ready() if nghttp2 produced any output.
         */
        public ssize_t feed_input (GLib.Bytes input) {
            if (_native == null || _disposed) return -1;
            ssize_t rv = _session_feed (_native, input);
            if (rv < 0) return rv;
            /* nghttp2 may have queued SETTINGS-ACK, WINDOW_UPDATE etc.
             * in response — surface a write-readiness hint immediately. */
            schedule_drain ();
            return rv;
        }

        /**
         * drain_output:
         *
         * Returns all bytes nghttp2 wants to send right now (empty Bytes
         * if none). Caller must write the bytes to the socket and call
         * again if want_write() remains true.
         */
        public GLib.Bytes drain_output () {
            if (_native == null) return new GLib.Bytes (null);
            return _session_drain_output (_native);
        }

        public bool want_read  () { return _native != null && _session_want_read  (_native); }
        public bool want_write () { return _native != null && _session_want_write (_native); }

        public int submit_settings () {
            if (_native == null) return -1;
            int rv = _session_submit_settings (_native);
            if (rv == 0) schedule_drain ();
            return rv;
        }

        public int submit_response (uint32 stream_id,
                                    string[] names,
                                    string[] values,
                                    bool end_stream) {
            if (_native == null) return -1;
            if (names.length != values.length) return -1;
            int rv = _session_submit_response (
                _native, stream_id, names, values, names.length, end_stream);
            if (rv == 0) schedule_drain ();
            return rv;
        }

        /**
         * submit_request:
         *
         * Client-only: queue a HEADERS frame for a fresh outbound stream.
         * Returns the allocated odd stream-id (1, 3, ...) or 0 on error.
         */
        public uint32 submit_request (string[] names,
                                      string[] values,
                                      bool end_stream) {
            if (_native == null) return 0;
            if (names.length != values.length) return 0;
            uint32 sid = _session_submit_request (
                _native, names, values, names.length, end_stream);
            if (sid != 0) schedule_drain ();
            return sid;
        }

        public int submit_data (uint32 stream_id, GLib.Bytes data, bool end_stream) {
            if (_native == null) return -1;
            int rv = _session_submit_data (_native, stream_id, data, end_stream);
            if (rv == 0) schedule_drain ();
            return rv;
        }

        public uint32 submit_push_promise (uint32 parent_id,
                                           string[] names,
                                           string[] values) {
            if (_native == null) return 0;
            if (names.length != values.length) return 0;
            uint32 promised = _session_submit_push_promise (
                _native, parent_id, names, values, names.length);
            if (promised != 0) schedule_drain ();
            return promised;
        }

        public int submit_goaway (uint32 last_stream_id, uint32 error_code) {
            if (_native == null) return -1;
            int rv = _session_submit_goaway (_native, last_stream_id, error_code);
            if (rv == 0) schedule_drain ();
            return rv;
        }

        public int submit_rst_stream (uint32 stream_id, uint32 error_code) {
            if (_native == null) return -1;
            int rv = _session_submit_rst_stream (_native, stream_id, error_code);
            if (rv == 0) schedule_drain ();
            return rv;
        }

        /**
         * close:
         *
         * Tears down the nghttp2 session and frees C-side state. Safe to
         * call multiple times. After close(), further submit/feed calls
         * return -1.
         */
        public void close () {
            if (_disposed) return;
            _disposed = true;
            if (_native != null) {
                _session_free (_native);
                _native = null;
            }
        }

        /* ── event dispatch ──────────────────────────────────────────── */

        private void schedule_drain () {
            if (_drain_scheduled || _disposed) return;
            _drain_scheduled = true;
            GLib.Idle.add (drain_events_idle);
        }

        /* Synchronous variant for tests that want deterministic delivery
         * without spinning the main loop. */
        public void dispatch_pending () {
            drain_events_now ();
        }

        private bool drain_events_idle () {
            _drain_scheduled = false;
            drain_events_now ();
            return false; /* remove */
        }

        private void drain_events_now () {
            if (_native == null) return;

            /* First surface any pending write — the dispatcher uses
             * this to flush onto the socket. */
            if (_session_want_write (_native)) {
                frame_send_ready ();
            }

            size_t n_events = 0;
            void** events = _session_drain_events (_native, out n_events);
            if (events == null || n_events == 0) return;

            for (size_t i = 0; i < n_events; i++) {
                void* ev = events[i];
                if (ev == null) break;
                uint32 kind = _event_get_kind (ev);
                switch (kind) {
                case EVENT_HEADERS: {
                    var v = build_headers_variant (ev);
                    headers_received (
                        _event_get_stream_id (ev),
                        v,
                        _event_get_end_stream (ev));
                    break;
                }
                case EVENT_DATA: {
                    unowned GLib.Bytes? data_bytes = _event_get_data (ev);
                    data_received (
                        _event_get_stream_id (ev),
                        data_bytes != null ? data_bytes : new GLib.Bytes (null),
                        _event_get_end_stream (ev));
                    break;
                }
                case EVENT_STREAM_CLOSED:
                    stream_closed (_event_get_stream_id (ev),
                                   _event_get_error_code (ev));
                    break;
                case EVENT_GOAWAY:
                    goaway_received (_event_get_last_stream_id (ev),
                                     _event_get_error_code (ev));
                    break;
                case EVENT_SETTINGS:
                    settings_received ();
                    break;
                case EVENT_PUSH_PROMISE: {
                    var v = build_headers_variant (ev);
                    push_promise_received (
                        _event_get_stream_id (ev),
                        _event_get_promised_stream_id (ev),
                        v);
                    break;
                }
                default:
                    break;
                }
                _event_free (ev);
            }
            /* Free the container array (allocated by g_new0 in the C
             * drain_events helper). */
            GLib.free (events);
        }

        /* Build a GVariant of signature "a(ss)" from the event's header
         * accumulator. Marshalls cleanly through GObject introspection
         * (G_VARIANT_TYPE > G_TYPE_STRV for paired-string signals). */
        private GLib.Variant build_headers_variant (void* ev) {
            size_t n = _event_get_header_count (ev);
            var builder = new GLib.VariantBuilder (new GLib.VariantType ("a(ss)"));
            for (size_t i = 0; i < n; i++) {
                unowned string? name  = _event_get_header_name  (ev, i);
                unowned string? value = _event_get_header_value (ev, i);
                builder.add ("(ss)", name ?? "", value ?? "");
            }
            return builder.end ();
        }
    }
}
