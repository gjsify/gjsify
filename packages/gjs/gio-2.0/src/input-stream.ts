import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import { ExtOutputStream } from './output-stream.js'

import { Readable } from 'stream';
import type { ReadableOptions } from 'stream';

const byteArray = imports.byteArray;

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
 *  * You can set the default buffer size
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
        return Readable.toWeb(this.toReadable(options)) as ReadableStream<any>;
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