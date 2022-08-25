import { open as openP, write as writeP } from './promises.js'
import { warnNotImplemented } from '@gjsify/utils';
import { PathLike, OpenMode, Mode, ReadPosition, ReadAsyncOptions, NoParamCallback, RmOptions } from './types/index.js'

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

export function open(path: PathLike, ...args: any[]): void {
    let flags: OpenMode | undefined;
    let mode: Mode | undefined | null;
    let callback: OpenCallback

    switch (args.length) {
        case 1:
            callback = args[0]
            break;
        case 2:
            flags = args[0]
            callback = args[1]
            break;
        case 3:
            flags = args[0]
            mode = args[1]
            callback = args[2]
            break;
        default:
            break;
    }

    openP(path, flags, mode)
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

export function write(fd: number, data: any, ...args: any[]): void {
    
    if (typeof data === 'string') {
        const callback: WriteStrCallback = args[args.length -1];
        writeP(fd, data, ...args.pop())
        .then((res) => {
            callback(null, res.bytesWritten, res.buffer);
        })
        .catch((err) => {
            callback(err, 0, '');
        });

        return;
    }

    const callback: WriteBufCallback = args[args.length -1];

    writeP(fd, data, ...args.pop())
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

export function read(fd: number, ...args: any[]): void {

    const callback: ReadCallback = args[args.length -1];
    const err = new Error(warnNotImplemented('fs.read'));
    callback(err, 0, Buffer.from(''));
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
    const err = new Error(warnNotImplemented('fs.close'));
    callback(err);
}

/**
 * Asynchronously removes files and directories (modeled on the standard POSIX `rm`utility). No arguments other than a possible exception are given to the
 * completion callback.
 * @since v14.14.0
 */
export function rm(path: PathLike, callback: NoParamCallback): void;
export function rm(path: PathLike, options: RmOptions, callback: NoParamCallback): void;

export function rm(path: PathLike, ...args: any[]): void {

    let options: RmOptions = {};
    let callback: NoParamCallback = args[args.length -1];

    if (args.length >= 2) {
        options = args[0];
    }

    const err = new Error(warnNotImplemented('fs.rm'));

    callback(err);
}