/*
 * SessionBridge — placeholder for the future cleartext-HTTP/2 (h2c)
 * session driver.
 *
 * Intent
 * ──────
 * Once we wire `nghttp2_session_server_new()` against a `Gio.Socket` we
 * obtain from a Soup.Server `request-aborted` / raw socket callback (or
 * directly from `Gio.SocketService` when bypassing Soup entirely), this
 * class will own:
 *   • the nghttp2_session pointer
 *   • a 64 KiB read buffer driven by a `g_socket_create_source(IN)`
 *     watch on the GLib main context
 *   • a write queue drained on `OUT` readiness
 *   • mirror signals (`request_received`, `data_received`, `stream_closed`,
 *     `goaway_received`) re-emitted on the main context via `GLib.Idle.add`
 *     — same hop pattern as @gjsify/webrtc-native bridges
 *
 * Until that lands, this class only validates the HTTP/2 connection
 * preface ("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", 24 bytes) so JS-side code
 * detecting a prior-knowledge h2c upgrade can route the socket through
 * a future native session loop.
 */

namespace GjsifyHttp2 {

    public class SessionBridge : GLib.Object {

        /**
         * is_client_preface:
         * @bytes: the first ≥ 24 bytes received on a TCP connection
         *
         * Returns %TRUE if @bytes starts with the RFC 7540 §3.5 client
         * connection preface ("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n").
         * Used to detect prior-knowledge h2c on a freshly-accepted socket
         * before deciding whether to dispatch it to Soup (HTTP/1.1) or
         * the future native nghttp2 session loop.
         */
        public static bool is_client_preface (GLib.Bytes? bytes) {
            if (bytes == null) return false;
            const uint8 PREFACE[] = {
                0x50, 0x52, 0x49, 0x20, 0x2a, 0x20, 0x48, 0x54,
                0x54, 0x50, 0x2f, 0x32, 0x2e, 0x30, 0x0d, 0x0a,
                0x0d, 0x0a, 0x53, 0x4d, 0x0d, 0x0a, 0x0d, 0x0a
            };
            size_t blen;
            unowned uint8[] data = bytes.get_data ();
            blen = data.length;
            if (blen < 24) return false;
            for (int i = 0; i < 24; i++) {
                if (data[i] != PREFACE[i]) return false;
            }
            return true;
        }

        /**
         * preface_length:
         *
         * Returns the size of the HTTP/2 client connection preface (24).
         */
        public static uint preface_length () {
            return 24;
        }
    }
}
