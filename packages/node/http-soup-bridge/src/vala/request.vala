/*
 * Request — read-side snapshot of one in-flight Soup.ServerMessage.
 *
 * Properties (method, url, headers, body, remote_address, remote_port) are
 * captured at construction time from the SoupServerMessage. Body bytes are
 * pulled from `Soup.ServerMessage.get_request_body()` and copied so JS
 * never holds a reference to the live SoupMessageBody (a refcounted boxed
 * type implicated in the GJS GC race we're working around).
 *
 * `aborted` flips to true and `aborted_signal` fires when:
 *   * Soup emits 'disconnected' on the underlying message, OR
 *   * the PeerCloseWatch helper detects a peer half-close on a paused
 *     long-poll message (the only way we get reliable peer-close
 *     detection on libsoup-paused messages, see peer-close-watch.vala).
 *
 * JS API (visible via the typelib):
 *   property method   : string
 *   property url      : string
 *   property remote_address : string
 *   property remote_port    : uint
 *   property header_pairs   : string[]   // [name, value, name, value, …]
 *   property body           : uint8[]
 *   property aborted        : bool
 *   signal   aborted_signal()
 *   signal   close()
 */
namespace GjsifyHttpSoupBridge {

    public class Request : GLib.Object {

        public string  method          { get; private set; default = ""; }
        public string  url             { get; private set; default = ""; }
        public string  remote_address  { get; private set; default = ""; }
        public uint    remote_port     { get; private set; default = 0; }
        public string[] header_pairs   { get; private set; default = new string[0]; }
        public uint8[]  body           { get; private set; default = new uint8[0]; }
        public bool     aborted        { get; private set; default = false; }

        public signal void aborted_signal();
        public signal void close();

        // ---- Internal state ---------------------------------------------

        private Soup.ServerMessage _msg;
        private PeerCloseWatch? _watch;
        private ulong _disconnected_handler = 0;
        private ulong _finished_handler = 0;

        internal Request(Soup.ServerMessage msg) {
            _msg = msg;

            method = msg.get_method();

            unowned GLib.Uri? uri = msg.get_uri();
            if (uri != null) {
                url = uri.get_path();
                var query = uri.get_query();
                if (query != null && query.length > 0) {
                    url = url + "?" + query;
                }
            }

            var remote_host = msg.get_remote_host();
            if (remote_host != null) remote_address = remote_host;

            var remote = msg.get_remote_address() as GLib.InetSocketAddress;
            if (remote != null) remote_port = remote.get_port();

            // Flatten request headers into [name, value, name, value, …].
            // This is the JS-friendliest shape for headers — avoids exposing
            // SoupMessageHeaders boxed handles.
            var pairs = new GLib.GenericArray<string>();
            unowned Soup.MessageHeaders req_hdrs = msg.get_request_headers();
            req_hdrs.foreach((name, value) => {
                pairs.add(name);
                pairs.add(value);
            });
            var arr = new string[pairs.length];
            for (uint i = 0; i < pairs.length; i++) arr[i] = pairs[i];
            header_pairs = arr;

            // Snapshot the request body. Soup buffers it for us before
            // dispatching the handler. flatten() returns a GLib.Bytes
            // representing the accumulated body; we copy out the bytes so
            // JS never holds a SoupMessageBody handle.
            unowned Soup.MessageBody req_body = msg.get_request_body();
            var data = req_body.flatten();
            if (data != null && data.get_size() > 0) {
                body = data.get_data();
            }

            // Wire the unambiguous peer-close path: Soup's 'disconnected'
            // signal. This fires reliably while Soup is actively reading
            // (i.e. before the handler pauses the message).
            _disconnected_handler = _msg.disconnected.connect(() => {
                fire_aborted();
            });

            _finished_handler = _msg.finished.connect(() => {
                fire_close();
            });

            // Also arm the peer-close watch so we get half-close detection
            // while the response is paused (long-poll / SSE). The watcher
            // does the MSG_PEEK probing C-side so we never expose a
            // GLib.Source to JS.
            var sock = _msg.get_socket();
            if (sock != null) {
                _watch = new PeerCloseWatch(sock);
                _watch.peer_gone.connect(() => {
                    fire_aborted();
                });
                _watch.start();
            }
        }

        // ---- Internal helpers -------------------------------------------

        private bool _aborted_fired = false;
        private void fire_aborted() {
            if (_aborted_fired) return;
            _aborted_fired = true;
            aborted = true;
            stop_watch();
            GLib.Idle.add(() => {
                this.aborted_signal();
                this.close();
                return GLib.Source.REMOVE;
            });
        }

        private bool _close_fired = false;
        private void fire_close() {
            if (_close_fired) return;
            _close_fired = true;
            stop_watch();
            disconnect_handlers();
            GLib.Idle.add(() => {
                this.close();
                return GLib.Source.REMOVE;
            });
        }

        private void stop_watch() {
            if (_watch != null) {
                _watch.stop();
                _watch = null;
            }
        }

        private void disconnect_handlers() {
            if (_disconnected_handler != 0) { _msg.disconnect(_disconnected_handler); _disconnected_handler = 0; }
            if (_finished_handler != 0)    { _msg.disconnect(_finished_handler);    _finished_handler = 0;    }
        }
    }
}
