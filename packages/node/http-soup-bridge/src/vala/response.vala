/*
 * Response — write side of one in-flight Soup.ServerMessage.
 *
 * Owns the SoupServerMessage privately. Keeps every libsoup boxed type
 * (MessageBody, MessageHeaders, Encoding, the message's HTTP1-IO GMain
 * Context ref) on the C side so SpiderMonkey GC has nothing to race
 * against.
 *
 * Replaces the JS-side `SoupMessageLifecycle.ts` machinery from
 * @gjsify/http: `'wrote-chunk'`-tracked re-unpause, `'finished'` /
 * `'disconnected'` signal handling, GC guard, peer-close-driven cleanup —
 * everything moves into this class.
 *
 * JS API (visible via the typelib):
 *   set_header / append_header / remove_header / get_header / header_names
 *   write_head(code, reason)             — flush headers
 *   write_chunk(bytes) -> bool           — false if already aborted
 *   end()                                — finish chunked or batch mode
 *   end_with(bytes)                      — convenience: write + end
 *   abort()                              — server-side cancel
 *   signal close()                       — fired once on terminal state
 *   signal drain()                       — fired when Soup auto-pause clears
 *
 * Internal state-machine:
 *   IDLE → STREAMING (after first write_chunk or write_head with body)
 *   IDLE → BATCH     (after end() with no prior chunk → set_response)
 *   *    → FINISHED  (Soup 'finished' signal)
 *   *    → ABORTED   (peer-close or abort() call)
 */
namespace GjsifyHttpSoupBridge {

    public class Response : GLib.Object {

        public uint   status_code    { get; set; default = 200; }
        public string status_message { get; set; default = ""; }
        public bool   headers_sent   { get; private set; default = false; }
        public bool   finished       { get; private set; default = false; }
        public bool   aborted        { get; private set; default = false; }

        /** Fires once on the main context when the response reaches a terminal state. */
        public signal void close();

        /** Fires when libsoup auto-pause clears (backpressure relieved). */
        public signal void drain();

        // ---- Internal state ----------------------------------------------

        private Soup.ServerMessage _msg;
        private GLib.HashTable<string, GLib.GenericArray<string>> _headers;
        private bool _streaming = false;
        private bool _needs_unpause = false;

        private ulong _wrote_chunk_handler = 0;
        private ulong _disconnected_handler = 0;
        private ulong _finished_handler = 0;

        // ---- Construction / wiring ---------------------------------------

        internal Response(Soup.ServerMessage msg) {
            _msg = msg;
            _headers = new GLib.HashTable<string, GLib.GenericArray<string>>(
                GLib.str_hash, GLib.str_equal
            );

            // 'wrote-chunk' fires synchronously inside Soup's HTTP1 IO loop
            // right before the auto-pause. By the time we resume in
            // write_chunk()/end(), pause_count is back at 1 and a single
            // unpause() is both safe and necessary.
            _wrote_chunk_handler = _msg.wrote_chunk.connect(() => {
                _needs_unpause = true;
                // Re-emit on the main context so JS subscribers always see
                // 'drain' from the GLib default context (never from Soup's
                // streaming-callback context).
                GLib.Idle.add(() => {
                    this.drain();
                    return GLib.Source.REMOVE;
                });
            });

            // 'disconnected' is reliable while Soup is actively reading; for
            // paused long-polls the Request side runs a PeerCloseWatch and
            // calls our `abort()` on its own.
            _disconnected_handler = _msg.disconnected.connect(() => {
                fire_terminal(true);
            });

            _finished_handler = _msg.finished.connect(() => {
                fire_terminal(false);
            });
        }

        // ---- Header API --------------------------------------------------

        public void set_header(string name, string value) {
            var lower = name.down();
            var arr = new GLib.GenericArray<string>();
            arr.add(value);
            _headers.replace(lower, arr);
        }

        public void append_header(string name, string value) {
            var lower = name.down();
            var arr = _headers.lookup(lower);
            if (arr == null) {
                arr = new GLib.GenericArray<string>();
                _headers.replace(lower, arr);
            }
            arr.add(value);
        }

        public void remove_header(string name) {
            _headers.remove(name.down());
        }

        public string? get_header(string name) {
            var arr = _headers.lookup(name.down());
            if (arr == null || arr.length == 0) return null;
            return arr[0];
        }

        public string[] header_names() {
            var keys = _headers.get_keys_as_array();
            var result = new string[keys.length];
            for (int i = 0; i < keys.length; i++) result[i] = keys[i];
            return result;
        }

        // ---- Write side --------------------------------------------------

