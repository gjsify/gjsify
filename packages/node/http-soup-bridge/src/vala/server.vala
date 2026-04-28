/*
 * Server — wraps Soup.Server with a JS-safe signal-based API.
 *
 * The class owns the SoupServer privately. JS callers see only:
 *   listen(port, hostname) -> bool
 *   close()
 *   property port           : uint
 *   property address        : string
 *   property listening      : bool
 *   property soup_server    : Soup.Server   // for ws-upgrade callers
 *   signal   request_received(Request, Response)
 *   signal   upgrade(Request, GLib.IOStream, GLib.Bytes)
 *   signal   error_occurred(string)
 *
 * The `soup_server` property is exposed read-only because @gjsify/ws's
 * WebSocketServer needs to call `add_websocket_handler` on the same
 * underlying Soup.Server (port-sharing). Soup.Server *itself* is a
 * GObject (not a Boxed), so exposing it doesn't reintroduce the
 * Boxed-Source GC race the bridge fixes — the race was specifically
 * about boxed types like SoupMessageBody / SoupMessageHeaders / the
 * implicit GLib.Source ref, none of which leak through this surface.
 */
namespace GjsifyHttpSoupBridge {

    public class Server : GLib.Object {

        public uint    port      { get; private set; default = 0; }
        public string  address   { get; private set; default = ""; }
        public bool    listening { get; private set; default = false; }

        /** Underlying Soup.Server, exposed so @gjsify/ws can share the port. */
        public Soup.Server soup_server { get; private set; }

        public signal void request_received(Request req, Response res);
        public signal void upgrade(Request req, GLib.IOStream iostream, GLib.Bytes head);
        public signal void error_occurred(string message);

        construct {
            // Soup.Server's constructor is the GObject varargs form
            // `Server(string optname1, ...)`. We use the property-bag form
            // via GObject.Object.new() with a zero-property list, which
            // round-trips to `g_object_new(SOUP_TYPE_SERVER, NULL)`.
            soup_server = (Soup.Server) GLib.Object.new(typeof(Soup.Server));
            // ServerCallback signature: (Server, ServerMessage, path, query?)
            soup_server.add_handler(null, (server, msg, path, query) => {
                handle_message(msg);
            });
        }

        public void listen(uint port_arg, string hostname) throws GLib.Error {
            soup_server.listen_local(port_arg, Soup.ServerListenOptions.IPV4_ONLY);
            var listeners = soup_server.get_listeners();
            if (listeners != null && listeners.length() > 0) {
                var laddr = listeners.nth_data(0).get_local_address() as GLib.InetSocketAddress;
                if (laddr != null) {
                    port = laddr.get_port();
                } else {
                    port = port_arg;
                }
            } else {
                port = port_arg;
            }
            address = hostname;
            listening = true;
        }

        public void close() {
            if (!listening) return;
            soup_server.disconnect();
            listening = false;
        }

        // ---- Per-request dispatch ---------------------------------------

        private void handle_message(Soup.ServerMessage msg) {
            // Detect WebSocket upgrade BEFORE pausing the message, so
            // steal_connection() returns a usable IOStream. We mirror
            // @gjsify/http's existing logic here so consumers can keep
            // using `Server.on('upgrade', …)` unchanged.
            unowned Soup.MessageHeaders req_hdrs = msg.get_request_headers();
            string? conn = req_hdrs.get_one("Connection");
            string? upg  = req_hdrs.get_one("Upgrade");
            bool is_upgrade = conn != null && conn.down().contains("upgrade") && upg != null;

            if (is_upgrade) {
                // Build a Request snapshot for the upgrade event but skip
                // creating a Response (libsoup will discard any response
                // we'd write after steal_connection).
                var req = new Request(msg);
                GLib.IOStream? io = null;
                try {
                    io = msg.steal_connection();
                } catch (GLib.Error e) {
                    error_occurred(e.message);
                    return;
                }
                if (io != null) {
                    var head = new GLib.Bytes(new uint8[0]);
                    GLib.Idle.add(() => {
                        this.upgrade(req, io, head);
                        return GLib.Source.REMOVE;
                    });
                }
                return;
            }

            // Non-upgrade path: pause Soup so the JS handler can take its
            // time before unpause()-ing through Response.write_chunk/end.
            msg.pause();

            var req = new Request(msg);
            var res = new Response(msg);

            GLib.Idle.add(() => {
                this.request_received(req, res);
                return GLib.Source.REMOVE;
            });
        }
    }
}
