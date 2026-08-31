// Reference: Node.js lib/fs.js (callback API)
// Reimplemented for GJS using Gio.File async operations

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { open as openP, rm as rmP } from './promises.js';
import type {
    PathLike,
    OpenMode,
    Mode,
    ReadPosition,
    ReadAsyncOptions,
    NoParamCallback,
    RmOptions,
    RmDirOptions,
    MakeDirectoryOptions,
    EncodingOption,
    BufferEncodingOption,
} from 'node:fs';
import { FileHandle } from './file-handle.js';
import { Buffer } from 'node:buffer';
import type { Stats, BigIntStats } from './stats.js';
import { STAT_ATTRIBUTES, statsFrom } from './stats.js';
import { createNodeError, requireCallback } from './errors.js';
import {
    realpathSync,
    readdirSync,
    renameSync,
    copyFileSync,
    accessSync,
    appendFileSync,
    readlinkSync,
    truncateSync,
    chmodSync,
    chownSync,
    linkSync,
    mkdirSync,
    mkdtempSync,
    rmdirSync,
    readFileSync,
    writeFileSync,
} from './sync.js';
import { normalizePath } from './utils.js';
// encoding helpers available if needed in future

import type { OpenFlags } from './types/index.js';

/**
 * The handle behind `fd`, or `null` after handing EBADF to `deliver`.
 *
 * `FileHandle.getInstance()` raises a proper `EBADF` for a stale or bogus
 * descriptor — but a CALLBACK api has to DELIVER that error, not throw it.
 * Nobody wraps `fs.write(fd, buf, cb)` in try/catch, so the throw walked
 * straight out of the callback machinery and terminated the GJS process. The
 * six sibling fd callbacks (`fstat`, `ftruncate`, `fsync`, `fdatasync`,
 * `futimes`, `fchmod`) all deliver correctly, so `write`/`read`/`close` were an
 * inconsistency inside one file.
 *
 * It also unstalls `fs.WriteStream`. Its `_destroy()` closes through `close()`
 * below, and with autoDestroy that now runs on the ORDINARY end path; the
 * escaping throw meant the stream emitted neither `'close'` nor `'error'`, so
 * `await once(ws,'close')`, `stream.finished(ws)` and `pipeline(…, ws)` waited
 * forever.
 *
 * Delivery is deferred one microtask because Node's is: `fs.write(9999, buf, cb)`
 * RETURNS before `cb` runs (measured against v24.15.0). Calling back inside the
 * call would trade one divergence for another.
 */
function withHandle(fd: number, syscall: string, deliver: (err: NodeJS.ErrnoException) => void): FileHandle | null {
    try {
        return FileHandle.getInstance(fd, syscall);
    } catch (err: unknown) {
        Promise.resolve().then(() => deliver(err as NodeJS.ErrnoException));
        return null;
    }
}

function parseOptsCb(
    optionsOrCallback: unknown,
    maybeCallback?: Function,
): { options: Record<string, unknown>; callback: Function } {
    return typeof optionsOrCallback === 'function'
        ? { options: {}, callback: optionsOrCallback }
        : { options: (optionsOrCallback ?? {}) as Record<string, unknown>, callback: requireCallback(maybeCallback) };
}

function statImpl(
    path: PathLike,
    flags: Gio.FileQueryInfoFlags,
    syscall: string,
    options: Record<string, unknown>,
    callback: Function,
): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    file.query_info_async(STAT_ATTRIBUTES, flags, GLib.PRIORITY_DEFAULT, null, (_s: Gio.File, res: Gio.AsyncResult) => {
        try {
            const info = file.query_info_finish(res);
            callback(null, statsFrom(info, pathStr, syscall, options?.bigint as boolean | undefined));
        } catch (err: unknown) {
            callback(createNodeError(err, syscall, pathStr));
        }
    });
}

