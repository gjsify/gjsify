import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import type Soup from '@girs/soup-3.0';
import { Readable } from 'node:stream';
import type { ReadableOptions } from 'node:stream';
import { inputStreamAsyncIterator } from '@gjsify/utils';

/**
 * Promise wrapper around `Soup.Session.send_async` / `send_finish`.
 *
 * Rejects as soon as `cancellable` fires instead of waiting for libsoup's
 * callback: a message still QUEUED for a connection slot (the session is at
 * `max-conns` / `max-conns-per-host`) sits in libsoup's STARTING state, which
 * never looks at its cancellable — the cancellation only lands once some other
 * request frees a slot, so an aborted fetch would hang until then. The message
 * stays queued inside libsoup and fails with CANCELLED when it is dequeued; a
 * stream that wins the race anyway is closed so it cannot pin its connection.
 */
export async function soupSendAsync(
    session: Soup.Session,
    msg: Soup.Message,
    ioPriority = GLib.PRIORITY_DEFAULT,
    cancellable: Gio.Cancellable | null = null,
): Promise<Gio.InputStream> {
    return new Promise<Gio.InputStream>((resolve, reject) => {
        let settled = false;
        const onCancel = () => {
            if (settled) return;
            settled = true;
            reject(new Gio.IOErrorEnum({ code: Gio.IOErrorEnum.CANCELLED, message: 'Operation was cancelled' }));
        };
        // g_cancellable_connect runs the handler at once when already cancelled.
        const handlerId = cancellable ? cancellable.connect(onCancel) : 0;
        if (settled) return;
        session.send_async(msg, ioPriority, cancellable, (_self, asyncRes) => {
            // Not from inside the cancel handler, so disconnecting cannot deadlock.
            if (handlerId) cancellable!.disconnect(handlerId);
            let inputStream: Gio.InputStream;
            try {
                inputStream = session.send_finish(asyncRes);
            } catch (error) {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
                return;
            }
            if (settled) {
                void closeInputStream(inputStream);
                return;
            }
            settled = true;
            resolve(inputStream);
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
    // Owned here, not by the caller: it only ever cancels an in-flight body
    // read of a Readable that has already been destroyed.
    const readCancellable = new Gio.Cancellable();
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
            yield* inputStreamAsyncIterator(inputStream, 4096, GLib.PRIORITY_DEFAULT, readCancellable);
        } finally {
            // Awaited, so 'end' (and with it text()/arrayBuffer()) is only
            // observed after the connection is back in the pool — a follow-up
            // request to the same host can then reuse it.
            await close();
        }
    }

    const readable = Readable.from(chunks(), options);
    readable.once('close', () => {
        // A destroyed Readable (abort, body.cancel(), consumer gave up) may
        // never resume the generator, so its `finally` would not run — close
        // from here. A read still waiting on an idle server (long-poll, SSE)
        // would hold the stream forever: cancel it, and the generator's
        // `finally` closes the stream once the cancelled read settles.
        if (inputStream.has_pending()) readCancellable.cancel();
        else void close();
    });
    return readable;
}
