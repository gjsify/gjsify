// Reference: Node.js lib/fs.js (callback API)
// Reimplemented for GJS using Gio.File async operations

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { open as openP, rm as rmP } from './promises.js'
import { PathLike, OpenMode, Mode, ReadPosition, ReadAsyncOptions, NoParamCallback, RmOptions, RmDirOptions, MakeDirectoryOptions } from 'fs';
import { FileHandle } from './file-handle.js';
import { Buffer } from 'buffer';
import { Stats, BigIntStats, STAT_ATTRIBUTES } from './stats.js';
import { createNodeError } from './errors.js';
import { realpathSync, readdirSync, renameSync, copyFileSync, accessSync, appendFileSync, readlinkSync, truncateSync, chmodSync, chownSync, mkdirSync, rmdirSync, readFileSync, writeFileSync } from './sync.js';
// encoding helpers available if needed in future

import type { OpenFlags } from './types/index.js';

// --- helpers ---

function parseOptsCb(optionsOrCallback: unknown, maybeCallback?: Function): { options: Record<string, unknown>; callback: Function } {
  return typeof optionsOrCallback === 'function'
    ? { options: {}, callback: optionsOrCallback }
    : { options: (optionsOrCallback ?? {}) as Record<string, unknown>, callback: maybeCallback! };
}

function statImpl(path: PathLike, flags: Gio.FileQueryInfoFlags, syscall: string, options: Record<string, unknown>, callback: Function): void {
  const file = Gio.File.new_for_path(path.toString());
  file.query_info_async(STAT_ATTRIBUTES, flags, GLib.PRIORITY_DEFAULT, null, (_s: Gio.File, res: Gio.AsyncResult) => {
    try {
      const info = file.query_info_finish(res);
      callback(null, options?.bigint ? new BigIntStats(info, path) : new Stats(info, path));
    } catch (err: unknown) {
      callback(createNodeError(err, syscall, path));
    }
  });
}

// --- stat / lstat ---

export function stat(path: PathLike, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void): void;
export function stat(path: PathLike, options: { bigint?: boolean }, callback: (err: NodeJS.ErrnoException | null, stats: Stats | BigIntStats) => void): void;
export function stat(path: PathLike, optionsOrCallback: { bigint?: boolean } | ((err: NodeJS.ErrnoException | null, stats: Stats) => void), maybeCallback?: Function): void {
  const { options, callback } = parseOptsCb(optionsOrCallback, maybeCallback);
  statImpl(path, Gio.FileQueryInfoFlags.NONE, 'stat', options, callback);
}

export function lstat(path: PathLike, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void): void;
export function lstat(path: PathLike, options: { bigint?: boolean }, callback: (err: NodeJS.ErrnoException | null, stats: Stats | BigIntStats) => void): void;
export function lstat(path: PathLike, optionsOrCallback: { bigint?: boolean } | ((err: NodeJS.ErrnoException | null, stats: Stats) => void), maybeCallback?: Function): void {
  const { options, callback } = parseOptsCb(optionsOrCallback, maybeCallback);
  statImpl(path, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, 'lstat', options, callback);
}

// --- readdir ---

export function readdir(path: PathLike, callback: (err: NodeJS.ErrnoException | null, files: string[]) => void): void;
export function readdir(path: PathLike, options: { withFileTypes?: boolean; encoding?: string; recursive?: boolean }, callback: (err: NodeJS.ErrnoException | null, files: string[] | unknown[]) => void): void;
export function readdir(path: PathLike, optionsOrCallback: { withFileTypes?: boolean; encoding?: string; recursive?: boolean } | ((err: NodeJS.ErrnoException | null, files: string[]) => void), maybeCallback?: Function): void {
  const { options, callback } = parseOptsCb(optionsOrCallback, maybeCallback);
  Promise.resolve().then(() => {
    try {
      callback(null, readdirSync(path, options as { withFileTypes?: boolean; encoding?: string; recursive?: boolean }));
    } catch (err: unknown) {
      callback(createNodeError(err, 'readdir', path));
    }
  });
}

// --- realpath ---

export function realpath(path: PathLike, callback: (err: NodeJS.ErrnoException | null, resolvedPath: string) => void): void;
export function realpath(path: PathLike, options: { encoding?: BufferEncoding }, callback: (err: NodeJS.ErrnoException | null, resolvedPath: string) => void): void;
export function realpath(path: PathLike, optionsOrCallback: { encoding?: BufferEncoding } | ((err: NodeJS.ErrnoException | null, resolvedPath: string) => void), maybeCallback?: Function): void {
  const { callback } = parseOptsCb(optionsOrCallback, maybeCallback);
  Promise.resolve().then(() => {
    try {
      callback(null, realpathSync(path));
    } catch (err: unknown) {
      callback(err);
    }
  });
}

// --- symlink ---

