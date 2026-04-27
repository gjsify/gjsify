/*
 * PeerCloseWatch — detect peer-side TCP half-close while a SoupServerMessage
 * is paused.
 *
 * libsoup destroys its input-polling source on `soup_server_message_pause()`
 * (see refs/libsoup/libsoup/server/http1/soup-server-message-io-http1.c:32,
 * 80–84, 1005–1010), so the `'disconnected'` signal never fires for clients
 * that hang up while we're holding a long-poll/SSE response open. From JS
 * we couldn't fix this: `Gio.Socket.condition_check(HUP|ERR)` only fires on
 * bilateral close, and `Gio.Socket.receive_message(MSG_PEEK)` is not
 * introspectable. From C/Vala both APIs are first-class.
 *
 * What this watcher does on each tick:
 *   1. Wait for `G_IO_IN | G_IO_HUP | G_IO_ERR` on the underlying GSocket.
 *   2. If HUP/ERR fires → peer fully closed, emit `peer_gone()` and exit.
 *   3. If IN fires → peer either sent data (legitimate next request on a
 *      keep-alive connection) or closed their write side. We disambiguate
 *      with a non-blocking 0-byte `g_socket_receive_message(MSG_PEEK)` —
 *      a return of 0 is EOF, > 0 is buffered data we leave for libsoup.
 *
 * The watcher is owned by a Request bridge instance (see request.vala).
 * Source attachment / removal is bookkept here so the JS side never sees
 * a GLib.Source — the typelib only exposes the watcher class itself.
 */
namespace GjsifyHttpSoupBridge {

    internal class PeerCloseWatch : GLib.Object {

        /** Fires once on the main context when peer-side EOF / HUP is detected. */
        public signal void peer_gone();

        private GLib.Socket _socket;
        private GLib.Source? _source;
        private bool _emitted = false;

        public PeerCloseWatch(GLib.Socket socket) {
            _socket = socket;
        }

        /** Begin watching. Idempotent. No-op once peer_gone has fired. */
        public void start() {
            if (_source != null || _emitted)
                return;

            // GLib.IOCondition.IN catches the half-close case (POLLIN with 0
            // bytes available = EOF). HUP/ERR catch the bilateral-close /
            // socket-error case.
            _source = _socket.create_source(
                GLib.IOCondition.IN | GLib.IOCondition.HUP | GLib.IOCondition.ERR,
                null
            );
            _source.set_callback(() => on_condition());
            _source.attach(GLib.MainContext.@default());
        }

        /** Stop watching. Safe to call multiple times. */
        public void stop() {
            if (_source != null) {
                _source.destroy();
                _source = null;
            }
        }

        private bool on_condition() {
            if (_emitted)
                return GLib.Source.REMOVE;

            // HUP / ERR → unambiguous peer-close.
            var cond = _socket.condition_check(
                GLib.IOCondition.HUP | GLib.IOCondition.ERR
            );
            if ((cond & (GLib.IOCondition.HUP | GLib.IOCondition.ERR)) != 0) {
                fire_peer_gone();
                return GLib.Source.REMOVE;
            }

            // IN bit set. Probe with a 1-byte MSG_PEEK to disambiguate
            // "peer-half-closed" (recv returns 0) from "data buffered"
            // (recv returns > 0). MSG_PEEK does not consume bytes, so any
            // legitimate buffered data is still available to libsoup.
            uint8 buf[1] = {};
            var vec = GLib.InputVector();
            vec.buffer = buf;
            vec.size = 1;
            GLib.InputVector[] vecs = { vec };
            int flags = (int)GLib.SocketMsgFlags.PEEK;
            try {
                GLib.SocketAddress? src_addr;
                GLib.SocketControlMessage[]? msgs;
                ssize_t n = _socket.receive_message(
                    out src_addr, vecs, out msgs, ref flags, null
                );
                if (n == 0) {
                    fire_peer_gone();
                    return GLib.Source.REMOVE;
                }
                // n > 0 → real data, peer alive. Stay armed.
                return GLib.Source.CONTINUE;
            } catch (GLib.IOError.WOULD_BLOCK e) {
                // Spurious wake-up — keep watching.
                return GLib.Source.CONTINUE;
            } catch (GLib.Error e) {
                // Any other error: treat as peer-gone defensively.
                fire_peer_gone();
                return GLib.Source.REMOVE;
            }
        }

        private void fire_peer_gone() {
            if (_emitted)
                return;
            _emitted = true;
            // Hop through Idle.add so that the signal is emitted *after*
            // any libsoup callback that may already be running on this
            // mainloop iteration finishes — never re-enter Soup IO from
            // a half-completed callback.
            GLib.Idle.add(() => {
                this.peer_gone();
                return GLib.Source.REMOVE;
            });
        }
    }
}
