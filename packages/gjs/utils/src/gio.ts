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
