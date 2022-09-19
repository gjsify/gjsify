import { byteArray } from '@gjsify/types/Gjs';
import Gio from '@gjsify/types/Gio-2.0';
import GLib from '@gjsify/types/GLib-2.0';
import { Readable, ReadableOptions } from 'stream';

// This interface is used for pseudo extend Gio.InputStream
export interface ExtInputStream extends Gio.InputStream {}

/**
 * Extended version of Gio.InputStream.
 * 
 * Features:
 *  * Implements `Iterable`
 *  * Implements `AsyncIterable`
 *  * Easier to use version of `read_bytes`
 *  * Promise version of `readBytesAsync`
 *  * You can set the default buffer size#
 *  * Multiple pseudo constructor for creating different input stream types
 */
export class ExtInputStream<T extends Gio.InputStream = Gio.InputStream> implements Iterable<Uint8Array>, AsyncIterable<Uint8Array> {

    /** Maximum default number of bytes that will be read from the stream. Common values include `4096` and `8192`. */
    defaultBytesSize = 4096;

    protected constructor(inputStream: T) {
        const extInputStream = inputStream as T & ExtInputStream;
        extInputStream.defaultBytesSize = this.defaultBytesSize;
        extInputStream.toReadable = this.toReadable.bind(extInputStream);
        extInputStream.toReadableStream = this.toReadableStream.bind(extInputStream);
        extInputStream.readBytes = this.readBytes.bind(extInputStream);
        extInputStream.readBytesAsync = this.readBytesAsync.bind(extInputStream);
        extInputStream.spliceAsync = this.spliceAsync.bind(extInputStream);
        extInputStream[Symbol.iterator] = this[Symbol.iterator].bind(extInputStream);
        extInputStream[Symbol.asyncIterator] = this[Symbol.asyncIterator].bind(extInputStream);
        return extInputStream;
    }

    /**
     * Creates a new instance of `ExtInputStream` extended on a existing `Gio.InputStream` instance.
     * @param inputStream The original unextended `Gio.InputStream`
     * @returns The Gio.InputStream` extended to `ExtInputStream`
     */
    static extend<T extends Gio.InputStream = Gio.InputStream>(inputStream: T) {
        return new this(inputStream) as T & ExtInputStream<T>;
    }

    /**
     * Creates a new instance of `Gio.DataInputStream` extended to `ExtInputStream`
     * @param config 
     * @returns 
     */
    static newDataInputStream(config: Gio.DataInputStream.ConstructorProperties = {}) {
        const dataInputStream = new Gio.DataInputStream(config);
        return this.extend<Gio.DataInputStream>(dataInputStream)
    }

    /**
     * Creates a new instance of `Gio.InputStream` extended to `ExtInputStream`
     * @param config 
     * @returns 
     */
    static newInputStream(config: Gio.InputStream.ConstructorProperties = {}) {
        const inputStream = new Gio.InputStream(config);
        return this.extend<Gio.InputStream>(inputStream)
    }

    /**
     * Creates a new instance of `Gio.DataInputStream` extended to `ExtInputStream` for a new `Gio.File` by `path`
     * @param path The file path 
     * @returns 
     */
    static newForFilePath(path: string) {
        // A reference to our file
        const file = Gio.File.new_for_path(path);
        // File should exists
        if(!file.query_exists(null)) {
            throw new Error(`File not found on path "${path}"`);
        }

        return this.newDataInputStream({ base_stream: file.read(null) });
    }

    /**
     * Transforms the `ExtInputStream` to a instance of a Node.js compatible `Readable`.
     * @param options 
     * @returns 
     */
    public toReadable(options: ReadableOptions = {}) {
        return Readable.from(this, options);
    }

    /**
     * Transforms the `ExtInputStream` to a instance of a Web compatible `ReadableStream`.
     * @param options 
     * @returns 
     */
    public toReadableStream(options: ReadableOptions = {}) {
        return Readable.toWeb(this.toReadable(options))
    }

