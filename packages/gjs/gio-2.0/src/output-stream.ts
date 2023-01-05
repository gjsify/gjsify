import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';

// This interface is used for pseudo extend Gio.OutputStream
export interface ExtOutputStream extends Gio.OutputStream {}

export class ExtOutputStream<T extends Gio.OutputStream = Gio.OutputStream> /*implements Iterable<Uint8Array>, AsyncIterable<Uint8Array>*/ {

    /**
     * Creates a new instance of `ExtOutputStream` based on a existing `Gio.OutputStream` instance.
     * @param outputStream The original unextended `Gio.OutputStream`
     * @returns The Gio.OutputStream` extended to `ExtOutputStream`
     */
    protected constructor(outputStream: T) {
        const extOutputStream = outputStream as T & ExtOutputStream<T>;
        extOutputStream.spliceAsync = this.spliceAsync;

        // extOutputStream[Symbol.iterator] = self[Symbol.iterator].bind(extOutputStream);
        // extOutputStream[Symbol.asyncIterator] = self[Symbol.asyncIterator].bind(extOutputStream);
        return extOutputStream;
    }

    /**
     * Creates a new instance of `ExtOutputStream` based on a existing `Gio.OutputStream` instance.
     * @param outputStream The original unextended `Gio.OutputStream`
     * @returns The Gio.OutputStream` extended to `ExtOutputStream`
     */
    static extend<T extends Gio.OutputStream = Gio.OutputStream>(outputStream: T) {
        return new this(outputStream) as T & ExtOutputStream<T>;
    }

    /**
     * Creates a new instance of `Gio.MemoryOutputStream` extended to `ExtInputStream`
     * @param config 
     * @returns 
     */
     static newMemoryOutputStream(config: Gio.MemoryOutputStream.ConstructorProperties = {}) {
        const memoryOutputStream = new Gio.MemoryOutputStream(config);
        return new this<Gio.MemoryOutputStream>(memoryOutputStream);
    }


    /**
     * Creates a new instance of `Gio.MemoryOutputStream.new_resizable()` extended to `ExtInputStream`
     * @param config 
     * @returns 
     */
     static newMemoryOutputStreamResizable(config: Gio.MemoryOutputStream.ConstructorProperties = {}) {
        const memoryOutputStream = Gio.MemoryOutputStream.new_resizable();
        return new this<Gio.MemoryOutputStream>(memoryOutputStream);
    }

    /**
     * Promise version of `Gio.OutputStream.splice_async` / `Gio.OutputStream.splice_finish`-
     * Splices an input stream into an output stream.
     * 
     * @param source a #GInputStream.
     * @param flags a set of #GOutputStreamSpliceFlags.
     * @param ioPriority the io priority of the request.
     * @param cancellable optional #GCancellable object, %NULL to ignore.
     * @returns 
     */
    public async spliceAsync(source: Gio.InputStream, flags: Gio.OutputStreamSpliceFlags = Gio.OutputStreamSpliceFlags.CLOSE_TARGET | Gio.OutputStreamSpliceFlags.CLOSE_SOURCE, ioPriority: number = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        return new Promise<number>((resolve, reject) => {
            this.splice_async(source, flags, ioPriority, cancellable, (self, asyncRes) => {
                try {
                    const res = this.splice_finish(asyncRes);
                    return resolve(res);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

}