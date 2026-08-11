import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { gbytesToUint8Array } from './byte-array.js';

/**
 * Generic promise wrapper for Gio async/finish method pairs.
 *
 * Example:
 *   const stream = await gioAsync<Gio.InputStream>(session, 'send_async', 'send_finish', msg, priority, null);
 */
// oxlint-disable-next-line typescript/no-explicit-any -- GObject/Gio introspection boundary: obj is a GObject instance with dynamic async/finish methods
export function gioAsync<T>(obj: any, asyncMethod: string, finishMethod: string, ...args: any[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        obj[asyncMethod](...args, (_self: unknown, asyncRes: Gio.AsyncResult) => {
            try {
                resolve(obj[finishMethod](asyncRes));
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Promise wrapper around `Gio.InputStream.read_bytes_async` / `read_bytes_finish`.
 * `null` means end of stream; a clean-stream-end error counts as EOF (see the catch),
 * everything else is bubbled.
 */
export async function readBytesAsync(
    inputStream: Gio.InputStream,
    count = 4096,
    ioPriority = GLib.PRIORITY_DEFAULT,
    cancellable: Gio.Cancellable | null = null,
): Promise<Uint8Array | null> {
    return new Promise<Uint8Array | null>((resolve, reject) => {
        inputStream.read_bytes_async(count, ioPriority, cancellable, (_self, asyncRes) => {
            try {
                const res = inputStream.read_bytes_finish(asyncRes);
                if (res.get_size() === 0) {
                    return resolve(null);
                }
                return resolve(gbytesToUint8Array(res));
            } catch (error) {
                // Soup3's chunked-decoding input stream raises one of these at the end
                // of some npm-CDN-style responses, where the upstream closes the
                // connection at a non-chunk boundary. The full payload has already been
                // delivered by then, so propagating it would fail `Body.text()` with
                // "Invalid response body" mid-read.
                const e = error as { matches?: (a: unknown, b: unknown) => boolean };
                if (
                    typeof e.matches === 'function' &&
                    (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PARTIAL_INPUT) ||
                        e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CONNECTION_CLOSED) ||
                        e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.BROKEN_PIPE) ||
                        e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CLOSED))
                ) {
                    return resolve(null);
                }
                reject(error);
            }
        });
    });
}

/** Yields `Uint8Array` chunks from a `Gio.InputStream` until EOF. */
export async function* inputStreamAsyncIterator(
    inputStream: Gio.InputStream,
    count = 4096,
    ioPriority = GLib.PRIORITY_DEFAULT,
    cancellable: Gio.Cancellable | null = null,
): AsyncGenerator<Uint8Array> {
    let chunk: Uint8Array | null;
    while ((chunk = await readBytesAsync(inputStream, count, ioPriority, cancellable)) !== null) {
        yield chunk;
    }
}