        /**
         * Flush status + headers and switch into chunked-streaming mode.
         * Idempotent — only fires once.
         */
        public void write_head(uint code, string? reason) {
            if (headers_sent || aborted) return;
            status_code = code;
            if (reason != null) status_message = reason;
            start_streaming();
        }

        /**
         * Append a body chunk. Returns false if the response is already
         * terminal (so JS callers can stop pumping).
         */
        public bool write_chunk(uint8[] chunk) {
            if (aborted || finished) return false;
            if (!_streaming) start_streaming();

            _msg.get_response_body().append_bytes(new GLib.Bytes(chunk));

            // After Soup's HTTP1 IO writes a chunk it auto-pauses
            // (refs/libsoup/libsoup/server/http1/soup-server-message-io-http1.c
            // :32, 80–84, 1005–1010). The 'wrote-chunk' signal sets the
            // ticket; if it's set we owe libsoup an unpause so the *next*
            // chunk we appended just now actually gets written.
            if (_needs_unpause) {
                _needs_unpause = false;
                _msg.unpause();
            }
            return true;
        }

        /**
         * Finish the response. In streaming mode this calls
         * `Soup.MessageBody.complete()` so libsoup writes the chunked
         * terminator. In batch mode (no prior write_chunk) it calls
         * `Soup.ServerMessage.set_response()` to produce a fixed-length
         * empty body.
         */
        public void end() {
            if (finished || aborted) return;

            if (_streaming) {
                _msg.get_response_body().complete();
                if (_needs_unpause) {
                    _needs_unpause = false;
                    _msg.unpause();
                }
            } else {
                send_batch();
            }
            finished = true;
        }

        public void end_with(uint8[] chunk) {
            if (write_chunk(chunk)) end();
        }

        public void abort() {
            if (aborted) return;
            aborted = true;
            fire_terminal(true);
        }

        // ---- Internal helpers --------------------------------------------

        private void start_streaming() {
            if (_streaming) return;
            _streaming = true;
            headers_sent = true;

            _msg.set_status(status_code, status_message != "" ? status_message : null);

            var hdrs = _msg.get_response_headers();

            // Transfer-encoding selection mirrors @gjsify/http's previous
            // behaviour: CONTENT_LENGTH wins if the caller set one
            // explicitly, CHUNKED otherwise.
            if (_headers.contains("content-length")) {
                hdrs.set_encoding(Soup.Encoding.CONTENT_LENGTH);
            } else {
                hdrs.set_encoding(Soup.Encoding.CHUNKED);
            }

            if (!_headers.contains("connection")) {
                hdrs.replace("Connection", "close");
            }

            _headers.foreach((k, vs) => {
                for (uint i = 0; i < vs.length; i++) {
                    if (i == 0) hdrs.replace(k, vs[i]);
                    else hdrs.append(k, vs[i]);
                }
            });

            _msg.unpause();
        }

        private void send_batch() {
            if (headers_sent) return;
            headers_sent = true;

            _msg.set_status(status_code, status_message != "" ? status_message : null);

            var hdrs = _msg.get_response_headers();

            if (!_headers.contains("connection")) {
                hdrs.replace("Connection", "close");
            }

            _headers.foreach((k, vs) => {
                for (uint i = 0; i < vs.length; i++) {
                    if (i == 0) hdrs.replace(k, vs[i]);
                    else hdrs.append(k, vs[i]);
                }
            });

            string content_type = "text/plain";
            var ct_arr = _headers.lookup("content-type");
            if (ct_arr != null && ct_arr.length > 0) content_type = ct_arr[0];

            uint8[] empty = new uint8[0];
            _msg.set_response(content_type, Soup.MemoryUse.COPY, empty);
            _msg.unpause();
        }

        private bool _terminal_fired = false;
        private void fire_terminal(bool became_aborted) {
            if (_terminal_fired) return;
            _terminal_fired = true;
            if (became_aborted) aborted = true;
            finished = true;

            // Disconnect signal handlers so libsoup's own message tear-down
            // doesn't re-enter our class on a recycled signal ID.
            if (_wrote_chunk_handler != 0) { _msg.disconnect(_wrote_chunk_handler); _wrote_chunk_handler = 0; }
            if (_disconnected_handler != 0) { _msg.disconnect(_disconnected_handler); _disconnected_handler = 0; }
            if (_finished_handler != 0)    { _msg.disconnect(_finished_handler);    _finished_handler = 0;    }

            GLib.Idle.add(() => {
                this.close();
                return GLib.Source.REMOVE;
            });
        }
    }
}