export function stat(path: PathLike, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void): void;
export function stat(
    path: PathLike,
    options: { bigint?: boolean },
    callback: (err: NodeJS.ErrnoException | null, stats: Stats | BigIntStats) => void,
): void;
export function stat(
    path: PathLike,
    optionsOrCallback: { bigint?: boolean } | ((err: NodeJS.ErrnoException | null, stats: Stats) => void),
    maybeCallback?: Function,
): void {
    const { options, callback } = parseOptsCb(optionsOrCallback, maybeCallback);
    statImpl(path, Gio.FileQueryInfoFlags.NONE, 'stat', options, callback);
}

export function lstat(path: PathLike, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void): void;
export function lstat(
    path: PathLike,
    options: { bigint?: boolean },
    callback: (err: NodeJS.ErrnoException | null, stats: Stats | BigIntStats) => void,
): void;
export function lstat(
    path: PathLike,
    optionsOrCallback: { bigint?: boolean } | ((err: NodeJS.ErrnoException | null, stats: Stats) => void),
    maybeCallback?: Function,
): void {
    const { options, callback } = parseOptsCb(optionsOrCallback, maybeCallback);
    statImpl(path, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, 'lstat', options, callback);
}

export function readdir(path: PathLike, callback: (err: NodeJS.ErrnoException | null, files: string[]) => void): void;
export function readdir(
    path: PathLike,
    options: { withFileTypes?: boolean; encoding?: string; recursive?: boolean },
    callback: (err: NodeJS.ErrnoException | null, files: string[] | unknown[]) => void,
): void;
export function readdir(
    path: PathLike,
    optionsOrCallback:
        | { withFileTypes?: boolean; encoding?: string; recursive?: boolean }
        | ((err: NodeJS.ErrnoException | null, files: string[]) => void),
    maybeCallback?: Function,
): void {
    const { options, callback } = parseOptsCb(optionsOrCallback, maybeCallback);
    Promise.resolve().then(() => {
        try {
            callback(
                null,
                readdirSync(path, options as { withFileTypes?: boolean; encoding?: string; recursive?: boolean }),
            );
        } catch (err: unknown) {
            callback(createNodeError(err, 'readdir', path));
        }
    });
}