export function symlink(target: PathLike, path: PathLike, callback: NoParamCallback): void;
export function symlink(target: PathLike, path: PathLike, type: string | null, callback: NoParamCallback): void;
export function symlink(target: PathLike, path: PathLike, typeOrCallback: string | null | NoParamCallback, maybeCallback?: NoParamCallback): void {
  const callback: NoParamCallback = typeof typeOrCallback === 'function' ? typeOrCallback : maybeCallback!;
  if (typeof callback !== 'function') {
    throw new TypeError('Callback must be a function. Received ' + typeof callback);
  }
  const file = Gio.File.new_for_path(path.toString());
  file.make_symbolic_link_async(target.toString(), GLib.PRIORITY_DEFAULT, null, (_s: Gio.File, res: Gio.AsyncResult) => {
    try {
      file.make_symbolic_link_finish(res);
      callback(null);
    } catch (err: unknown) {
      callback(createNodeError(err, 'symlink', target, path));
    }
  });
}

type OpenCallback = (err: NodeJS.ErrnoException | null, fd: number) => void;

type WriteStrCallback = (err: NodeJS.ErrnoException | null, written: number, str: string) => void;
type WriteBufCallback = <TBuffer extends NodeJS.ArrayBufferView> (err: NodeJS.ErrnoException | null, written: number, buffer: TBuffer) => void;

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
export function open(path: PathLike, flags: OpenMode | undefined, mode: Mode | undefined | null, callback: OpenCallback): void;
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
    let callback: OpenCallback

    switch (args.length) {
        case 1:
            callback = args[0] as OpenCallback
            break;
        case 2:
            flags = args[0] as OpenMode | undefined
            callback = args[1] as OpenCallback
            break;
        case 3:
            flags = args[0] as OpenMode | undefined
            mode = args[1] as Mode | undefined | null
            callback = args[2] as OpenCallback
            break;
        default:
            break;
    }

    openP(path, flags as OpenFlags | undefined, mode)
    .then((fileHandle) => {
        callback(null, fileHandle.fd);
    })
    .catch((err) => {
        callback(err, -1);
    })
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
    callback: WriteBufCallback
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
    callback: WriteBufCallback
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
    callback: WriteBufCallback
): void;
/**
 * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 */
export function write<TBuffer extends NodeJS.ArrayBufferView>(fd: number, buffer: TBuffer, callback: WriteBufCallback): void;
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
    callback: WriteStrCallback
): void;
/**
 * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 * @param string A string to write.
 * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
 */
export function write(fd: number, string: string, position: number | undefined | null, callback: WriteStrCallback): void;
/**
 * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
 * @param fd A file descriptor.
 * @param string A string to write.
 */
export function write(fd: number, string: string, callback: WriteStrCallback): void;

export function write<TBuffer extends NodeJS.ArrayBufferView>(fd: number, data: string | TBuffer, ...args: (number | string | BufferEncoding | WriteStrCallback | WriteBufCallback | undefined | null)[]): void {

    const fileHandle = FileHandle.getInstance(fd);

    if (typeof data === 'string') {
        const callback = args.pop() as WriteStrCallback;
        const position = args[0] as number | undefined | null;
        const encoding = args[1] as BufferEncoding | undefined | null;

        fileHandle.write(data, position, encoding)
        .then((res) => {
            callback(null, res.bytesWritten, res.buffer);
        })
        .catch((err) => {
            callback(err, 0, '');
        });

        return;
    }

    const callback = args[args.length -1] as WriteBufCallback;
    const offset = args[0] as number | undefined;
    const length = args[1] as number | undefined;
    const position = args[2] as number | undefined;

    fileHandle.write(data, offset, length, position)
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
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: TBuffer) => void
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
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: TBuffer) => void
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
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: TBuffer) => void
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
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: TBuffer) => void
): void;
export function read(fd: number, callback: ReadCallback): void;

