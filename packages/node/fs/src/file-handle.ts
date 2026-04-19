// Reference: Node.js lib/internal/fs/promises.js (FileHandle)
// Reimplemented for GJS using Gio.File

import { warnNotImplemented, notImplemented, createGLibFileError } from '@gjsify/utils';
import { ReadStream } from "./read-stream.js";
import { WriteStream } from "./write-stream.js";
import { Stats } from "./stats.js";
import { getEncodingFromOptions, encodeUint8Array } from './encoding.js';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
// Type-only import for ReadableStream — the runtime constructor is resolved
// via globalThis inside readableWebStream() to avoid bundling the entire
// WHATWG streams implementation for apps that never call this method.
import type { ReadableStream } from "node:stream/web";
import { Buffer } from "node:buffer";

import type { Abortable } from 'node:events';
import type {
    FlagAndOpenMode,
    FileReadResult,
    FileReadOptions,
    OpenFlags,
} from './types/index.js';
import type { FileHandle as IFileHandle, CreateReadStreamOptions, CreateWriteStreamOptions } from 'node:fs/promises';
import type {
    ObjectEncodingOptions,
    Mode,
    OpenMode,
    PathLike,
    StatOptions,
    BigIntStats,
    WriteVResult,
    ReadVResult,
    ReadPosition,
} from 'node:fs';
import type { Interface as ReadlineInterface } from 'node:readline';

// POSIX numeric open(2) flags (values on Linux x86-64).
const O_WRONLY = 1;
const O_RDWR   = 2;
const O_CREAT  = 64;
const O_TRUNC  = 512;
const O_APPEND = 1024;

type IOMode = 'r' | 'r+' | 'w' | 'w+' | 'a' | 'a+';

/**
 * Convert open flags (Node.js string or POSIX numeric) to a GLib.IOChannel mode.
 * IOChannel.new_file() takes fopen(3) modes: 'r', 'r+', 'w', 'w+', 'a', 'a+'.
 */
function resolveIOMode(flags: OpenFlags | number | undefined): IOMode {
    if (flags === undefined || flags === null) return 'r';
    if (typeof flags === 'number') {
        const rdwr   = (flags & O_RDWR)   !== 0;
        const wronly = (flags & O_WRONLY) !== 0;
        const append = (flags & O_APPEND) !== 0;
        const trunc  = (flags & O_TRUNC)  !== 0;
        if (rdwr)   return trunc ? 'w+' : 'r+';
        if (wronly) return append ? 'a' : 'w';
        return 'r';
    }
    // Node.js string flags — map extras to IOChannel equivalents.
    switch (flags) {
        case 'ax': case 'wx':   return 'w';
        case 'ax+': case 'wx+': return 'w+';
        case 'as': case 'rs+':  return 'r+';
        case 'as+':             return 'a+';
        default:                return flags as IOMode;
    }
}

/**
 * Open the file with the given IOChannel mode. When the flags request
 * create-if-missing + read/write without truncation (numeric O_CREAT | O_RDWR,
 * which maps to IOChannel 'r+' — a mode that requires the file to exist), we
 * catch the ENOENT and create an empty file, then retry. This avoids a TOCTOU
 * existence check and keeps the common "file exists" path to a single syscall.
 */
function openIOChannel(path: string, mode: IOMode, creat: boolean): GLib.IOChannel {
    try {
        return GLib.IOChannel.new_file(path, mode);
    } catch (err) {
        const gErr = err as { code?: number } | null | undefined;
        if (creat && mode === 'r+' && gErr?.code === GLib.FileError.NOENT) {
            GLib.file_set_contents(path, new Uint8Array(0));
            return GLib.IOChannel.new_file(path, mode);
        }
        throw err;
    }
}

function mapOpenError(err: unknown, path: string): NodeJS.ErrnoException {
    // GLib.IOChannel.new_file() always throws GLib.FileError (not Gio.IOErrorEnum).
    return createGLibFileError(err, 'open', { path }) as NodeJS.ErrnoException;
}

export class FileHandle implements IFileHandle {

    /** Not part of the default implementation, used internal by gjsify */
    private _file: GLib.IOChannel;