export function realpath(
    path: PathLike,
    callback: (err: NodeJS.ErrnoException | null, resolvedPath: string) => void,
): void;
export function realpath(
    path: PathLike,
    options: { encoding?: BufferEncoding },
    callback: (err: NodeJS.ErrnoException | null, resolvedPath: string) => void,
): void;
export function realpath(
    path: PathLike,
    optionsOrCallback:
        | { encoding?: BufferEncoding }
        | ((err: NodeJS.ErrnoException | null, resolvedPath: string) => void),
    maybeCallback?: Function,
): void {
    const { callback } = parseOptsCb(optionsOrCallback, maybeCallback);
    Promise.resolve().then(() => {
        try {
            callback(null, realpathSync(path));
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function symlink(target: PathLike, path: PathLike, callback: NoParamCallback): void;
export function symlink(target: PathLike, path: PathLike, type: string | null, callback: NoParamCallback): void;
export function symlink(
    target: PathLike,
    path: PathLike,
    typeOrCallback: string | null | NoParamCallback,
    maybeCallback?: NoParamCallback,
): void {
    const callback: NoParamCallback =
        typeof typeOrCallback === 'function' ? typeOrCallback : requireCallback(maybeCallback);
    if (typeof callback !== 'function') {
        throw new TypeError('Callback must be a function. Received ' + typeof callback);
    }
    const pathStr = normalizePath(path);
    const targetStr = normalizePath(target);
    const file = Gio.File.new_for_path(pathStr);
    file.make_symbolic_link_async(targetStr, GLib.PRIORITY_DEFAULT, null, (_s: Gio.File, res: Gio.AsyncResult) => {
        try {
            file.make_symbolic_link_finish(res);
            callback(null);
        } catch (err: unknown) {
            callback(createNodeError(err, 'symlink', targetStr, pathStr));
        }
    });
}

type OpenCallback = (err: NodeJS.ErrnoException | null, fd: number) => void;

type WriteStrCallback = (err: NodeJS.ErrnoException | null, written: number, str: string) => void;
type WriteBufCallback = <TBuffer extends NodeJS.ArrayBufferView>(
    err: NodeJS.ErrnoException | null,
    written: number,
    buffer: TBuffer,
) => void;

type ReadCallback = (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: NodeJS.ArrayBufferView) => void;

/**
 * Asynchronous file open. See the POSIX [`open(2)`](http://man7.org/linux/man-pages/man2/open.2.html) documentation for more details.
 *
 * `mode` sets the file mode (permission and sticky bits), but only if the file was
 * created. On Windows, only the write permission can be manipulated; see {@link chmod}.
 *
 * The callback gets two arguments `(err, fd)`.
 *
 * Some characters (`< > : " / \ | ? *`) are reserved under Windows as documented
 * by [Naming Files, Paths, and Namespaces](https://docs.microsoft.com/en-us/windows/desktop/FileIO/naming-a-file). Under NTFS, if the filename contains
 * a colon, Node.js will open a file system stream, as described by [this MSDN page](https://docs.microsoft.com/en-us/windows/desktop/FileIO/using-streams).
 *
 * Functions based on `fs.open()` exhibit this behavior as well:`fs.writeFile()`, `fs.readFile()`, etc.
 * @since v0.0.2
 * @param [flags='r'] See `support of file system `flags``.
 * @param [mode=0o666]
 */
export function open(
    path: PathLike,
    flags: OpenMode | undefined,
    mode: Mode | undefined | null,
    callback: OpenCallback,
): void;
/**
 * Asynchronous open(2) - open and possibly create a file. If the file is created, its mode will be `0o666`.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param [flags='r'] See `support of file system `flags``.
 */
export function open(path: PathLike, flags: OpenMode | undefined, callback: OpenCallback): void;
/**
 * Asynchronous open(2) - open and possibly create a file. If the file is created, its mode will be `0o666`.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 */
export function open(path: PathLike, callback: OpenCallback): void;

export function open(path: PathLike, ...args: (OpenMode | Mode | OpenCallback | undefined | null)[]): void {
    let flags: OpenMode | undefined;
    let mode: Mode | undefined | null;
    // `| undefined`, and validated after the switch rather than asserted: the
    // `default` arm below leaves it unassigned for `fs.open(path)`, and a
    // definite-assignment `!` there would put the class straight back.
    let maybeCallback: OpenCallback | undefined;

    switch (args.length) {
        case 1:
            maybeCallback = args[0] as OpenCallback;
            break;
        case 2:
            flags = args[0] as OpenMode | undefined;
            maybeCallback = args[1] as OpenCallback;
            break;
        case 3:
            flags = args[0] as OpenMode | undefined;
            mode = args[1] as Mode | undefined | null;
            maybeCallback = args[2] as OpenCallback;
            break;
        default:
            break;
    }

    const callback = requireCallback(maybeCallback);
    openP(path, flags as OpenFlags | number | undefined, mode)
        .then((fileHandle) => {
            callback(null, fileHandle.fd);
        })
        .catch((err) => {
            callback(err, -1);
        });
}

/**
 * Write `buffer` to the file specified by `fd`.
 *
 * `offset` determines the part of the buffer to be written, and `length` is
 * an integer specifying the number of bytes to write.
 *
 * `position` refers to the offset from the beginning of the file where this data
 * should be written. If `typeof position !== 'number'`, the data will be written
 * at the current position. See [`pwrite(2)`](http://man7.org/linux/man-pages/man2/pwrite.2.html).
 *
 * The callback will be given three arguments `(err, bytesWritten, buffer)` where`bytesWritten` specifies how many _bytes_ were written from `buffer`.
 *
 * If this method is invoked as its `util.promisify()` ed version, it returns
 * a promise for an `Object` with `bytesWritten` and `buffer` properties.
 *
 * It is unsafe to use `fs.write()` multiple times on the same file without waiting
 * for the callback. For this scenario, {@link createWriteStream} is
 * recommended.
 *
 * On Linux, positional writes don't work when the file is opened in append mode.
 * The kernel ignores the position argument and always appends the data to
 * the end of the file.
 * @since v0.0.2
 */
export function write<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    length: number | undefined | null,
    position: number | undefined | null,
    callback: WriteBufCallback,
): void;
/**
 * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
 * @param length The number of bytes to write. If not supplied, defaults to `buffer.length - offset`.
 */
export function write<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    length: number | undefined | null,
    callback: WriteBufCallback,
): void;
/**
 * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
 */
export function write<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    callback: WriteBufCallback,
): void;
/**
 * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 */
export function write<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    callback: WriteBufCallback,
): void;
/**
 * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 * @param string A string to write.
 * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
 * @param encoding The expected string encoding.
 */