export function read(fd: number, ...args: unknown[]): void {

    const fileHandle = FileHandle.getInstance(fd);

    const callback: ReadCallback = args[args.length -1] as ReadCallback;

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

    fileHandle.read(buffer, offset, length, position)
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
    FileHandle.getInstance(fd).close()
    .then(() => {
        callback(null);
    })
    .catch((err) => callback(err))
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
    let callback: NoParamCallback = args[args.length -1] as NoParamCallback;

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

// --- rename ---

export function rename(oldPath: PathLike, newPath: PathLike, callback: NoParamCallback): void {
  Promise.resolve().then(() => {
    try {
      renameSync(oldPath, newPath);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- copyFile ---

export function copyFile(src: PathLike, dest: PathLike, callback: NoParamCallback): void;
export function copyFile(src: PathLike, dest: PathLike, mode: number, callback: NoParamCallback): void;
export function copyFile(src: PathLike, dest: PathLike, modeOrCb: number | NoParamCallback, maybeCb?: NoParamCallback): void {
  const mode = typeof modeOrCb === 'function' ? 0 : modeOrCb;
  const callback = typeof modeOrCb === 'function' ? modeOrCb : maybeCb!;
  Promise.resolve().then(() => {
    try {
      copyFileSync(src, dest, mode);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- access ---

export function access(path: PathLike, callback: NoParamCallback): void;
export function access(path: PathLike, mode: number, callback: NoParamCallback): void;
export function access(path: PathLike, modeOrCb: number | NoParamCallback, maybeCb?: NoParamCallback): void {
  const mode = typeof modeOrCb === 'function' ? undefined : modeOrCb;
  const callback = typeof modeOrCb === 'function' ? modeOrCb : maybeCb!;
  Promise.resolve().then(() => {
    try {
      accessSync(path, mode);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- appendFile ---

export function appendFile(path: PathLike, data: string | Uint8Array, callback: NoParamCallback): void;
export function appendFile(path: PathLike, data: string | Uint8Array, options: { encoding?: string; mode?: number; flag?: string } | string, callback: NoParamCallback): void;
export function appendFile(path: PathLike, data: string | Uint8Array, optsOrCb: any, maybeCb?: NoParamCallback): void {
  const callback = typeof optsOrCb === 'function' ? optsOrCb : maybeCb!;
  const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  Promise.resolve().then(() => {
    try {
      appendFileSync(path, data, options);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- readlink ---

export function readlink(path: PathLike, callback: (err: NodeJS.ErrnoException | null, linkString: string) => void): void;
export function readlink(path: PathLike, options: { encoding?: string } | string, callback: (err: NodeJS.ErrnoException | null, linkString: string | Buffer) => void): void;
export function readlink(path: PathLike, optsOrCb: any, maybeCb?: any): void {
  const callback = typeof optsOrCb === 'function' ? optsOrCb : maybeCb!;
  const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  Promise.resolve().then(() => {
    try {
      callback(null, readlinkSync(path, options));
    } catch (err: any) {
      callback(err, '');
    }
  });
}

// --- truncate ---

export function truncate(path: PathLike, callback: NoParamCallback): void;
export function truncate(path: PathLike, len: number, callback: NoParamCallback): void;
export function truncate(path: PathLike, lenOrCb: number | NoParamCallback, maybeCb?: NoParamCallback): void {
  const len = typeof lenOrCb === 'function' ? 0 : lenOrCb;
  const callback = typeof lenOrCb === 'function' ? lenOrCb : maybeCb!;
  Promise.resolve().then(() => {
    try {
      truncateSync(path, len);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- chmod ---

export function chmod(path: PathLike, mode: Mode, callback: NoParamCallback): void {
  Promise.resolve().then(() => {
    try {
      chmodSync(path, mode);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- chown ---

export function chown(path: PathLike, uid: number, gid: number, callback: NoParamCallback): void {
  Promise.resolve().then(() => {
    try {
      chownSync(path, uid, gid);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- mkdir (callback) ---

export function mkdir(path: PathLike, callback: NoParamCallback): void;
export function mkdir(path: PathLike, options: MakeDirectoryOptions | Mode, callback: NoParamCallback): void;
export function mkdir(path: PathLike, optsOrCb: MakeDirectoryOptions | Mode | NoParamCallback, maybeCb?: NoParamCallback): void {
  const callback = typeof optsOrCb === 'function' ? optsOrCb : maybeCb!;
  const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  Promise.resolve().then(() => {
    try {
      mkdirSync(path, options as any);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- rmdir (callback) ---

export function rmdir(path: PathLike, callback: NoParamCallback): void;
export function rmdir(path: PathLike, options: RmDirOptions, callback: NoParamCallback): void;
export function rmdir(path: PathLike, optsOrCb: RmDirOptions | NoParamCallback, maybeCb?: NoParamCallback): void {
  const callback = typeof optsOrCb === 'function' ? optsOrCb : maybeCb!;
  const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  Promise.resolve().then(() => {
    try {
      rmdirSync(path, options);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- readFile (callback) ---

export function readFile(path: PathLike, callback: (err: NodeJS.ErrnoException | null, data: Buffer) => void): void;
export function readFile(path: PathLike, options: { encoding?: string; flag?: string } | string, callback: (err: NodeJS.ErrnoException | null, data: string | Buffer) => void): void;
export function readFile(path: PathLike, optsOrCb: any, maybeCb?: any): void {
  const callback = typeof optsOrCb === 'function' ? optsOrCb : maybeCb!;
  const options = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  Promise.resolve().then(() => {
    try {
      callback(null, readFileSync(path.toString(), options));
    } catch (err: any) {
      callback(err, null);
    }
  });
}

// --- writeFile (callback) ---

export function writeFile(path: PathLike, data: string | Uint8Array, callback: NoParamCallback): void;
export function writeFile(path: PathLike, data: string | Uint8Array, options: { encoding?: string; mode?: number; flag?: string } | string, callback: NoParamCallback): void;
export function writeFile(path: PathLike, data: string | Uint8Array, optsOrCb: any, maybeCb?: NoParamCallback): void {
  const callback = typeof optsOrCb === 'function' ? optsOrCb : maybeCb!;
  Promise.resolve().then(() => {
    try {
      writeFileSync(path.toString(), data);
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}

// --- unlink (callback) ---

export function unlink(path: PathLike, callback: NoParamCallback): void {
  Promise.resolve().then(() => {
    try {
      GLib.unlink(path.toString());
      callback(null);
    } catch (err: any) {
      callback(err);
    }
  });
}