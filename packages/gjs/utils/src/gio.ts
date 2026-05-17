import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

const byteArray = imports.byteArray;

/**
 * Generic promise wrapper for Gio async/finish method pairs.
 *
 * Example:
 *   const stream = await gioAsync<Gio.InputStream>(session, 'send_async', 'send_finish', msg, priority, null);
 */
export function gioAsync<T>(
    obj: any,
    asyncMethod: string,
    finishMethod: string,
    ...args: any[]
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        obj[asyncMethod](...args, (_self: any, asyncRes: Gio.AsyncResult) => {
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
 * Returns a `Uint8Array` or `null` if the end of the stream is reached.
 *
 * Treats `G_IO_ERROR_PARTIAL_INPUT` as EOF: Soup3's chunked-decoding input
 * stream surfaces this when the upstream closes the connection cleanly at a
 * non-chunk boundary (common on the npm registry CDN). Without this, the
 * fetch `Body.text()` path raises "Invalid response body" mid-read even
 * though the full payload has already arrived. Bubble all other errors.
 */
export async function readBytesAsync(
    inputStream: Gio.InputStream,
    count = 4096,
    ioPriority = GLib.PRIORITY_DEFAULT,
    cancellable: Gio.Cancellable | null = null
): Promise<Uint8Array | null> {
    return new Promise<Uint8Array | null>((resolve, reject) => {
        inputStream.read_bytes_async(count, ioPriority, cancellable, (_self, asyncRes) => {
            try {
                const res = inputStream.read_bytes_finish(asyncRes);
                if (res.get_size() === 0) {
                    return resolve(null);
                }
                return resolve(byteArray.fromGBytes(res));
            } catch (error) {
                // Soup3's chunked-decoding input stream raises a clean-stream-
                // end error (G_IO_ERROR_PARTIAL_INPUT / CONNECTION_CLOSED /
                // BROKEN_PIPE / CLOSED) at the end of some npm-CDN-style
                // responses when the upstream closes the connection at a
                // non-chunk boundary. By that point the full payload has
                // already been delivered to the consumer, so treat these as
                // EOF instead of propagating.
                const e = error as { matches?: (a: unknown, b: unknown) => boolean };
                if (typeof e.matches === 'function' && (
                    e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PARTIAL_INPUT) ||
                    e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CONNECTION_CLOSED) ||
                    e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.BROKEN_PIPE) ||
                    e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CLOSED))) {
                    return resolve(null);
                }
                reject(error);
            }
        });
    });
}

/**
 * Async generator that yields `Uint8Array` chunks from a `Gio.InputStream`.
 */
export async function* inputStreamAsyncIterator(
    inputStream: Gio.InputStream,
    count = 4096,
    ioPriority = GLib.PRIORITY_DEFAULT,
    cancellable: Gio.Cancellable | null = null
): AsyncGenerator<Uint8Array> {
    let chunk: Uint8Array | null;
    while ((chunk = await readBytesAsync(inputStream, count, ioPriority, cancellable)) !== null) {
        yield chunk;
    }
}