    /**
     * Lazily-opened Gio streams for positional read() / write() so each call does
     * not re-load the entire file via Gio.File.load_contents(). The IOStream is
     * used when the handle was opened with write capability (r+, w, w+, a, a+) —
     * it shares seek state between input and output so writes are visible to
     * subsequent reads without a flush. For read-only handles we only open a
     * FileInputStream; trying to open_readwrite on a read-only file can fall
     * back to create_readwrite(REPLACE_DESTINATION) which would truncate it.
     */
    private _ioStream: Gio.FileIOStream | null = null;
    private _readStream: Gio.FileInputStream | null = null;
    private readonly _gFile: Gio.File;
    private readonly _ioMode: IOMode;

    /** Not part of the default implementation, used internal by gjsify */
    private static instances: {[fd: number]: FileHandle} = {};

    constructor(readonly options: {
        path: PathLike,
        flags?: OpenFlags | number,
        mode?: Mode
    }) {
        this.options.flags ||= "r";
        this.options.mode ||= 0o666;
        const pathStr = options.path.toString();
        const creat = typeof options.flags === 'number' && (options.flags & O_CREAT) !== 0;
        const ioMode = resolveIOMode(options.flags);
        try {
            this._file = openIOChannel(pathStr, ioMode, creat);
        } catch (err: unknown) {
            throw mapOpenError(err, pathStr);
        }
        // Binary mode: prevent GLib from doing any character set conversion.
        this._file.set_encoding(null as unknown as string);
        this.fd = this._file.unix_get_fd();
        this._gFile = Gio.File.new_for_path(pathStr);
        this._ioMode = ioMode;

        FileHandle.instances[this.fd] = this;
        return FileHandle.getInstance(this.fd);
    }

    /**
     * Lazy-open the read-capable stream and return both the input stream and
     * its seekable view. Both FileInputStream (read-only handle) and
     * FileIOStream (read/write handle) implement Gio.Seekable, but we return
     * both to avoid callers needing to know which concrete type they got.
     */
    private _getReadStream(): { input: Gio.InputStream; seekable: Gio.Seekable } {
        if (this._ioStream) {
            return {
                input: this._ioStream.get_input_stream(),
                seekable: this._ioStream as unknown as Gio.Seekable,
            };
        }
        if (this._ioMode === 'r') {
            if (!this._readStream) this._readStream = this._gFile.read(null);
            return {
                input: this._readStream,
                seekable: this._readStream as unknown as Gio.Seekable,
            };
        }
        // open_readwrite requires the file to exist. For modes that imply
        // create-if-missing (w, w+, a, a+) the IOChannel already created it
        // above; for 'r+' openIOChannel() catches ENOENT and pre-creates it.
        this._ioStream = this._gFile.open_readwrite(null);
        return {
            input: this._ioStream.get_input_stream(),
            seekable: this._ioStream as unknown as Gio.Seekable,
        };
    }

    /** Lazy-open the write-capable stream (IOStream) for this handle. Only valid
     *  when the handle was opened with a write-capable mode. */
    private _getWriteStream(): Gio.FileIOStream {
        if (this._ioStream) return this._ioStream;
        if (this._ioMode === 'r') {
            throw new Error('FileHandle opened read-only; cannot write');
        }
        this._ioStream = this._gFile.open_readwrite(null);
        return this._ioStream;
    }


    /**
     * The numeric file descriptor managed by the {FileHandle} object.
     * @since v10.0.0
     */
    readonly fd: number;

    /** Not part of the default implementation, used internal by gjsify */
    static getInstance(fd: number) {
        const instance = FileHandle.instances[fd];
        if(!instance) {
            throw new Error("No instance found for fd!");
        }
        return FileHandle.instances[fd];
    }

