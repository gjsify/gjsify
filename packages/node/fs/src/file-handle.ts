// Reference: Node.js lib/internal/fs/promises.js (FileHandle)
// Reimplemented for GJS using Gio.File

import { ReadStream } from './read-stream.js';
import { WriteStream } from './write-stream.js';
import { Stats, BigIntStats, STAT_ATTRIBUTES, statsFrom } from './stats.js';
import { getEncodingFromOptions, encodeUint8Array } from './encoding.js';
import { normalizePath } from './utils.js';
import { chmodSync, chownSync } from './sync.js';
import { parseOpenFlags, normalizeMode, type OpenSpec } from './posix-flags.js';
import {
    openFd,
    closeFd,
    releaseFd,
    seekFd,
    isSeekableFd,
    tellFd,
    readFd,
    writeFd,
    fsyncFd,
    sizeOfFd,
    truncateFd,
    fdPath,
    fsError,
} from './fd-io.js';
import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { createInterface } from 'node:readline';
// Type-only import for ReadableStream — the runtime constructor is resolved
// via globalThis inside readableWebStream() to avoid bundling the entire
// WHATWG streams implementation for apps that never call this method.
import type { ReadableStream } from 'node:stream/web';
import { Buffer } from 'node:buffer';

import type { Abortable } from 'node:events';
import type { FlagAndOpenMode, FileReadResult, FileReadOptions, OpenFlags } from './types/index.js';
import type { FileHandle as IFileHandle, CreateReadStreamOptions, CreateWriteStreamOptions } from 'node:fs/promises';
import type {
    ObjectEncodingOptions,
    Mode,
    OpenMode,
    PathLike,
    StatOptions,
    WriteVResult,
    ReadVResult,
    ReadPosition,
} from 'node:fs';
import type { Interface as ReadlineInterface } from 'node:readline';

export class FileHandle implements IFileHandle {
    private readonly _gFile: Gio.File;
    private readonly _pathStr: string;
    /** What the caller asked open(2) for — the ORIGINAL flags, nothing flattened. */
    private readonly _spec: OpenSpec;

    /**
     * The one byte position this handle has.
     *
     * A descriptor has exactly ONE offset, shared by reads and writes, and this
     * is it: `_readCore`/`_writeCore` seek to it absolutely before every
     * operation, so the kernel's own offset is a consequence of this value and
     * can never drift away from it. It replaces four carriers that used to
     * disagree — a read-only `_readPos`, the IOChannel's buffered offset, a
     * cached Gio stream's cursor, and a fresh per-call stream that always
     * started at 0.
     *
     * The single exception is an `O_APPEND` write: there the kernel repositions
     * to EOF without telling us, so the new value is READ BACK rather than
     * computed from the pre-write one. Computing it is how the previous attempt
     * let the cursor drift away from the file after the first append.
     */
    private _pos = 0;
    private _closed = false;

    /** Not part of the default implementation, used internal by gjsify */
    private static instances: { [fd: number]: FileHandle } = {};

    constructor(
        readonly options: {
            path: PathLike;
            flags?: OpenFlags | number;
            mode?: Mode;
        },
    ) {
        this.options.flags ??= 'r';
        const pathStr = normalizePath(options.path);
        this._spec = parseOpenFlags(this.options.flags);
        // `??=` and not `||=`: 0 is a valid mode, and `||=` silently replaced it
        // with 0o666 — a caller asking for "no access" got a readable file.
        this.options.mode ??= 0o666;
        const mode = normalizeMode(this.options.mode, 0o666);

        // One syscall does the create, the exclusivity check and the mode. The
        // kernel masks by the live umask, so there is no umask to emulate here,
        // and nothing to chmod afterwards — which is what removes the whole
        // widen-then-narrow family of defects along with its code.
        this.fd = openFd(pathStr, this._spec, mode);
        this._pathStr = pathStr;
        this._gFile = Gio.File.new_for_path(pathStr);

        FileHandle.instances[this.fd] = this;
        return FileHandle.getInstance(this.fd);
    }