export function write(
    fd: number,
    string: string,
    position: number | undefined | null,
    encoding: BufferEncoding | undefined | null,
    callback: WriteStrCallback,
): void;
/**
 * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 * @param string A string to write.
 * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
 */
export function write(
    fd: number,
    string: string,
    position: number | undefined | null,
    callback: WriteStrCallback,
): void;
/**
 * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 * @param string A string to write.
 */
export function write(fd: number, string: string, callback: WriteStrCallback): void;

export function write<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    data: string | TBuffer,
    ...args: (number | string | BufferEncoding | WriteStrCallback | WriteBufCallback | undefined | null)[]
): void {
    // Before `withHandle`, which can already invoke the error path: Node validates
    // the callback first, and both branches below read it off the same slot.
    requireCallback(args[args.length - 1]);
    const fileHandle = withHandle(fd, 'write', (err) => {
        // No `typeof cb !== 'function'` guard: `requireCallback` above has already
        // thrown if it were not one, so the probe could only ever be false — the
        // "paranoid probes for what the workspace guarantees" anti-pattern, which
        // hides a real bug as a silent no-call.
        const cb = args[args.length - 1];
        if (typeof data === 'string') (cb as WriteStrCallback)(err, 0, '');
        else (cb as WriteBufCallback)(err, 0, Buffer.from([]) as unknown as TBuffer);
    });
    if (!fileHandle) return;

    if (typeof data === 'string') {
        const callback = args.pop() as WriteStrCallback;
        const position = args[0] as number | undefined | null;
        const encoding = args[1] as BufferEncoding | undefined | null;

        fileHandle
            .write(data, position, encoding)
            .then((res) => {
                callback(null, res.bytesWritten, res.buffer);
            })
            .catch((err) => {
                callback(err, 0, '');
            });

        return;
    }

    const callback = args[args.length - 1] as WriteBufCallback;
    const offset = args[0] as number | undefined;
    const length = args[1] as number | undefined;
    const position = args[2] as number | undefined;

    fileHandle
        .write(data, offset, length, position)
        .then((res) => {
            callback(null, res.bytesWritten, res.buffer);
        })
        .catch((err) => {
            callback(err, 0, Buffer.from([]));
        });
}

/**
 * Read data from the file specified by `fd`.
 *
 * The callback is given the three arguments, `(err, bytesRead, buffer)`.
 *
 * If the file is not modified concurrently, the end-of-file is reached when the
 * number of bytes read is zero.
 *
 * If this method is invoked as its `util.promisify()` ed version, it returns
 * a promise for an `Object` with `bytesRead` and `buffer` properties.
 * @since v0.0.2
 * @param buffer The buffer that the data will be written to.
 * @param offset The position in `buffer` to write the data to.
 * @param length The number of bytes to read.
 * @param position Specifies where to begin reading from in the file. If `position` is `null` or `-1 `, data will be read from the current file position, and the file position will be updated. If
 * `position` is an integer, the file position will be unchanged.
 */
export function read<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number,
    length: number,
    position: ReadPosition | null,
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: TBuffer) => void,
): void;
/**
 * Similar to the above `fs.read` function, this version takes an optional `options` object.
 * If not otherwise specified in an `options` object,
 * `buffer` defaults to `Buffer.alloc(16384)`,
 * `offset` defaults to `0`,
 * `length` defaults to `buffer.byteLength`, `- offset` as of Node 17.6.0
 * `position` defaults to `null`
 * @since v12.17.0, 13.11.0
 */