    /**
     * Alias of `filehandle.writeFile()`.
     *
     * When operating on file handles, the mode cannot be changed from what it was set
     * to with `fsPromises.open()`. Therefore, this is equivalent to `filehandle.writeFile()`.
     * @since v10.0.0
     * @return Fulfills with `undefined` upon success.
     */
    async appendFile(data: string | Uint8Array, options?: (ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding | null): Promise<void> {
        const encoding = getEncodingFromOptions(options);
        if (typeof data === 'string') {
            data = Buffer.from(data);
        }

        if (encoding) this._file.set_encoding(encoding);

        const [status, written] = this._file.write_chars(data, data.length);

        if(status === GLib.IOStatus.ERROR) {
            throw new Error("Error on append to file!")
        }

    }
    /**
     * Changes the ownership of the file. A wrapper for [`chown(2)`](http://man7.org/linux/man-pages/man2/chown.2.html).
     * @since v10.0.0
     * @param uid The file's new owner's user id.
     * @param gid The file's new group's group id.
     * @return Fulfills with `undefined` upon success.
     */
    async chown(uid: number, gid: number): Promise<void> {
        warnNotImplemented('fs.FileHandle.chown');
    }
    /**
     * Modifies the permissions on the file. See [`chmod(2)`](http://man7.org/linux/man-pages/man2/chmod.2.html).
     * @since v10.0.0
     * @param mode the file mode bit mask.
     * @return Fulfills with `undefined` upon success.
     */
    async chmod(mode: Mode): Promise<void> {
        warnNotImplemented('fs.FileHandle.chmod');
    }
    /**
     * Unlike the 16 kb default `highWaterMark` for a `stream.Readable`, the stream
     * returned by this method has a default `highWaterMark` of 64 kb.
     *
     * `options` can include `start` and `end` values to read a range of bytes from
     * the file instead of the entire file. Both `start` and `end` are inclusive and
     * start counting at 0, allowed values are in the
     * \[0, [`Number.MAX_SAFE_INTEGER`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)\] range. If `start` is
     * omitted or `undefined`, `filehandle.createReadStream()` reads sequentially from
     * the current file position. The `encoding` can be any one of those accepted by `Buffer`.
     *
     * If the `FileHandle` points to a character device that only supports blocking
     * reads (such as keyboard or sound card), read operations do not finish until data
     * is available. This can prevent the process from exiting and the stream from
     * closing naturally.
     *
     * By default, the stream will emit a `'close'` event after it has been
     * destroyed.  Set the `emitClose` option to `false` to change this behavior.
     *
     * ```js
     * import { open } from 'node:fs/promises';
     *
     * const fd = await open('/dev/input/event0');
     * // Create a stream from some character device.
     * const stream = fd.createReadStream();
     * setTimeout(() => {
     *   stream.close(); // This may not close the stream.
     *   // Artificially marking end-of-stream, as if the underlying resource had
     *   // indicated end-of-file by itself, allows the stream to close.
     *   // This does not cancel pending read operations, and if there is such an
     *   // operation, the process may still not be able to exit successfully
     *   // until it finishes.
     *   stream.push(null);
     *   stream.read(0);
     * }, 100);
     * ```
     *
     * If `autoClose` is false, then the file descriptor won't be closed, even if
     * there's an error. It is the application's responsibility to close it and make
     * sure there's no file descriptor leak. If `autoClose` is set to true (default
     * behavior), on `'error'` or `'end'` the file descriptor will be closed
     * automatically.
     *
     * An example to read the last 10 bytes of a file which is 100 bytes long:
     *
     * ```js
     * import { open } from 'node:fs/promises';
     *
     * const fd = await open('sample.txt');
     * fd.createReadStream({ start: 90, end: 99 });
     * ```
     * @since v16.11.0
     */
    createReadStream(options?: CreateReadStreamOptions): ReadStream {
        return new ReadStream(this.options.path, options);
    }
    /**
     * `options` may also include a `start` option to allow writing data at some
     * position past the beginning of the file, allowed values are in the
     * \[0, [`Number.MAX_SAFE_INTEGER`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)\] range. Modifying a file rather than
     * replacing it may require the `flags` `open` option to be set to `r+` rather than
     * the default `r`. The `encoding` can be any one of those accepted by `Buffer`.
     *
     * If `autoClose` is set to true (default behavior) on `'error'` or `'finish'`the file descriptor will be closed automatically. If `autoClose` is false,
     * then the file descriptor won't be closed, even if there's an error.
     * It is the application's responsibility to close it and make sure there's no
     * file descriptor leak.
     *
     * By default, the stream will emit a `'close'` event after it has been
     * destroyed.  Set the `emitClose` option to `false` to change this behavior.
     * @since v16.11.0
     */
    createWriteStream(options?: CreateWriteStreamOptions): WriteStream {
        return new WriteStream(this.options.path, options);
    }
    /**
     * Forces all currently queued I/O operations associated with the file to the
     * operating system's synchronized I/O completion state. Refer to the POSIX [`fdatasync(2)`](http://man7.org/linux/man-pages/man2/fdatasync.2.html) documentation for details.
     *
     * Unlike `filehandle.sync` this method does not flush modified metadata.
     * @since v10.0.0
     * @return Fulfills with `undefined` upon success.
     */
    async datasync(): Promise<void> {
        warnNotImplemented('fs.FileHandle.datasync');
    }
    /**
     * Request that all data for the open file descriptor is flushed to the storage
     * device. The specific implementation is operating system and device specific.
     * Refer to the POSIX [`fsync(2)`](http://man7.org/linux/man-pages/man2/fsync.2.html) documentation for more detail.
     * @since v10.0.0
     * @return Fufills with `undefined` upon success.
     */
    async sync(): Promise<void> {
        warnNotImplemented('fs.FileHandle.sync');
    }
    /**
     * Reads data from the file and stores that in the given buffer.
     *
     * If the file is not modified concurrently, the end-of-file is reached when the
     * number of bytes read is zero.
     * @since v10.0.0
     * @param buffer A buffer that will be filled with the file data read.
     * @param offset The location in the buffer at which to start filling.
     * @param length The number of bytes to read.
     * @param position The location where to begin reading data from the file. If `null`, data will be read from the current file position, and the position will be updated. If `position` is an
     * integer, the current file position will remain unchanged.
     * @return Fulfills upon success with an object with two properties:
     */
    async read<T extends NodeJS.ArrayBufferView>(buffer: T, offset?: number | null, length?: number | null, position?: ReadPosition | null): Promise<FileReadResult<T>>
    async read<T extends NodeJS.ArrayBufferView = Buffer>(options?: FileReadOptions<T>): Promise<FileReadResult<T>>

    async read<T extends NodeJS.ArrayBufferView = Buffer>(...args: any[]): Promise<FileReadResult<T>> {
        let buffer: T | undefined;
        let offset: number | null | undefined;
        let length: number | null | undefined;
        let position: number | null | undefined;

        if (typeof args[0] === 'object' && !(args[0] instanceof Uint8Array) && !(args[0] instanceof Buffer)) {
            const options: FileReadOptions<T> = args[0];
            buffer = options.buffer;
            offset = options.offset;
            length = options.length;
            position = options.position;
        } else {
            buffer = args[0];
            offset = args[1];
            length = args[2];
            position = args[3];
        }

        const bufView = buffer as unknown as Uint8Array;
        const bufOffset = offset ?? 0;
        const readLength = length ?? bufView?.byteLength ?? 65536;
        const startPos = (position as number | null) ?? 0;

        // Positional read — seek + read_bytes on the appropriate Gio stream,
        // touching only the requested region. Replaces the old load_contents()
        // path that read the entire file on every call (O(N²) over streamed
        // workloads like WebTorrent piece hashing or random-access-file).
        const { input, seekable } = this._getReadStream();
        seekable.seek(BigInt(startPos), GLib.SeekType.SET, null);
        const bytes = input.read_bytes(readLength, null);
        const data = bytes.get_data() as Uint8Array | null;
        const bytesRead = data?.length ?? 0;
        if (bufView && data && bytesRead > 0) {
            bufView.set(data, bufOffset);
        }

        return {
            bytesRead,
            buffer: buffer as T,
        };
    }
    /**
     * Returns a `ReadableStream` that may be used to read the files data.
     *
     * An error will be thrown if this method is called more than once or is called after the `FileHandle` is closed
     * or closing.
     *
     * ```js
     * import { open } from 'node:fs/promises';
     *
     * const file = await open('./some/file/to/read');
     *
     * for await (const chunk of file.readableWebStream())
     *   console.log(chunk);
     *
     * await file.close();
     * ```
     *
     * While the `ReadableStream` will read the file to completion, it will not close the `FileHandle` automatically. User code must still call the `fileHandle.close()` method.
     *
     * @since v17.0.0
     * @experimental
     */
    readableWebStream(): ReadableStream {
        // Resolve ReadableStream lazily from globalThis to keep the
        // WHATWG streams implementation out of the bundle when this method
        // is not actually used.
        const Ctor = (globalThis as { ReadableStream?: typeof globalThis.ReadableStream }).ReadableStream;
        if (typeof Ctor !== 'function') {
            throw new Error(
                'readableWebStream() requires a global ReadableStream. Import "node:stream/web" or "@gjsify/streams" before calling this method.',
            );
        }
        return new Ctor() as unknown as ReadableStream;
    }
    /**
     * Asynchronously reads the entire contents of a file.
     *
     * If `options` is a string, then it specifies the `encoding`.
     *
     * The `FileHandle` has to support reading.
     *
     * If one or more `filehandle.read()` calls are made on a file handle and then a`filehandle.readFile()` call is made, the data will be read from the current
     * position till the end of the file. It doesn't always read from the beginning
     * of the file.
     * @since v10.0.0
     * @return Fulfills upon a successful read with the contents of the file. If no encoding is specified (using `options.encoding`), the data is returned as a {Buffer} object. Otherwise, the
     * data will be a string.
     */
    async readFile(
        options?: {
            encoding?: null | undefined;
            flag?: OpenMode | undefined;
        } | null
    ): Promise<Buffer<ArrayBuffer>>
    /**
     * Asynchronously reads the entire contents of a file. The underlying file will _not_ be closed automatically.
     * The `FileHandle` must have been opened for reading.
     * @param options An object that may contain an optional flag.
     * If a flag is not provided, it defaults to `'r'`.
     */
    async readFile(
        options:
            | {
                  encoding: BufferEncoding;
                  flag?: OpenMode | undefined;
              }
            | BufferEncoding
    ): Promise<string>
    /**
     * Asynchronously reads the entire contents of a file. The underlying file will _not_ be closed automatically.
     * The `FileHandle` must have been opened for reading.
     * @param options An object that may contain an optional flag.
     * If a flag is not provided, it defaults to `'r'`.
     */
    async readFile(
        options?:
            | (ObjectEncodingOptions & {
                  flag?: OpenMode | undefined;
              })
            | BufferEncoding
            | null
    ): Promise<string | Buffer<ArrayBuffer>> {
        const encoding = getEncodingFromOptions(options, 'buffer');
        if (encoding) this._file.set_encoding(encoding);

        const [status, buf] = this._file.read_to_end();

        if(status === GLib.IOStatus.ERROR) {
            throw new Error("Error on read from file!")
        }

        const res = encodeUint8Array(encoding, buf);

        return res;
    }
    /**
     * Convenience method to create a `readline` interface and stream over the file. For example:
     *
     * ```js
     * import { open } from 'node:fs/promises';
     *
     * const file = await open('./some/file/to/read');
     *
     * for await (const line of file.readLines()) {
     *   console.log(line);
     * }
     * ```
     *
     * @since v18.11.0
     * @param options See `filehandle.createReadStream()` for the options.
     */
    readLines(options?: CreateReadStreamOptions): ReadlineInterface {
        notImplemented('fs.FileHandle.readLines');
    }
    /**
     * @since v10.0.0
     * @return Fulfills with an {fs.Stats} for the file.
     */
    async stat(
        opts?: StatOptions & {
            bigint?: false | undefined;
        }
    ): Promise<Stats>
    async stat(
        opts: StatOptions & {
            bigint: true;
        }
    ): Promise<BigIntStats>
    async stat(opts?: StatOptions): Promise<Stats | BigIntStats> {
        warnNotImplemented('fs.FileHandle.stat');
        return new Stats(this.options.path.toString());
    }
    /**
     * Truncates the file.
     *
     * If the file was larger than `len` bytes, only the first `len` bytes will be
     * retained in the file.
     *
     * The following example retains only the first four bytes of the file:
     *
     * ```js
     * import { open } from 'node:fs/promises';
     *
     * let filehandle = null;
     * try {
     *   filehandle = await open('temp.txt', 'r+');
     *   await filehandle.truncate(4);
     * } finally {
     *   await filehandle?.close();
     * }
     * ```
     *
     * If the file previously was shorter than `len` bytes, it is extended, and the
     * extended part is filled with null bytes (`'\0'`):
     *
     * If `len` is negative then `0` will be used.
     * @since v10.0.0
     * @param [len=0]
     * @return Fulfills with `undefined` upon success.
     */
    async truncate(len: number = 0): Promise<void> {
        const effectiveLen = Math.max(0, len);
        this._file.flush();
        // Gio.FileOutputStream implements Seekable.truncate — extends with zeros
        // when growing, matches POSIX ftruncate(2).
        const out = this._getWriteStream().get_output_stream() as Gio.FileOutputStream;
        out.truncate(effectiveLen, null);
    }
    /**
     * Change the file system timestamps of the object referenced by the `FileHandle` then resolves the promise with no arguments upon success.
     * @since v10.0.0
     */
    async utimes(atime: string | number | Date, mtime: string | number | Date): Promise<void> {
        warnNotImplemented('fs.FileHandle.utimes');
    }
    /**
     * Asynchronously writes data to a file, replacing the file if it already exists.`data` can be a string, a buffer, an
     * [AsyncIterable](https://tc39.github.io/ecma262/#sec-asynciterable-interface) or
     * [Iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#The_iterable_protocol) object.
     * The promise is resolved with no arguments upon success.
     *
     * If `options` is a string, then it specifies the `encoding`.
     *
     * The `FileHandle` has to support writing.
     *
     * It is unsafe to use `filehandle.writeFile()` multiple times on the same file
     * without waiting for the promise to be resolved (or rejected).
     *
     * If one or more `filehandle.write()` calls are made on a file handle and then a`filehandle.writeFile()` call is made, the data will be written from the
     * current position till the end of the file. It doesn't always write from the
     * beginning of the file.
     * @since v10.0.0
     */
    async writeFile(data: string | Uint8Array, options?: (ObjectEncodingOptions & FlagAndOpenMode & Abortable) | BufferEncoding | null): Promise<void> {
        const encoding = getEncodingFromOptions(options);
        let buf: Uint8Array;
        if (typeof data === 'string') {
            buf = Buffer.from(data, (encoding as BufferEncoding) || 'utf8');
        } else {
            buf = data;
        }
        this._file.seek_position(0, GLib.SeekType.SET);
        const [status] = this._file.write_chars(buf, buf.length);
        if (status === GLib.IOStatus.ERROR) {
            throw new Error("Error writing to file!");
        }
        this._file.flush();
    }
    /**
     * Write `buffer` to the file.
     *
     * The promise is resolved with an object containing two properties:
     *
     * It is unsafe to use `filehandle.write()` multiple times on the same file
     * without waiting for the promise to be resolved (or rejected). For this
     * scenario, use `filehandle.createWriteStream()`.
     *
     * On Linux, positional writes do not work when the file is opened in append mode.
     * The kernel ignores the position argument and always appends the data to
     * the end of the file.
     * @since v10.0.0
     * @param [offset=0] The start position from within `buffer` where the data to write begins.
     * @param [length=buffer.byteLength - offset] The number of bytes from `buffer` to write.
     * @param position The offset from the beginning of the file where the data from `buffer` should be written. If `position` is not a `number`, the data will be written at the current position.
     * See the POSIX pwrite(2) documentation for more detail.
     */
    async write<TBuffer extends NodeJS.ArrayBufferView>(
        buffer: TBuffer,
        offset?: number | null,
        length?: number | null,
        position?: number | null
    ): Promise<{
        bytesWritten: number;
        buffer: TBuffer;
    }>;
    async write<TBuffer extends Uint8Array>(
        buffer: TBuffer,
        options?: { offset?: number; length?: number; position?: number },
    ): Promise<{
        bytesWritten: number;
        buffer: TBuffer;
    }>;
    async write(
        data: string,
        position?: number | null,
        encoding?: BufferEncoding | null
    ): Promise<{
        bytesWritten: number;
        buffer: string;
    }>
    async write<TBuffer extends NodeJS.ArrayBufferView>(
        data: string | TBuffer,
        ...args: any[]
    ): Promise<{
    bytesWritten: number;
    buffer: string | TBuffer;
    }> {
        let position: number | null = null;
        let encoding: BufferEncoding | 'buffer' | null = null;
        let offset: number | null = null;
        let length: number | null = null;

        if(typeof data === 'string') {
            position = args[0];
            encoding = args[1];
        } else {
            offset = args[0];
            length = args[1];
            position = args[2];
        }

        encoding = getEncodingFromOptions(encoding, typeof data === 'string' ? 'utf8' : null);

        // Convert data to Uint8Array bytes
        let writeBuf: Uint8Array;
        if (typeof data === 'string') {
            writeBuf = new TextEncoder().encode(data);
        } else {
            writeBuf = data as unknown as Uint8Array;
        }
        const bufOffset = offset ?? 0;
        const writeLength = length ?? (writeBuf.byteLength - bufOffset);
        const writeSlice = writeBuf.slice(bufOffset, bufOffset + writeLength);
        const writePos = position ?? 0;

        // Positional write — seek + write_bytes on the IOStream, touches only
        // the requested region. Replaces the old load + splice + replace_contents
        // path (O(N²) over any streamed workload).
        const stream = this._getWriteStream();
        stream.seek(BigInt(writePos), GLib.SeekType.SET, null);
        const output = stream.get_output_stream();
        const bytesWritten = output.write_bytes(new GLib.Bytes(writeSlice), null);
        output.flush(null);

        return {
            bytesWritten,
            buffer: data
        }
    }
      

    /**
     * Write an array of [ArrayBufferView](https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView) s to the file.
     *
     * The promise is resolved with an object containing a two properties:
     *
     * It is unsafe to call `writev()` multiple times on the same file without waiting
     * for the promise to be resolved (or rejected).
     *
     * On Linux, positional writes don't work when the file is opened in append mode.
     * The kernel ignores the position argument and always appends the data to
     * the end of the file.
     * @since v12.9.0
     * @param position The offset from the beginning of the file where the data from `buffers` should be written. If `position` is not a `number`, the data will be written at the current
     * position.
     */
    async writev<TBuffers extends readonly NodeJS.ArrayBufferView[]>(buffers: TBuffers, position?: number): Promise<WriteVResult<TBuffers>> {
        warnNotImplemented('fs.FileHandle.writev');
        return {
            bytesWritten: 0,
            buffers: buffers as unknown as TBuffers,
        }
    }
    /**
     * Read from a file and write to an array of [ArrayBufferView](https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView) s
     * @since v13.13.0, v12.17.0
     * @param position The offset from the beginning of the file where the data should be read from. If `position` is not a `number`, the data will be read from the current position.
     * @return Fulfills upon success an object containing two properties:
     */
    async readv<TBuffers extends readonly NodeJS.ArrayBufferView[]>(buffers: TBuffers, position?: number): Promise<ReadVResult<TBuffers>> {
        warnNotImplemented('fs.FileHandle.readv');
        return {
            bytesRead: 0,
            buffers: buffers as unknown as TBuffers,
        }
    }
    /**
     * Closes the file handle after waiting for any pending operation on the handle to
     * complete.
     *
     * ```js
     * import { open } from 'node:fs/promises';
     *
     * let filehandle;
     * try {
     *   filehandle = await open('thefile.txt', 'r');
     * } finally {
     *   await filehandle?.close();
     * }
     * ```
     * @since v10.0.0
     * @return Fulfills with `undefined` upon success.
     */
    async close(): Promise<void> {
        // Close the Gio streams first; they own an fd wrapping the same file
        // as the IOChannel. IOChannel.shutdown(true) flushes + closes its own
        // fd — safe to call even if the Gio streams already released theirs,
        // but guarded here so a throw from shutdown doesn't strand the stream
        // references in a "closed but still pinned" state.
        try { this._ioStream?.close(null); } catch { /* best-effort */ }
        try { this._readStream?.close(null); } catch { /* best-effort */ }
        this._ioStream = null;
        this._readStream = null;
        try { this._file.shutdown(true); } catch { /* best-effort */ }
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }
}