    /**
     * This method is similar to `read_bytes` but returns an `Uint8Array` or null if the end of the stream is reached
     * @param count The number of bytes that will be read from the stream
     * @param cancellable `Gio.Cancellable` object, `null` to ignore.
     * @return The data or null if the end is reached
     */
    public readBytes(count: number = this.defaultBytesSize, cancellable: Gio.Cancellable | null = null): Uint8Array | null {
        const res = this.read_bytes(count, cancellable);
        if(res.get_size() === 0) {
            return null;
        }
        return byteArray.fromGBytes(res);
    }

    /**
     * Promise version of `Gio.InputStream.read_bytes_async` / `Gio.InputStream.read_bytes_finish`
     * @param count The number of bytes that will be read from the stream
     * @param ioPriority The I/O priority of the request
     * @param cancellable `Gio.Cancellable` object, `null` to ignore.
     * @return The data or null if the end is reached
     */
    public async readBytesAsync(count = this.defaultBytesSize, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null): Promise<Uint8Array | null> {
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
     * Splices this input stream into an output stream.
     * 
     * @param targetOutputStream The `Gio.OutputStream` you want to use, by default this is a new resizable `Gio.MemoryOutputStream`
     * @param flags a set of #GOutputStreamSpliceFlags.
     * @param ioPriority the io priority of the request.
     * @param cancellable optional #GCancellable object, %NULL to ignore.
     * @returns 
     */
    public async spliceAsync<K extends Gio.MemoryOutputStream = Gio.MemoryOutputStream>(targetOutputStream?: undefined, flags?: Gio.OutputStreamSpliceFlags, ioPriority?: number, cancellable?: Gio.Cancellable | null): Promise<ExtOutputStream<Gio.MemoryOutputStream> & Gio.MemoryOutputStream>
    public async spliceAsync<K extends Gio.OutputStream = Gio.OutputStream>(targetOutputStream: K, flags?: Gio.OutputStreamSpliceFlags, ioPriority?: number, cancellable?: Gio.Cancellable | null): Promise<ExtOutputStream<Gio.OutputStream> & K>
    public async spliceAsync(targetOutputStream?: Gio.OutputStream, flags: Gio.OutputStreamSpliceFlags = Gio.OutputStreamSpliceFlags.CLOSE_TARGET | Gio.OutputStreamSpliceFlags.CLOSE_SOURCE, ioPriority: number = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        
        if(!targetOutputStream) {
            const extTargetOutputStream = ExtOutputStream.newMemoryOutputStreamResizable();
            const numRes = await extTargetOutputStream.spliceAsync(this, flags, ioPriority, cancellable);
            return extTargetOutputStream;
        }
        
        const extTargetOutputStream = ExtOutputStream.extend(targetOutputStream);
        const numRes = await extTargetOutputStream.spliceAsync(this, flags, ioPriority, cancellable);
        return extTargetOutputStream;
    }

    /**
     * 
     * @param count The number of bytes that will be read from the stream
     * @param cancellable `Gio.Cancellable` object, `null` to ignore.
     */
    public *[Symbol.iterator](count = this.defaultBytesSize, cancellable: Gio.Cancellable | null = null) {
        let chunk: Uint8Array | null;
        while ((chunk = this.readBytes(count, cancellable)) !== null) {
            yield chunk
        }
    }

    /**
     * 
     * @param count — The number of bytes that will be read from the stream
     * @param ioPriority — The I/O priority of the request
     * @param cancellable — `Gio.Cancellable` object, `null` to ignore.
     */
    public async *[Symbol.asyncIterator](count = this.defaultBytesSize, ioPriority = GLib.PRIORITY_DEFAULT, cancellable: Gio.Cancellable | null = null) {
        let chunk: Uint8Array | null;
        while ((chunk = (await this.readBytesAsync(count, ioPriority, cancellable))) !== null) {
            yield chunk
        }
    }
}

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