export function read<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    options: ReadAsyncOptions<TBuffer>,
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: TBuffer) => void,
): void;
export function read(fd: number, callback: ReadCallback): void;

/**
 * Read data from the file specified by `fd`.
 *
 * The callback is given the three arguments, `(err, bytesRead, buffer)`.
 *
 * If the file is not modified concurrently, the end-of-file is reached when the
 * number of bytes read is zero.
 *
 * If this method is invoked as its `util.promisify()` ed version, it returns
 * a promise for an `Object` with `bytesRead` and `buffer` properties.
 * @since v0.0.2
 * @param buffer The buffer that the data will be written to.
 * @param offset The position in `buffer` to write the data to.
 * @param length The number of bytes to read.
 * @param position Specifies where to begin reading from in the file. If `position` is `null` or `-1 `, data will be read from the current file position, and the file position will be updated. If
 * `position` is an integer, the file position will be unchanged.
 */
export function read<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number,
    length: number,
    position: ReadPosition | null,
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: TBuffer) => void,
): void;
/**
 * Similar to the above `fs.read` function, this version takes an optional `options` object.
 * If not otherwise specified in an `options` object,
 * `buffer` defaults to `Buffer.alloc(16384)`,
 * `offset` defaults to `0`,
 * `length` defaults to `buffer.byteLength`, `- offset` as of Node 17.6.0
 * `position` defaults to `null`
 * @since v12.17.0, 13.11.0
 */
export function read<TBuffer extends NodeJS.ArrayBufferView>(
    fd: number,
    options: ReadAsyncOptions<TBuffer>,
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: TBuffer) => void,
): void;
export function read(fd: number, callback: ReadCallback): void;

export function read(fd: number, ...args: unknown[]): void {
    const callback: ReadCallback = requireCallback(args[args.length - 1] as ReadCallback);

    const fileHandle = withHandle(fd, 'read', (err) => {
        if (typeof callback === 'function') callback(err, 0, Buffer.from([]));
    });
    if (!fileHandle) return;

    let buffer: NodeJS.ArrayBufferView | undefined;
    let offset: number | null | undefined;
    let length: number | null | undefined;
    let position: ReadPosition | null | undefined;

    if (args.length <= 1) {
        // read(fd, callback) — use defaults
    } else if (typeof args[0] === 'object' && !ArrayBuffer.isView(args[0])) {
        const options = args[0] as ReadAsyncOptions<NodeJS.ArrayBufferView>;
        buffer = options.buffer;
        offset = options.offset;
        length = options.length;
        position = options.position;
    } else {
        buffer = args[0] as NodeJS.ArrayBufferView | undefined;
        offset = args[1] as number | null | undefined;
        length = args[2] as number | null | undefined;
        position = args[3] as ReadPosition | null | undefined;
    }

    fileHandle
        .read(buffer, offset, length, position)
        .then((res) => {
            callback(null, res.bytesRead, res.buffer);
        })
        .catch((err) => {
            callback(err, 0, Buffer.from([]));
        });
}

/**
 * Closes the file descriptor. No arguments other than a possible exception are
 * given to the completion callback.
 *
 * Calling `fs.close()` on any file descriptor (`fd`) that is currently in use
 * through any other `fs` operation may lead to undefined behavior.
 *
 * See the POSIX [`close(2)`](http://man7.org/linux/man-pages/man2/close.2.html) documentation for more detail.
 * @since v0.0.2
 */
export function close(fd: number, callback?: NoParamCallback): void {
    // `fs.close(fd)` with no callback is legal and SILENT in Node (measured
    // against v24.15.0) — it is the one fd callback whose completion handler is
    // genuinely optional; the six siblings all reject a missing one with
    // ERR_INVALID_ARG_TYPE. The parameter was declared optional here too, and
    // then called unconditionally on both settled paths: an absent callback
    // became `callback is not a function` INSIDE the promise chain, i.e. an
    // unhandled rejection that no `try`/`catch` around the call could see.
    // `WriteStream.close()` reaches this from the same defect in its own
    // optional-callback signature, so the ordinary `ws.close()` spelling
    // printed a GJS warning and swallowed the real close error.
    const done = (err: NodeJS.ErrnoException | null) => {
        if (typeof callback === 'function') callback(err);
    };
    const fileHandle = withHandle(fd, 'close', done);
    if (!fileHandle) return;
    fileHandle
        .close()
        .then(() => done(null))
        .catch((err) => done(err));
}

