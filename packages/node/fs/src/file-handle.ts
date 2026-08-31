// Reference: Node.js lib/internal/fs/promises.js (FileHandle)
// Reimplemented for GJS using Gio.File

import { ReadStream } from './read-stream.js';
import { WriteStream } from './write-stream.js';
import type { Stats, BigIntStats } from './stats.js';
import { STAT_ATTRIBUTES, statsFrom } from './stats.js';
import { getEncodingFromOptions, encodeUint8Array } from './encoding.js';
import { normalizePath } from './utils.js';
import { invalidState } from './errors.js';
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
// Type-only: `readableWebStream()` resolves the constructor off globalThis so an
// app that never calls it does not bundle the whole WHATWG streams implementation.
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
     * The one byte position this handle has — a descriptor has exactly ONE offset,
     * shared by reads and writes. `_readCore`/`_writeCore` seek to it absolutely
     * before every operation, so the kernel's offset is a consequence of this
     * value and cannot drift from it.
     *
     * Exception: an `O_APPEND` write, where the kernel repositions to EOF without
     * telling us. There the new value must be READ BACK; computing it from the
     * pre-write value drifts after the very first append.
     */
    private _pos = 0;
    private _closed = false;
    /** `readableWebStream()` takes this on the CALL, and never releases it — Node's
     *  handle lock is per-handle, not per-stream, so a second call throws even after
     *  the first stream has ended. Measured. */
    private _webStreamLocked = false;

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

        // One syscall for create + exclusivity check + mode. The kernel masks by the
        // live umask, so there is no umask to emulate and nothing to chmod after —
        // which is what rules out the whole widen-then-narrow family of defects.
        this.fd = openFd(pathStr, this._spec, mode);
        this._pathStr = pathStr;
        this._gFile = Gio.File.new_for_path(pathStr);

        FileHandle.instances[this.fd] = this;
        return FileHandle.getInstance(this.fd);
    }

    /**
     * Read at `position`, or at the cursor when it is `null`/negative.
     *
     * SYNCHRONOUS ON PURPOSE: the cursor's read-modify-write — read `_pos`, seek,
     * transfer, store `_pos` — contains no `await`, so on a single-threaded runtime
     * it is indivisible by construction. An async lock cannot substitute for that;
     * one held around the I/O while the offset was computed outside it let two
     * concurrent writers capture the same offset and lose a write.
     */
    private _readCore(target: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null): number {
        this._assertOpen('read');
        // Node checks the access mode, not the file's permissions: reading a
        // handle opened write-only is EBADF. GioUnix reports it as a localized
        // G_IO_ERROR_FAILED, so it is raised from what we know instead.
        if (!this._spec.readable) throw fsError('EBADF', 'read', this._pathStr);

        // Validate against the CALLER's view, not the ArrayBuffer behind it: the
        // `.set()` below is bounded only by the ArrayBuffer, so where `Buffer` pools
        // its allocations a too-long read would silently overrun into the NEIGHBOUR.
        if (length > target.byteLength - offset) {
            const err = new RangeError(
                `The value of "length" is out of range. It must be <= ${target.byteLength - offset}. Received ${length}`,
            ) as NodeJS.ErrnoException;
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }

        const usePos = position !== null && position !== undefined && position >= 0;
        const seekable = isSeekableFd(this.fd, this._pathStr);
        // `pread(2)` on a pipe / socket / tty is ESPIPE. Seeking unconditionally
        // instead turns a positional read into a SEQUENTIAL one and reports success.
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
            // POSIX and Node agree: under O_APPEND the kernel ignores `position` and
            // writes at EOF. Honouring the position instead lets
            // `writeSync(fd, buf, 0, n, 0)` destroy the head of an append-only log.
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
     * The access-mode gate belongs HERE, not in `truncateFd`: it is a property of
     * the descriptor, and `truncateFd` re-opens the file (see there), so the kernel
     * grants it fresh permission of its own. Without this line
     * `ftruncateSync(openSync(f,'r'), 2)` destroys bytes through a READ-ONLY
     * descriptor and returns normally. Node reports EINVAL, and so does this.
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

    /** The numeric file descriptor managed by this object. */
    readonly fd: number;

    /**
     * The handle behind a descriptor number. Not part of Node's API.
     *
     * Must fail as `EBADF`, not a bare Error: the common way to get here is an fd
     * that WAS valid, since `_teardown()` deletes the instance, so every call on a
     * closed descriptor lands here instead of on `_assertOpen`. Without the code,
     * `catch (e) { if (e.code === 'EBADF') }` — the idiom for tolerating a racing
     * close — falls through. `syscall` comes from the caller because Node names it
     * in the message and only the caller knows it.
     *
     * A `FileHandle` is accepted as well as a number because `openSync()` returns
     * the handle where Node returns a number (a divergence this does not change);
     * without unwrapping, `fs.write(fs.openSync(p,'w'), …)` stringifies the object
     * into a key and misses.
     */
    static getInstance(fd: number | FileHandle, syscall: string = 'read'): FileHandle {
        const key = fd instanceof FileHandle ? fd.fd : fd;
        const instance = FileHandle.instances[key as number];
        if (!instance) throw fsError('EBADF', syscall);
        return instance;
    }

    /**
     * Alias of `writeFile()`: a handle's mode cannot be changed after
     * `fsPromises.open()`, so it appends only because the descriptor carries
     * O_APPEND. It must therefore be a plain CURSOR write — writing at some
     * separately-tracked offset overwrites from byte 0 on a fresh handle.
     */
    async appendFile(
        data: string | Uint8Array,
        options?: (ObjectEncodingOptions & FlagAndOpenMode) | BufferEncoding | null,
    ): Promise<void> {
        await this.writeFile(data, options);
    }
    /** [`chown(2)`](http://man7.org/linux/man-pages/man2/chown.2.html). */
    async chown(uid: number, gid: number): Promise<void> {
        this._assertOpen('fchown');
        chownSync(normalizePath(this.options.path), uid, gid);
    }
    /** [`chmod(2)`](http://man7.org/linux/man-pages/man2/chmod.2.html). */
    async chmod(mode: Mode): Promise<void> {
        this._assertOpen('fchmod');
        // fchmod(2): act on the descriptor, so a rename between open and now
        // cannot hand the caller's permission change to a different file.
        chmodSync(this._fdTarget(), mode);
    }
    /**
     * `highWaterMark` defaults to 64 kb here rather than a Readable's 16 kb. With
     * no `start`, reading is sequential from the current file position.
     */
    createReadStream(options?: CreateReadStreamOptions): ReadStream {
        // Through THIS descriptor, so the stream shares the handle's cursor. Opening
        // the path afresh starts a SECOND cursor at 0 — the stream then replays the
        // whole file where Node resumes mid-file — and binds a different inode if
        // the path has since been replaced.
        return new ReadStream(this.options.path, { ...options, fd: this.fd });
    }
    /**
     * `options.start` writes past the beginning of the file; modifying rather than
     * replacing may need `flags: 'r+'` instead of the default `'r'`.
     */
    createWriteStream(options?: CreateWriteStreamOptions): WriteStream {
        // Through THIS descriptor, so the stream shares the handle's cursor. Opening
        // the path afresh would give the stream default flags `'w'` — TRUNCATING the
        // file the handle has open — and bind a different inode after a replace.
        //
        // `autoClose` stays the caller's and defaults to CLOSING, because Node closes
        // a handle-derived write stream's handle at 'finish' (measured: a later
        // `fh.stat()` rejects EBADF). Hardcoding `false` after the spread silently
        // discards an explicit `autoClose: true` and leaks the descriptor.
        //
        // `fdFromHandle` marks the descriptor as a HANDLE's, whose close is
        // idempotent in Node — finishing after the caller closed the handle is silent
        // there, where a raw `{fd}` stream reports EBADF.
        return new WriteStream(this.options.path, { ...options, fd: this.fd, fdFromHandle: true });
    }
    /** [`fdatasync(2)`](http://man7.org/linux/man-pages/man2/fdatasync.2.html) —
     *  unlike `sync()` this does not flush modified metadata. */
    async datasync(): Promise<void> {
        this._assertOpen('fdatasync');
        fsyncFd(this.fd);
    }
    /** [`fsync(2)`](http://man7.org/linux/man-pages/man2/fsync.2.html). */
    async sync(): Promise<void> {
        this._assertOpen('fsync');
        fsyncFd(this.fd);
    }
    /**
     * Read into `buffer`. Absent concurrent modification, EOF is `bytesRead === 0`.
     *
     * A `null` `position` reads from the current file position AND advances it; an
     * integer leaves the position unchanged.
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
        // `byteLength - offset`, not `byteLength`: Node's default length is what FITS
        // AFTER the offset, so defaulting to the whole buffer makes the documented
        // `fh.read({ buffer: Buffer.alloc(8), offset: 4 })` throw where Node reads 4.
        const readLength = length ?? (bufView ? bufView.byteLength - bufOffset : 65536);

        // `?? null`, never `?? 0`: coercing to 0 makes every unpositioned read seek
        // back to the start, so `while ((await fh.read(b,0,4,null)).bytesRead)` never
        // terminates. Nothing here re-implements the offset rule — `_readCore` owns it.
        const bytesRead = this._readCore(buffer as NodeJS.ArrayBufferView, bufOffset, readLength, position ?? null);
        return { bytesRead, buffer: buffer as T };
    }
    /**
     * `filehandle.readableWebStream()` — a `ReadableStream` over the file's bytes.
     *
     * It used to return `new Ctor()`: a stream with NO underlying source, so
     * `for await (const chunk of fh.readableWebStream())` never settled. A hang is
     * the worst shape a missing feature can take — no error, no stack, no timeout —
     * which is why this is implemented rather than made to throw.
     *
     * Every rule below is MEASURED against node v24.15.0 rather than read off the
     * docs:
     *
     *   - it streams from the handle's CURRENT position, not from byte 0. After
     *     `await fh.read(Buffer.alloc(6), 0, 6, null)` on "hello world", Node's
     *     stream yields "world". `_readCore(…, null)` is the cursor-relative read,
     *     which is what makes that true here too.
     *   - a SECOND call throws `ERR_INVALID_STATE` — "Invalid state: The FileHandle
     *     is locked". The lock is taken by the CALL, not by the first read.
     *   - on a CLOSED handle it throws `ERR_INVALID_STATE` — "…is closed" — and NOT
     *     the `EBADF` that `_assertOpen` raises, so this tests `_closed` itself
     *     rather than routing through it.
     *   - the handle is NOT closed when the stream ends; user code still calls
     *     `close()`.
     *
     * A BYTE stream (`type: 'bytes'`), because Node's is — measured, after the first
     * version of this comment asserted the opposite and built a default stream:
     * `fh.readableWebStream().getReader({ mode: 'byob' })` returns a
     * `ReadableStreamBYOBReader` on v24.15.0 and reads into the caller's buffer. A
     * default stream rejects that reader, so getting this backwards would have
     * introduced a divergence inside the change that exists to remove them.
     *
     * The BYOB path also removes the 64 KiB allocation per pull whenever the consumer
     * brings its own view.
     */
    readableWebStream(): ReadableStream {
        if (this._closed) throw invalidState('The FileHandle is closed');
        if (this._webStreamLocked) throw invalidState('The FileHandle is locked');
        // Resolved from globalThis, not imported: keeps the WHATWG streams
        // implementation out of the bundle when this method is unused.
        const Ctor = (globalThis as { ReadableStream?: typeof globalThis.ReadableStream }).ReadableStream;
        if (typeof Ctor !== 'function') {
            throw new Error(
                'readableWebStream() requires a global ReadableStream. Import "node:stream/web" or "@gjsify/web-streams/register" before calling this method.',
            );
        }
        this._webStreamLocked = true;
        return new Ctor({
            type: 'bytes',
            // An ARROW, so `this` stays the handle — a method shorthand here would
            // bind it to the underlying-source object and need a `this` alias.
            pull: (controller: ReadableByteStreamController) => {
                // A handle closed MID-STREAM ends the stream cleanly rather than
                // erroring it: measured, Node's next `read()` resolves `{done:true}`.
                // Erroring here would make an ordinary `close()` during iteration throw
                // at the consumer.
                if (this._closed) {
                    controller.close();
                    // A byte stream with an outstanding BYOB request must answer it
                    // before close, or the reader's promise never settles.
                    controller.byobRequest?.respond(0);
                    return;
                }
                // ONE chunk per pull, not `_readToEnd()`: a slow consumer must not
                // force the whole file into memory, which is the reason to reach for
                // this over `readFile()` in the first place.
                const view = controller.byobRequest?.view;
                const buf = view
                    ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
                    : new Uint8Array(64 * 1024);
                let read: number;
                try {
                    read = this._readCore(buf, 0, buf.length, null);
                } catch (err: unknown) {
                    controller.error(err);
                    return;
                }
                if (read === 0) {
                    controller.close();
                    controller.byobRequest?.respond(0);
                    return;
                }
                if (controller.byobRequest) {
                    controller.byobRequest.respond(read);
                    return;
                }
                controller.enqueue(buf.subarray(0, read));
            },
        }) as unknown as ReadableStream;
    }
    /**
     * Read from the CURRENT position to EOF — not from the beginning, so earlier
     * `read()` calls on this handle move the starting point. The handle must have
     * been opened for reading, and is not closed for you.
     */
    async readFile(
        options?: {
            encoding?: null | undefined;
            flag?: OpenMode | undefined;
        } | null,
    ): Promise<Buffer<ArrayBuffer>>;
    async readFile(
        options:
            | {
                  encoding: BufferEncoding;
                  flag?: OpenMode | undefined;
              }
            | BufferEncoding,
    ): Promise<string>;
    async readFile(
        options?:
            | (ObjectEncodingOptions & {
                  flag?: OpenMode | undefined;
              })
            | BufferEncoding
            | null,
    ): Promise<string | Buffer<ArrayBuffer>> {
        const encoding = getEncodingFromOptions(options, 'buffer');
        // Via the handle's own cursor. Any second offset here — an IOChannel's, a
        // stream's — corrupts positions in both directions once mixed with
        // read()/write().
        return encodeUint8Array(encoding, this._readToEnd());
    }
    /** A `readline` interface over the file; `options` are `createReadStream()`'s. */
    readLines(options?: CreateReadStreamOptions): ReadlineInterface {
        return createInterface({ input: this.createReadStream(options), crlfDelay: Infinity });
    }
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
        // EBADF has to be raised HERE: `_fdTarget()` resolves to `/proc/self/fd/N`,
        // which stops existing with the descriptor, so otherwise the caller gets a
        // NOT_FOUND naming a procfs path they never asked about.
        this._assertOpen('fstat');
        // fstat(2) semantics — the descriptor, not the name: the answer survives a
        // rename or unlink and cannot describe an impostor at that path.
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
     * Keep only the first `len` bytes, or extend with NUL bytes when the file was
     * shorter. A negative `len` is treated as 0.
     */
    async truncate(len: number = 0): Promise<void> {
        this._truncateCore(len);
    }
    /** Change the file system timestamps of the referenced object. */
    async utimes(atime: string | number | Date, mtime: string | number | Date): Promise<void> {
        this._assertOpen('futimes');
        const { utimesSync } = await import('./utimes.js');
        utimesSync(normalizePath(this.options.path), atime, mtime);
    }
    /**
     * Write from the CURRENT position to the end — not from the beginning, so
     * earlier `write()` calls on this handle move the starting point. Unsafe to
     * call again before the promise settles.
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
        // A cursor write, never a seek to 0: seeking would contradict the contract
        // above and, since it does not truncate, leave the tail of a longer previous
        // file behind.
        this._writeCore(buf, null);
    }
    /**
     * Write `buffer` at `position`, or at the current position when `position` is
     * not a number (POSIX pwrite(2)). Unsafe to call again before the promise
     * settles — use `createWriteStream()` for that.
     *
     * On Linux a positional write is IGNORED on an append-mode file: the kernel
     * always appends.
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

        let writeBuf: Uint8Array;
        if (typeof data === 'string') {
            writeBuf = new TextEncoder().encode(data);
        } else {
            writeBuf = data as unknown as Uint8Array;
        }
        const bufOffset = offset ?? 0;
        const writeLength = length ?? writeBuf.byteLength - bufOffset;
        const writeSlice = writeBuf.subarray(bufOffset, bufOffset + writeLength);

        // Same cursor core as writeSync(), so the sync and async halves of one API
        // cannot disagree about where the bytes land.
        return {
            bytesWritten: this._writeCore(writeSlice, position ?? null),
            buffer: data,
        };
    }

    /**
     * Write several views in sequence. `position` is where the FIRST one lands, the
     * current position when it is not a number; unsafe to call again before the
     * promise settles. As with `write()`, Linux ignores it in append mode.
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
    /** Fill several views in sequence, from `position` or the current position. */
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