    /**
     * Read at `position`, or at the cursor when it is `null`/negative.
     *
     * SYNCHRONOUS ON PURPOSE. The cursor's read-modify-write — read `_pos`,
     * seek, transfer, store `_pos` — has no `await` inside it, so it is
     * indivisible by construction on a single-threaded runtime. The previous
     * attempt held an async lock around the I/O but computed the offset outside
     * it, so two concurrent writers captured the same offset and one write was
     * lost. That class cannot exist here: there is no suspension point for
     * anything to interleave with, which is why the async lock this replaces is
     * gone rather than tightened.
     */
    private _readCore(target: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null): number {
        this._assertOpen('read');
        // Node checks the access mode, not the file's permissions: reading a
        // handle opened write-only is EBADF. GioUnix reports it as a localized
        // G_IO_ERROR_FAILED, so it is raised from what we know instead.
        if (!this._spec.readable) throw fsError('EBADF', 'read', this._pathStr);

        // Node validates the window into the CALLER's view, not into the
        // ArrayBuffer behind it. The difference is not academic: the `.set()`
        // below is bounded by the ArrayBuffer, so on a runtime whose `Buffer`
        // pools its allocations (Node's does) a too-long read would silently
        // overrun into the NEIGHBOURING buffer instead of being refused.
        if (length > target.byteLength - offset) {
            const err = new RangeError(
                `The value of "length" is out of range. It must be <= ${target.byteLength - offset}. Received ${length}`,
            ) as NodeJS.ErrnoException;
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }

        const usePos = position !== null && position !== undefined && position >= 0;
        const seekable = isSeekableFd(this.fd, this._pathStr);
        // `pread(2)` on a pipe / socket / tty is ESPIPE, and saying so is the
        // point: the unconditional seek this replaces turned a positional read
        // on such a descriptor into a SEQUENTIAL one and reported success.
        if (usePos && !seekable) throw fsError('ESPIPE', 'read', this._pathStr);

        const start = usePos ? position : this._pos;
        if (seekable) seekFd(this.fd, start);
        const data = readFd(this.fd, length);
        if (data.length > 0) {
            new Uint8Array(target.buffer as ArrayBuffer, target.byteOffset + offset, data.length).set(data);
        }
        // An explicit position is pread(2): it must leave the cursor alone. A
        // non-seekable descriptor has no offset to model — the kernel's stream
        // position is the only one, and it is not ours to shadow.
        if (!usePos && seekable) this._pos = start + data.length;
        return data.length;
    }

    /** Write at `position`, or at the cursor when it is `null`/negative. See {@link _readCore}. */
    private _writeCore(data: Uint8Array, position: number | null): number {
        this._assertOpen('write');
        if (!this._spec.writable) throw fsError('EBADF', 'write', this._pathStr);

        if (this._spec.append) {
            // Under O_APPEND the kernel ignores `position` entirely and writes
            // at EOF — POSIX says so and Node documents it. Honouring the
            // position instead means `writeSync(fd, buf, 0, n, 0)` on an append
            // fd destroys the head of the log, which is strictly worse than the
            // bug that fix was meant to close.
            const written = writeFd(this.fd, data);
            this._pos = tellFd(this.fd) ?? sizeOfFd(this.fd, this._pathStr);
            return written;
        }

        const usePos = position !== null && position !== undefined && position >= 0;
        const seekable = isSeekableFd(this.fd, this._pathStr);
        // See `_readCore`: `pwrite(2)` on a non-seekable descriptor is ESPIPE.
        if (usePos && !seekable) throw fsError('ESPIPE', 'write', this._pathStr);

        const start = usePos ? position : this._pos;
        if (seekable) seekFd(this.fd, start);
        const written = writeFd(this.fd, data);
        if (!usePos && seekable) this._pos = start + written;
        return written;
    }

