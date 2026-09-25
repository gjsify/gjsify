// The internal close hook @gjsify/ws needs beyond the W3C API, and the Soup
// helpers behind it — above all the one that tears a connection down without
// a Close frame (npm ws's terminate()). Shared by this package's client and
// @gjsify/ws's server socket so each delicate path through Soup lives once.
// The hook is a Symbol.for() key: it never collides with the spec's names,
// and a host's own WebSocket simply lacks it.

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import Soup from '@girs/soup-3.0';

/** The one internal hook on {@link WebSocket} instances: close() without the
 *  W3C restriction on `code`. The spec's close() admits only 1000 and
 *  3000–4999 from script; npm ws also sends 1001–1014, and its terminate()
 *  drops the connection with no Close frame at all. `@gjsify/ws` validates by
 *  ws's rules and calls this for both. 1006 is RFC 6455's code for "closed
 *  without a Close frame" and never goes on the wire, so it selects the
 *  abort: `[kClose](1006)` is terminate(), any other code a Close frame.
 *  @internal */
export const kClose: unique symbol = Symbol.for('gjsify.websocket.close');

/** The status code that makes {@link kClose} abort instead of closing. */
export const ABORT_CODE = 1006;

/** The code Soup will actually put in a Close frame for `code`. libsoup's
 *  close_connection() knows only 1000–1003, 1007–1011 and 3000–4999 —
 *  RFC 6455's original registry — and restricts 1010 to clients and 1011 to
 *  servers. An unknown code (1012–1014, registered later) it turns into a
 *  protocol error plus an 'error' signal; a role-restricted one is a
 *  g_return_if_fail CRITICAL that sends nothing and leaves the connection
 *  open. Both are worse than the substitute libsoup itself falls back to, so
 *  we send 1002 directly: the connection closes, no CRITICAL, no spurious
 *  'error'. Upstream: status/upstream-patch-candidates.md.
 *  @internal */
export function soupCloseCode(conn: Soup.WebsocketConnection, code: number): number {
    const server = conn.get_connection_type() === Soup.WebsocketConnectionType.SERVER;
    if (code === 1010) return server ? 1002 : code;
    if (code === 1011) return server ? code : 1002;
    if ((code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1009) || (code >= 3000 && code <= 4999)) {
        return code;
    }
    return 1002;
}

/** Whether an error Soup's WebsocketConnection emitted is the transport
 *  failing — a reset, a TLS EOF — rather than the peer breaking the protocol
 *  (Soup.WebsocketError). npm ws reports only the latter as 'error'; the
 *  former ends in 'close' (1006) alone, which Soup emits next.
 *  @internal */
export function isTransportFailure(error: unknown): boolean {
    return (
        error instanceof GLib.Error && (error.domain === Gio.io_error_quark() || error.domain === Gio.tls_error_quark())
    );
}

/** The Gio.Socket under a Soup WebSocket's stream. Both Soup.Session and
 *  Soup.Server hand the connection a private SoupIOStream (GJS sees only
 *  Gio.IOStream) that wraps the real connection in its `base-iostream`
 *  property — the same unwrap libsoup's own shutdown_wr_io_stream() does. A
 *  TLS stream nests one level deeper under `base-io-stream`. */
function socketOf(stream: Gio.IOStream | null): Gio.Socket | null {
    let s: Gio.IOStream | null | undefined = stream;
    for (let depth = 0; s && depth < 4; depth++) {
        if (s instanceof Gio.SocketConnection) return s.get_socket();
        const nested = s as unknown as { base_iostream?: Gio.IOStream; base_io_stream?: Gio.IOStream };
        s = nested.base_iostream ?? nested.base_io_stream;
    }
    return null;
}

/** Drop the connection without a Close frame. Soup's close() cannot: it
 *  rejects 1006 with a CRITICAL and sends nothing. Shutting the socket down —
 *  never closing it — lets Soup's pending read see EOF, record a dirty close
 *  and emit 'closed' itself, exactly once; Soup still owns and closes the
 *  stream. Closing the fd instead would leave Soup polling a dead descriptor
 *  and emitting 'error'.
 *  @internal */
export function abortConnection(conn: Soup.WebsocketConnection): void {
    const socket = socketOf(conn.get_io_stream());
    if (socket) {
        try {
            socket.shutdown(true, true);
        } catch {
            // ENOTCONN: the peer shut it down first, and Soup is reading that
            // EOF already.
        }
    } else if (conn.get_state() === Soup.WebsocketState.OPEN) {
        // No socket under the stream (a custom Gio.IOStream handed to
        // handleUpgrade): the closest Soup allows is an immediate Close.
        conn.close(Soup.WebsocketCloseCode.GOING_AWAY, null);
    }
}
