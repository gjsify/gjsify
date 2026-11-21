// Descriptor table behind the synchronous `openSync` / `readSync` / `fstatSync` / `closeSync` of the bridge.
//
// The platform halves (`java.io.RandomAccessFile`, `NSFileHandle`) sit behind `FdBackend`, so the
// bookkeeping that is Node's contract — descriptor numbers, `position` semantics, `EBADF`, a read
// at EOF answering 0 — is held by specs on Node + GJS with a fake, and only the Java/ObjC calls
// are left for a device (`tests/integration/nativescript`).

/** One open, read-only file as the platform exposes it. */
export interface FdHandle {
    /** Read up to `length` bytes starting at absolute `position`; fewer (or 0) at EOF. */
    readAt(position: number, length: number): Uint8Array;
    /** Current size in bytes and last-modified time (ms since epoch) of the open file. */
    stat(): { size: number; mtimeMs: number };
    close(): void;
}

/** The slice of `fs.Stats` a descriptor can answer: a regular file, read-only. */
export interface FdStats {
    size: number;
    mtimeMs: number;
    mtime: Date;
    isFile(): boolean;
    isDirectory(): boolean;
}

export interface FdBackend {
    /** Open `path` for reading; returns `null` when it does not exist. */
    openRead(path: string): FdHandle | null;
}

export interface FdFsError extends Error {
    code: string;
    syscall: string;
    path?: string;
}

export function fdError(code: string, message: string, syscall: string, path?: string): FdFsError {
    const err = new Error(`${code}: ${message}, ${syscall}${path === undefined ? '' : ` '${path}'`}`) as FdFsError;
    err.code = code;
    err.syscall = syscall;
    if (path !== undefined) err.path = path;
    return err;
}

export interface ReadSyncOptions {
    offset?: number;
    length?: number;
    position?: number | bigint | null;
}

interface OpenFile {
    handle: FdHandle;
    /** Where a `position: null` read continues, as in a POSIX descriptor. */
    cursor: number;
}

// 0–2 are stdio on every Node host; a descriptor handed out here must never look like one.
const FIRST_FD = 3;

export function createFdTable(backend: FdBackend) {
    const files = new Map<number, OpenFile>();
    let next = FIRST_FD;

    const lookup = (fd: number, syscall: string): OpenFile => {
        const file = files.get(fd);
        if (file === undefined) throw fdError('EBADF', 'bad file descriptor', syscall);
        return file;
    };

    return {
        openSync(path: string, flags: string | number = 'r'): number {
            if (flags !== 'r' && flags !== 0) {
                throw fdError('ENOSYS', `flags ${String(flags)} are not supported, only read-only`, 'open', path);
            }
            const handle = backend.openRead(path);
            if (handle === null) throw fdError('ENOENT', 'no such file or directory', 'open', path);
            const fd = next++;
            files.set(fd, { handle, cursor: 0 });
            return fd;
        },

        readSync(
            fd: number,
            buffer: Uint8Array,
            offsetOrOptions?: number | ReadSyncOptions | null,
            lengthArg?: number,
            positionArg?: number | bigint | null,
        ): number {
            const file = lookup(fd, 'read');
            let offset = 0;
            let length = buffer.byteLength;
            let position: number | bigint | null | undefined = null;
            if (typeof offsetOrOptions === 'object' && offsetOrOptions !== null) {
                offset = offsetOrOptions.offset ?? 0;
                length = offsetOrOptions.length ?? buffer.byteLength - offset;
                position = offsetOrOptions.position;
            } else {
                offset = (offsetOrOptions as number | null | undefined) ?? 0;
                length = lengthArg ?? buffer.byteLength - offset;
                position = positionArg;
            }
            if (offset < 0 || offset > buffer.byteLength) {
                throw fdError('ERR_OUT_OF_RANGE', 'offset is out of range', 'read');
            }
            if (length < 0 || offset + length > buffer.byteLength) {
                throw fdError('ERR_OUT_OF_RANGE', 'length is out of range', 'read');
            }
            if (length === 0) return 0;
            const at = position === null || position === undefined || position === -1 ? file.cursor : Number(position);
            const bytes = file.handle.readAt(at, length);
            buffer.set(bytes, offset);
            // Node moves the descriptor's own cursor only for a read without an explicit position.
            if (position === null || position === undefined || position === -1) file.cursor += bytes.length;
            return bytes.length;
        },

        fstatSync(fd: number): FdStats {
            const { size, mtimeMs } = lookup(fd, 'fstat').handle.stat();
            return { size, mtimeMs, mtime: new Date(mtimeMs), isFile: () => true, isDirectory: () => false };
        },

        closeSync(fd: number): void {
            const file = lookup(fd, 'close');
            files.delete(fd);
            file.handle.close();
        },
    };
}