    private _assertOpen(syscall: string): void {
        if (this._closed) throw fsError('EBADF', syscall, this._pathStr);
    }

    /**
     * `ftruncate(2)` — ONE body for the sync and async halves.
     *
     * The access-mode gate belongs HERE and not in `truncateFd`, because it is
     * the descriptor's property and `truncateFd` has to re-open the file to do
     * its work (see there) — a re-open that asks the kernel for its own fresh
     * permission and is granted it. Without this line a handle opened `'r'`
     * truncates the file: `writeFileSync(f,'ABCDEFGH'); ftruncateSync(openSync(f,'r'), 2)`
     * destroyed six bytes through a READ-ONLY descriptor and returned normally.
     * Node reports EINVAL, and so does this.
     *
     * `_readCore`/`_writeCore` have carried the identical gate since this
     * redesign began; truncate was the one byte-mover left outside it, which is
     * exactly the shape of divergence the single-core rule exists to prevent.
     */
    private _truncateCore(len: number): void {
        this._assertOpen('ftruncate');
        if (!this._spec.writable) throw fsError('EINVAL', 'ftruncate', this._pathStr);
        // ftruncate(2) does not move the file offset, so `_pos` is deliberately
        // untouched: a write straight after a shrink leaves a hole, as Node does.
        truncateFd(this.fd, Math.max(0, len), this._pathStr);
    }

