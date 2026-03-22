import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';
import { Readable } from 'stream';
import type { ReadableOptions } from 'node:stream';
import { inputStreamAsyncIterator } from '@gjsify/utils';

/**
 * Promise wrapper around `Soup.Session.send_async` / `send_finish`.
 */
export async function soupSendAsync(
    session: Soup.Session,
    msg: Soup.Message,
    ioPriority = GLib.PRIORITY_DEFAULT,
    cancellable: Gio.Cancellable | null = null
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
 * Converts a `Gio.InputStream` to a Node.js `Readable` stream.
 */
export function inputStreamToReadable(
    inputStream: Gio.InputStream,
    options: ReadableOptions = {}
): Readable {
    return Readable.from(inputStreamAsyncIterator(inputStream), options);
}
