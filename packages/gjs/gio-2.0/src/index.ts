import { byteArray } from '@gjsify/types/Gjs';
import Gio from '@gjsify/types/Gio-2.0';
import GObject from '@gjsify/types/GObject-2.0';
import GLib from '@gjsify/types/GLib-2.0';


class _DataInputStream extends Gio.DataInputStream implements Iterable<Uint8Array>, AsyncIterable<Uint8Array> {

    private _defaultCount = 4096;

    set defaultCount(count: number) {
        this._defaultCount = count;
    }

    get defaultCount() {
        return this._defaultCount;
    }

    readBytes(count: number = this.defaultCount, cancellable: Gio.Cancellable | null = null) {
        const res = this.read_bytes(count, cancellable);
        if(res.get_size() === 0) {
            return null;
        }
        return byteArray.fromGBytes(res);
    }

    /**
     * Promise version of read_line_async / read_line_finish
     * @param ioPriority — the [I/O priority][io-priority] of the request
     * @param cancellable — optional #GCancellable object, %NULL to ignore.
     * @return The data or null if the end is reached
     */
    async readLinePromise(ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        return new Promise<Uint8Array | null>((resolve, reject) => {
            this.read_line_async(ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const [res, length] = this.read_line_finish(asyncRes);
                    if(length === 0) {
                        return resolve(null);
                    }
                    return resolve(res);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Promise version of read_bytes_async / read_bytes_finish
     * @param count — the number of bytes that will be read from the stream
     * @param ioPriority — the [I/O priority][io-priority] of the request
     * @param cancellable — optional #GCancellable object, %NULL to ignore.
     * @return The data or null if the end is reached
     */
    async readBytesPromise(count = this.defaultCount, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable = null) {
        return new Promise<Uint8Array | null>((resolve, reject) => {
            this.read_bytes_async(count, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const res = this.read_bytes_finish(asyncRes);
                    const byte = byteArray.fromGBytes(res)
                    if(res.get_size() === 0) {
                        return resolve(null);
                    }
                    return resolve(byte);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * @param count — maximum number of bytes that will be read from the stream. Common values include 4096 and 8192.
     * @param cancellable — optional #GCancellable object, %NULL to ignore.
     */
    *[Symbol.iterator](count = this.defaultCount, cancellable: Gio.Cancellable = null) {
        let chunk: Uint8Array | null;
        while ((chunk = this.readBytes(count, cancellable)) !== null) {
            yield chunk
        }
    }

    async *[Symbol.asyncIterator](count = this.defaultCount, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable = null) {
        let chunk: Uint8Array | null;
        while ((chunk = (await this.readBytesPromise(count, ioPriority, cancellable))) !== null) {
            yield chunk
        }
    }
}

// Get GObject compatible version of the new class
export const DataInputStream: typeof _DataInputStream = GObject.registerClass({
    GTypeName: 'DataInputStream',
}, _DataInputStream);