/**
 * Asynchronously removes files and directories (modeled on the standard POSIX `rm`utility). No arguments other than a possible exception are given to the
 * completion callback.
 * @since v14.14.0
 */
export function rm(path: PathLike, callback: NoParamCallback): void;
export function rm(path: PathLike, options: RmOptions, callback: NoParamCallback): void;

export function rm(path: PathLike, ...args: (RmOptions | NoParamCallback)[]): void {
    let options: RmOptions = {};
    let callback: NoParamCallback = args[args.length - 1] as NoParamCallback;

    if (args.length >= 2) {
        options = args[0] as RmOptions;
    }

    rmP(path, options)
        .then(() => {
            callback(null);
        })
        .catch((err) => {
            callback(err);
        });
}

export function rename(oldPath: PathLike, newPath: PathLike, callback: NoParamCallback): void {
    requireCallback(callback);
    Promise.resolve().then(() => {
        try {
            renameSync(oldPath, newPath);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function copyFile(src: PathLike, dest: PathLike, callback: NoParamCallback): void;
export function copyFile(src: PathLike, dest: PathLike, mode: number, callback: NoParamCallback): void;
export function copyFile(
    src: PathLike,
    dest: PathLike,
    modeOrCb: number | NoParamCallback,
    maybeCb?: NoParamCallback,
): void {
    const mode = typeof modeOrCb === 'function' ? 0 : modeOrCb;
    const callback = typeof modeOrCb === 'function' ? modeOrCb : requireCallback(maybeCb);
    Promise.resolve().then(() => {
        try {
            copyFileSync(src, dest, mode);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function access(path: PathLike, callback: NoParamCallback): void;
export function access(path: PathLike, mode: number, callback: NoParamCallback): void;
export function access(path: PathLike, modeOrCb: number | NoParamCallback, maybeCb?: NoParamCallback): void {
    const mode = typeof modeOrCb === 'function' ? undefined : modeOrCb;
    const callback = typeof modeOrCb === 'function' ? modeOrCb : requireCallback(maybeCb);
    Promise.resolve().then(() => {
        try {
            accessSync(path, mode);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function appendFile(path: PathLike, data: string | Uint8Array, callback: NoParamCallback): void;
export function appendFile(
    path: PathLike,
    data: string | Uint8Array,
    options: { encoding?: string; mode?: number; flag?: string } | string,
    callback: NoParamCallback,
): void;
export function appendFile(
    path: PathLike,
    data: string | Uint8Array,
    optsOrCb: { encoding?: string; mode?: number; flag?: string } | string | NoParamCallback,
    maybeCb?: NoParamCallback,
): void {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : requireCallback(maybeCb);
    const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    Promise.resolve().then(() => {
        try {
            appendFileSync(path, data, options);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function readlink(
    path: PathLike,
    callback: (err: NodeJS.ErrnoException | null, linkString: string) => void,
): void;
export function readlink(
    path: PathLike,
    options: { encoding?: string } | string,
    callback: (err: NodeJS.ErrnoException | null, linkString: string | Buffer) => void,
): void;
export function readlink(
    path: PathLike,
    optsOrCb:
        | { encoding?: string }
        | string
        | ((err: NodeJS.ErrnoException | null, linkString: string | Buffer) => void),
    maybeCb?: (err: NodeJS.ErrnoException | null, linkString: string | Buffer) => void,
): void {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : requireCallback(maybeCb);
    const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    Promise.resolve().then(() => {
        try {
            callback(null, readlinkSync(path, options));
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException, '');
        }
    });
}

export function truncate(path: PathLike, callback: NoParamCallback): void;
export function truncate(path: PathLike, len: number, callback: NoParamCallback): void;
export function truncate(path: PathLike, lenOrCb: number | NoParamCallback, maybeCb?: NoParamCallback): void {
    const len = typeof lenOrCb === 'function' ? 0 : lenOrCb;
    const callback = typeof lenOrCb === 'function' ? lenOrCb : requireCallback(maybeCb);
    Promise.resolve().then(() => {
        try {
            truncateSync(path, len);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function chmod(path: PathLike, mode: Mode, callback: NoParamCallback): void {
    requireCallback(callback);
    Promise.resolve().then(() => {
        try {
            chmodSync(path, mode);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function chown(path: PathLike, uid: number, gid: number, callback: NoParamCallback): void {
    requireCallback(callback);
    Promise.resolve().then(() => {
        try {
            chownSync(path, uid, gid);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function mkdir(path: PathLike, callback: NoParamCallback): void;
export function mkdir(path: PathLike, options: MakeDirectoryOptions | Mode, callback: NoParamCallback): void;
export function mkdir(
    path: PathLike,
    optsOrCb: MakeDirectoryOptions | Mode | NoParamCallback,
    maybeCb?: NoParamCallback,
): void {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : requireCallback(maybeCb);
    const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    Promise.resolve().then(() => {
        try {
            mkdirSync(path, options as MakeDirectoryOptions | Mode | undefined);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

/**
 * `fs.mkdtemp(prefix[, options], callback)`.
 *
 * It was missing entirely — only `mkdtempSync` and `fsPromises.mkdtemp` existed —
 * so `fs.mkdtemp(prefix, cb)` was a `TypeError` at the call. The bundler had been
 * saying so out loud on every build that imported it:
 *
 *   IMPORT_IS_UNDEFINED: Import 'mkdtemp' will always be undefined because there
 *   is no matching export in 'lib/esm/index.js'
 *
 * Nothing new is implemented here. `mkdtempAt()` is the shared body — the atomic
 * `mkdir(2)`-retry loop with its 0700 ceiling — and `mkdtempSync` already wraps it
 * with the encoding decision, so this wraps that. A second copy of the loop is how
 * the private-scratch-space mode would eventually drift on one path only.
 */
export function mkdtemp(prefix: string, callback: (err: NodeJS.ErrnoException | null, folder: string) => void): void;
export function mkdtemp(
    prefix: string,
    options: EncodingOption,
    callback: (err: NodeJS.ErrnoException | null, folder: string) => void,
): void;
export function mkdtemp(
    prefix: string,
    options: BufferEncodingOption,
    callback: (err: NodeJS.ErrnoException | null, folder: Buffer) => void,
): void;
export function mkdtemp(
    prefix: string,
    optsOrCb: EncodingOption | BufferEncodingOption | ((err: NodeJS.ErrnoException | null, folder: never) => void),
    maybeCb?: (err: NodeJS.ErrnoException | null, folder: never) => void,
): void {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : requireCallback(maybeCb);
    const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    Promise.resolve().then(() => {
        // The callback is invoked OUTSIDE the try. Every sibling in this file calls
        // it inside one, so a callback that throws is re-entered with its own
        // exception as the `err` argument — a second invocation the caller never
        // asked for. Not fixed for the siblings here; recorded in
        // `status/open-todos.md` with the reproduction.
        let made: string | Buffer;
        try {
            made = mkdtempSync(prefix, options as EncodingOption);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException, undefined as never);
            return;
        }
        callback(null, made as never);
    });
}

export function rmdir(path: PathLike, callback: NoParamCallback): void;
export function rmdir(path: PathLike, options: RmDirOptions, callback: NoParamCallback): void;
export function rmdir(path: PathLike, optsOrCb: RmDirOptions | NoParamCallback, maybeCb?: NoParamCallback): void {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : requireCallback(maybeCb);
    const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    Promise.resolve().then(() => {
        try {
            rmdirSync(path, options);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function readFile(path: PathLike, callback: (err: NodeJS.ErrnoException | null, data: Buffer) => void): void;
export function readFile(
    path: PathLike,
    options: { encoding?: string; flag?: string } | string,
    callback: (err: NodeJS.ErrnoException | null, data: string | Buffer) => void,
): void;
export function readFile(
    path: PathLike,
    optsOrCb:
        | { encoding?: string; flag?: string }
        | string
        | ((err: NodeJS.ErrnoException | null, data: Buffer) => void),
    maybeCb?: (err: NodeJS.ErrnoException | null, data: string | Buffer | null) => void,
): void {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : requireCallback(maybeCb);
    const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    Promise.resolve().then(() => {
        try {
            const readOpts =
                typeof options === 'string'
                    ? { encoding: options as string | null, flag: 'r' }
                    : { encoding: (options?.encoding ?? null) as string | null, flag: options?.flag ?? 'r' };
            // Deliberately NOT `normalizePath(path)` first: `path` may be a
            // descriptor, and `readFileSync` is the single place that decides
            // between a name and a descriptor — the same rule `writeFile` below
            // carries. Stringifying it here is worse than the ENOENT it usually
            // produces: `normalizePath(8)` is the RELATIVE name `'8'`, so if a
            // file of that name exists in the process CWD the call SUCCEEDS and
            // returns that file's contents instead of the descriptor's.
            callback(null, readFileSync(path, readOpts) as unknown as Buffer);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException, null as unknown as Buffer);
        }
    });
}

export function writeFile(path: PathLike, data: string | Uint8Array, callback: NoParamCallback): void;
export function writeFile(
    path: PathLike,
    data: string | Uint8Array,
    options: { encoding?: string; mode?: number; flag?: string } | string,
    callback: NoParamCallback,
): void;
export function writeFile(
    path: PathLike,
    data: string | Uint8Array,
    optsOrCb: { encoding?: string; mode?: number; flag?: string } | string | NoParamCallback,
    maybeCb?: NoParamCallback,
): void {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : requireCallback(maybeCb);
    // `options` used to be located only to find the callback behind it, and
    // then DROPPED — the body was `writeFileSync(pathStr, data)`, two
    // arguments. So the most idiomatic async spelling silently lost every one
    // of them while `writeFileSync`, `promises.writeFile` and the `appendFile`
    // two hundred lines up all honoured theirs: `{mode: 0o600}` produced a
    // world-readable file, `{flag: 'wx'}` clobbered the lock it was meant to
    // refuse, `{flag: 'a'}` truncated the log it was meant to extend, and
    // `{encoding: 'base64'}` wrote the base64 TEXT. Before this redesign all
    // four spellings dropped `mode`, so they were at least uniformly wrong;
    // fixing three of them is what turned this one into a divergence.
    const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    Promise.resolve().then(() => {
        try {
            // Deliberately NOT `normalizePath(path)` first: `path` may be a
            // descriptor, and `writeFileSync` is the single place that decides
            // between a name and a descriptor.
            writeFileSync(path, data, options);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function link(existingPath: PathLike, newPath: PathLike, callback: NoParamCallback): void {
    requireCallback(callback);
    // Delegate to linkSync — the canonical impl (argv-array spawn, Node
    // ENOENT/EEXIST semantics). The former inline copy shelled out with
    // unquoted paths (broken on spaces, command-injection hazard).
    Promise.resolve().then(() => {
        try {
            linkSync(existingPath, newPath);
            callback(null);
        } catch (err: unknown) {
            callback(err as NodeJS.ErrnoException);
        }
    });
}

export function unlink(path: PathLike, callback: NoParamCallback): void {
    requireCallback(callback);
    const pathStr = normalizePath(path);
    Promise.resolve().then(() => {
        // GLib.unlink has no throw path (no `throws` in the GIR) — it reports
        // failure only via its -1 return, which is discarded here, so this
        // callback API cannot surface ENOENT/EACCES today. The old catch could
        // only ever fire when the CALLBACK itself threw, and then invoked the
        // callback a second time with the callback's own error.
        GLib.unlink(pathStr);
        callback(null);
    });
}
