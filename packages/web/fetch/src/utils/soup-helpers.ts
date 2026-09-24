import type Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import type Soup from '@girs/soup-3.0';
import { Readable } from 'node:stream';
import type { ReadableOptions } from 'node:stream';
import { inputStreamAsyncIterator } from '@gjsify/utils';

/**
 * Promise wrapper around `Soup.Session.send_async` / `send_finish`.
 */
export async function soupSendAsync(
    session: Soup.Session,
    msg: Soup.Message,
    ioPriority = GLib.PRIORITY_DEFAULT,
    cancellable: Gio.Cancellable | null = null,
): Promise<Gio.InputStream> {
    return new Promise<Gio.InputStream>((resolve, reject) => {
        session.send_async(msg, ioPriority, cancellable, (_self, asyncRes) => {
            try {
                const inputStream = session.send_finish(asyncRes);
                resolve(inputStream);
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Close a `Gio.InputStream` without blocking the main loop. Resolves once the
 * close has finished; never rejects — a close failure leaves nothing for the
 * caller to recover, and the stream is unusable either way.
 */
function closeInputStream(inputStream: Gio.InputStream): Promise<void> {
    return new Promise<void>((resolve) => {
        inputStream.close_async(GLib.PRIORITY_DEFAULT, null, (_self, res) => {
            try {
                inputStream.close_finish(res);
            } catch {
                /* already closed, or the connection died — nothing to release */
            }
            resolve();
        });
    });
}

/**
 * Converts a `Gio.InputStream` to a Node.js `Readable` stream, closing the
 * input stream once the body is consumed or the Readable is destroyed.
 *
 * The close is load-bearing for Soup response bodies: libsoup 3 returns the
 * connection to the session's pool only when the body stream is CLOSED —
 * reading to EOF merely marks the body done. Left open, each response pins its
 * connection IN_USE until the stream happens to be GC-finalized; keep-alive
 * reuse never happens, and once `max-conns` are pinned the next request queues
 * forever (socket.io's polling transport stalled on exactly that).
 */
export function inputStreamToReadable(inputStream: Gio.InputStream, options: ReadableOptions = {}): Readable {
    let closing: Promise<void> | null = null;
    const close = (): Promise<void> => {
        if (closing) return closing;
        // A read still in flight owns the stream (close would fail with
        // G_IO_ERROR_PENDING); the generator's `finally` closes it once that
        // read settles.
        if (inputStream.has_pending()) return Promise.resolve();
        closing = closeInputStream(inputStream);
        return closing;
    };

    async function* chunks(): AsyncGenerator<Uint8Array> {
        try {
            yield* inputStreamAsyncIterator(inputStream);
        } finally {
            // Awaited, so 'end' (and with it text()/arrayBuffer()) is only
            // observed after the connection is back in the pool — a follow-up
            // request to the same host can then reuse it.
            await close();
        }
    }

    const readable = Readable.from(chunks(), options);
    // A destroyed Readable (abort, consumer gave up) may never resume the
    // generator, so its `finally` would not run — close from here as well.
    readable.once('close', () => void close());
    return readable;
}
