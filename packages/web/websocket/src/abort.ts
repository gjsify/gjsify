// Tear a Soup WebSocket down without a Close frame — what npm `ws` calls
// terminate(). Shared by this package's client hook and @gjsify/ws's server
// socket so the one delicate path through Soup's private stream lives once.

import Gio from '@girs/gio-2.0';
import Soup from '@girs/soup-3.0';

/** Internal hook on {@link WebSocket} instances: abort the connection with no
 *  Close frame. Not part of the W3C API — the spec's close() rejects 1006 —
 *  it exists for @gjsify/ws's `terminate()`.
 *  @internal */
export const kAbort: unique symbol = Symbol.for('gjsify.websocket.abort');

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