    /** Read from the cursor to EOF, advancing it — Node's whole-file read on a handle. */
    private _readToEnd(): Uint8Array {
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const buf = new Uint8Array(64 * 1024);
            const n = this._readCore(buf, 0, buf.length, null);
            if (n === 0) break;
            chunks.push(buf.subarray(0, n));
            total += n;
        }
        const out = new Uint8Array(total);
        let at = 0;
        for (const chunk of chunks) {
            out.set(chunk, at);
            at += chunk.length;
        }
        return out;
    }

    /** The path that names this DESCRIPTOR, falling back to the name it was opened from. */
    private _fdTarget(): string {
        return fdPath(this.fd) ?? this._pathStr;
    }

    /**
     * The numeric file descriptor managed by the {FileHandle} object.
     * @since v10.0.0
     */
    readonly fd: number;

    /**
     * The handle behind a descriptor number. Not part of Node's API.
     *
     * TWO things used to go wrong here, both of them at the boundary where a
     * caller holds a NUMBER and this package holds an object.
     *
     * It threw `Error('No instance found for fd!')` — no `code`, not an
     * `ErrnoException`. But the overwhelmingly common way to reach it is an fd
     * that WAS valid: `_teardown()` deletes the instance, so every call on a
     * closed descriptor landed here rather than on `_assertOpen`, which made
     * that guard dead for every fd-number call site. `catch (e) { if (e.code
     * === 'EBADF') }` — the idiom for tolerating a racing close — fell through
     * to the generic branch instead. The syscall is threaded in from the caller
     * because Node names it in the message, and we know it there and only there.
     *
     * It also indexed `instances` with whatever it was given. `openSync()`
     * returns a FileHandle rather than Node's number (a pre-existing divergence
     * this does not attempt to change), so `fs.write(fs.openSync(p,'w'), …)`
     * stringified the object into a key, missed, and threw out of the callback
     * machinery. Unwrapping is one line and makes every fd call site accept
     * both spellings.
     */
    static getInstance(fd: number | FileHandle, syscall: string = 'read'): FileHandle {
        const key = fd instanceof FileHandle ? fd.fd : fd;
        const instance = FileHandle.instances[key as number];
        if (!instance) throw fsError('EBADF', syscall);
        return instance;
    }

    /**
     * Alias of `filehandle.writeFile()`.
     *
     * When operating on file handles, the mode cannot be changed from what it was set
     * to with `fsPromises.open()`. Therefore, this is equivalent to `filehandle.writeFile()`.
     * @since v10.0.0
     * @return Fulfills with `undefined` upon success.
     */
    async appendFile(
        data: string | Uint8Array,
        options?: (ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding | null,
    ): Promise<void> {
        // Node documents this as an alias of writeFile() on a handle, so it is
        // literally one: a cursor write, appending only because the descriptor
        // carries O_APPEND. The old body wrote at whatever offset the IOChannel
        // happened to hold, which on a fresh handle meant it OVERWROTE from
        // byte 0 the file it was asked to append to.
        await this.writeFile(data, options);
    }
    /**
     * Changes the ownership of the file. A wrapper for [`chown(2)`](http://man7.org/linux/man-pages/man2/chown.2.html).
     * @since v10.0.0
     * @param uid The file's new owner's user id.
     * @param gid The file's new group's group id.
     * @return Fulfills with `undefined` upon success.
     */
    async chown(uid: number, gid: number): Promise<void> {
        this._assertOpen('fchown');
        chownSync(normalizePath(this.options.path), uid, gid);
    }
    /**
     * Modifies the permissions on the file. See [`chmod(2)`](http://man7.org/linux/man-pages/man2/chmod.2.html).
     * @since v10.0.0
     * @param mode the file mode bit mask.
     * @return Fulfills with `undefined` upon success.
     */
    async chmod(mode: Mode): Promise<void> {
        this._assertOpen('fchmod');
        // fchmod(2): act on the descriptor, so a rename between open and now
        // cannot hand the caller's permission change to a different file.
        chmodSync(this._fdTarget(), mode);
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
        // Through THIS descriptor, so the stream shares the handle's cursor —
        // the read counterpart of createWriteStream() below. Opening the path
        // afresh started a SECOND cursor at 0: after `await fh.read(b,0,4,null)`
        // the stream replayed the whole file where Node resumes at byte 4, and
        // it bound a different inode if the path had been replaced since.
        return new ReadStream(this.options.path, { ...options, fd: this.fd });
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
        // Through THIS descriptor, so the stream shares the handle's cursor.
        // Opening the path afresh gave the stream default flags `'w'`, i.e. it
        // TRUNCATED the file the handle had open, and bound a different inode
        // if the path had been replaced since.
        //
        // `autoClose` is the caller's, and it defaults to CLOSING: Node closes a
        // handle-derived write stream's handle at 'finish' (measured — a later
        // `fh.stat()` rejects EBADF). It was hardcoded `false` AFTER the spread,
        // so an explicit `autoClose: true` was silently discarded and the
        // descriptor was never released. Not re-opening the path and not closing
        // the fd are two different questions; only the first one is settled here.
        // `fdFromHandle` tells the stream that its descriptor belongs to a
        // HANDLE, whose close is idempotent in Node — so finishing after the
        // caller has already closed this handle is silent there, where a raw
        // `{fd}` stream reports EBADF. See `WriteStreamOptions.fdFromHandle`.
        return new WriteStream(this.options.path, { ...options, fd: this.fd, fdFromHandle: true });
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
        this._assertOpen('fdatasync');
        fsyncFd(this.fd);
    }
    /**
     * Request that all data for the open file descriptor is flushed to the storage
     * device. The specific implementation is operating system and device specific.
     * Refer to the POSIX [`fsync(2)`](http://man7.org/linux/man-pages/man2/fsync.2.html) documentation for more detail.
     * @since v10.0.0
     * @return Fufills with `undefined` upon success.
     */
    async sync(): Promise<void> {
        this._assertOpen('fsync');
        fsyncFd(this.fd);
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
    async read<T extends NodeJS.ArrayBufferView>(
        buffer: T,
        offset?: number | null,
        length?: number | null,
        position?: ReadPosition | null,
    ): Promise<FileReadResult<T>>;
    async read<T extends NodeJS.ArrayBufferView = Buffer>(options?: FileReadOptions<T>): Promise<FileReadResult<T>>;

    async read<T extends NodeJS.ArrayBufferView = Buffer>(...args: unknown[]): Promise<FileReadResult<T>> {
        let buffer: T | undefined;
        let offset: number | null | undefined;
        let length: number | null | undefined;
        let position: number | null | undefined;

        if (typeof args[0] === 'object' && !(args[0] instanceof Uint8Array) && !(args[0] instanceof Buffer)) {
            const options = args[0] as FileReadOptions<T>;
            buffer = options.buffer;
            offset = options.offset;
            length = options.length;
            position = options.position;
        } else {
            buffer = args[0] as T;
            offset = args[1] as number | null | undefined;
            length = args[2] as number | null | undefined;
            position = args[3] as number | null | undefined;
        }

        const bufView = buffer as unknown as Uint8Array;
        const bufOffset = offset ?? 0;
        // `byteLength - offset`, not `byteLength`. Node documents the default as
        // "the number of bytes that FIT AFTER the offset"; defaulting to the
        // whole buffer made `fh.read({ buffer: Buffer.alloc(8), offset: 4 })` —
        // the documented options form — throw RangeError where Node reads 4.
        const readLength = length ?? (bufView ? bufView.byteLength - bufOffset : 65536);

        // `position ?? 0` used to live here, which meant an unpositioned async
        // read sought to 0 forever: `while ((await fh.read(b,0,4,null)).bytesRead)`
        // never terminated, and a read after an async write started from the
        // top. It goes through the same cursor core as every other byte-mover,
        // so there is no second offset rule to forget.
        const bytesRead = this._readCore(buffer as NodeJS.ArrayBufferView, bufOffset, readLength, position ?? null);
        return { bytesRead, buffer: buffer as T };
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
        // Resolved from globalThis, not imported: keeps the WHATWG streams
        // implementation out of the bundle when this method is unused.
        const Ctor = (globalThis as { ReadableStream?: typeof globalThis.ReadableStream }).ReadableStream;
        if (typeof Ctor !== 'function') {
            throw new Error(
                'readableWebStream() requires a global ReadableStream. Import "node:stream/web" or "@gjsify/web-streams/register" before calling this method.',
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
        } | null,
    ): Promise<Buffer<ArrayBuffer>>;
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
            | BufferEncoding,
    ): Promise<string>;
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
            | null,
    ): Promise<string | Buffer<ArrayBuffer>> {
        const encoding = getEncodingFromOptions(options, 'buffer');
        // Node: "the data will be read from the current position till the end
        // of the file. It doesn't always read from the beginning." The old body
        // drove the IOChannel's own offset — a third cursor neither the handle
        // nor the Gio streams knew about, so mixing this with read()/write()
        // corrupted positions in both directions.
        return encodeUint8Array(encoding, this._readToEnd());
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
        return createInterface({ input: this.createReadStream(options), crlfDelay: Infinity });
    }
    /**
     * @since v10.0.0
     * @return Fulfills with an {fs.Stats} for the file.
     */
    async stat(
        opts?: StatOptions & {
            bigint?: false | undefined;
        },
    ): Promise<Stats>;
    async stat(
        opts: StatOptions & {
            bigint: true;
        },
    ): Promise<BigIntStats>;
    async stat(opts?: StatOptions): Promise<Stats | BigIntStats> {
        // A closed handle is EBADF, and it has to be said HERE: `_fdTarget()`
        // resolves to `/proc/self/fd/N`, which simply stops existing once the
        // descriptor is gone, so without this the caller got a NOT_FOUND about
        // a procfs path it never named.
        this._assertOpen('fstat');
        // fstat(2): the descriptor, not the name — so the answer survives a
        // rename and an unlink, and cannot describe an impostor at that path.
        const target = Gio.File.new_for_path(this._fdTarget());
        const info = await new Promise<Gio.FileInfo>((resolve, reject) => {
            target.query_info_async(
                STAT_ATTRIBUTES,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (_s: unknown, res: Gio.AsyncResult) => {
                    try {
                        resolve(target.query_info_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                },
            );
        });
        return statsFrom(info, this._pathStr, 'fstat', opts?.bigint);
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
        this._truncateCore(len);
    }
    /**
     * Change the file system timestamps of the object referenced by the `FileHandle` then resolves the promise with no arguments upon success.
     * @since v10.0.0
     */
    async utimes(atime: string | number | Date, mtime: string | number | Date): Promise<void> {
        this._assertOpen('futimes');
        const { utimesSync } = await import('./utimes.js');
        utimesSync(normalizePath(this.options.path), atime, mtime);
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
    async writeFile(
        data: string | Uint8Array,
        options?: (ObjectEncodingOptions & FlagAndOpenMode & Abortable) | BufferEncoding | null,
    ): Promise<void> {
        const encoding = getEncodingFromOptions(options);
        let buf: Uint8Array;
        if (typeof data === 'string') {
            buf = Buffer.from(data, (encoding as BufferEncoding) || 'utf8');
        } else {
            buf = data;
        }
        // Node: "the data will be written from the current position till the
        // end of the file. It doesn't always write from the beginning." The
        // `seek_position(0)` this replaces both contradicted that and, because
        // it never truncated, left the tail of a longer previous file behind.
        this._writeCore(buf, null);
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
        position?: number | null,
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
        encoding?: BufferEncoding | null,
    ): Promise<{
        bytesWritten: number;
        buffer: string;
    }>;
    async write<TBuffer extends NodeJS.ArrayBufferView>(
        data: string | TBuffer,
        ...args: unknown[]
    ): Promise<{
        bytesWritten: number;
        buffer: string | TBuffer;
    }> {
        let position: number | null = null;
        let encoding: BufferEncoding | 'buffer' | null = null;
        let offset: number | null = null;
        let length: number | null = null;

        if (typeof data === 'string') {
            position = args[0] as number | null;
            encoding = args[1] as BufferEncoding | 'buffer' | null;
        } else {
            offset = args[0] as number | null;
            length = args[1] as number | null;
            position = args[2] as number | null;
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
        const writeLength = length ?? writeBuf.byteLength - bufOffset;
        const writeSlice = writeBuf.subarray(bufOffset, bufOffset + writeLength);

        // Same cursor core as writeSync(), so the sync and async halves of one
        // API cannot disagree about where the bytes go — they did, and the
        // half most fsPromises consumers call sent every unpositioned write to
        // offset 0.
        return {
            bytesWritten: this._writeCore(writeSlice, position ?? null),
            buffer: data,
        };
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
    async writev<TBuffers extends readonly NodeJS.ArrayBufferView[]>(
        buffers: TBuffers,
        position?: number,
    ): Promise<WriteVResult<TBuffers>> {
        let bytesWritten = 0;
        for (const buf of buffers) {
            const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
            const res = await this.write(b, 0, b.byteLength, position != null ? position + bytesWritten : null);
            bytesWritten += res.bytesWritten;
        }
        return { bytesWritten, buffers: buffers as unknown as TBuffers };
    }
    /**
     * Read from a file and write to an array of [ArrayBufferView](https://developer.mozilla.org/en-US/docs/Web/API/ArrayBufferView) s
     * @since v13.13.0, v12.17.0
     * @param position The offset from the beginning of the file where the data should be read from. If `position` is not a `number`, the data will be read from the current position.
     * @return Fulfills upon success an object containing two properties:
     */
    async readv<TBuffers extends readonly NodeJS.ArrayBufferView[]>(
        buffers: TBuffers,
        position?: number,
    ): Promise<ReadVResult<TBuffers>> {
        let bytesRead = 0;
        for (const buf of buffers) {
            const res = await this.read({
                buffer: Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength),
                position: position != null ? position + bytesRead : null,
            });
            bytesRead += res.bytesRead;
            if (res.bytesRead < buf.byteLength) break;
        }
        return { bytesRead, buffers: buffers as unknown as TBuffers };
    }
    /** @internal */ _flushSync(): void {
        fsyncFd(this.fd);
    }

    /** @internal */ _closeSync(): void {
        this._teardown();
    }

    /** @internal */ _readSync(
        buffer: NodeJS.ArrayBufferView,
        offset: number,
        length: number,
        position: number | null,
    ): number {
        return this._readCore(buffer, offset, length, position);
    }

    /** @internal */ _writeSync(data: Uint8Array, position: number | null): number {
        return this._writeCore(data, position);
    }

    /** @internal Read from the cursor to EOF, advancing it — `readFileSync(fd)`. */ _readToEndSync(): Uint8Array {
        return this._readToEnd();
    }

    /** @internal Truncate through the descriptor. */ _truncateSync(len: number): void {
        this._truncateCore(len);
    }

    /** @internal The path that names this descriptor — `/proc/self/fd/N` where the host has it. */
    _fdStatTarget(): string {
        return this._fdTarget();
    }

    /**
     * Close the descriptor and deregister the handle.
     *
     * ONE implementation for both halves. `close()` used to leave the fd in
     * `instances` while `_closeSync()` removed it, so every `fsPromises` close
     * leaked its entry — and a later `openSync` reusing that fd number found a
     * stale handle waiting for it.
     */
    private _teardown(): void {
        if (this._closed) return;
        this._closed = true;
        releaseFd(this.fd);
        closeFd(this.fd);
        // `instances` is declared `private static` on FileHandle; same-module
        // access is allowed via a typed view of the constructor without
        // dropping into `as any`.
        const _ctor = FileHandle as unknown as { instances: { [fd: number]: FileHandle } };
        delete _ctor.instances[this.fd];
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
        this._teardown();
    }

    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    /**
     * `node:stream/iter` pull-mode reader. Added in Node 25.9 — wires the
     * file handle into the new stream-iter pipeline so callers can do
     * `await pipeTo(fh.pull({ autoClose: true }), w)` instead of the
     * older `createReadStream()` pattern.
     *
     * Not implemented yet — `@gjsify/stream` doesn't ship the iter
     * helpers ({@link https://nodejs.org/api/stream_iter.html}). The
     * stub keeps the @types/node FileHandle interface satisfied so
     * downstream typecheck passes; calling at runtime throws a clear
     * "not yet" error. Tracked in status/open-todos.md → "Node 25
     * stream/iter integration".
     */
    // oxlint-disable-next-line typescript/no-explicit-any -- stream/iter Transform / ByteReadableStream types are too new to plumb here cleanly; the throw makes the surface non-callable until the proper port lands.
    pull(..._args: any[]): any {
        throw new Error(
            'FileHandle.pull() is not implemented in @gjsify/fs yet — ' +
                'requires `node:stream/iter` (Node 25.9+) which @gjsify/stream ' +
                'has not ported. Track gjsify Open TODO "Node 25 stream/iter ' +
                'integration".',
        );
    }

    /**
     * `node:stream/iter` writer. Counterpart to {@link pull} — added in
     * Node 25.9 alongside the new pipeline shape. Same not-implemented
     * stub for the same reason. See {@link pull} for context.
     */
    // oxlint-disable-next-line typescript/no-explicit-any -- same as pull(): the WriterOptions / Writer types live in node:stream/iter; stub returns any so the throw surfaces at call time.
    writer(_options?: any): any {
        throw new Error(
            'FileHandle.writer() is not implemented in @gjsify/fs yet — ' +
                'requires `node:stream/iter` (Node 25.9+) which @gjsify/stream ' +
                'has not ported. Track gjsify Open TODO "Node 25 stream/iter ' +
                'integration".',
        );
    }
}
