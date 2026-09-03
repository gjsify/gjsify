// Reference: Node.js lib/fs.js (fd-based ops, readSync, writeSync, readv, writev, exists, openAsBlob)
// Reimplemented for GJS using FileHandle + Gio streams

import { FileHandle } from './file-handle.js';
import type { Stats, BigIntStats } from './stats.js';
import { statSync, chmodSync, chownSync, readFileSync } from './sync.js';
import { utimesSync } from './utimes.js';
import { normalizePath } from './utils.js';
import { isStdFd, readStdFdSync, writeStdFdSync } from './std-fd.js';

import type { PathLike, TimeLike, StatOptions } from 'node:fs';
import { requireCallback } from './errors.js';

/**
 * The handle behind an fd, named by the syscall asking for it.
 *
 * The `syscall` is not decoration: an unknown or already-closed descriptor is
 * EBADF, and Node puts the operation in the message (`EBADF: bad file
 * descriptor, write`). Passing it from each call site is the only place that
 * knows which one it is.
 */
function getFH(fd: number | FileHandle, syscall: string): FileHandle {
    return FileHandle.getInstance(fd, syscall);
}

export function fstatSync(fd: number, options?: { bigint?: false }): Stats;
export function fstatSync(fd: number, options: { bigint: true }): BigIntStats;
export function fstatSync(fd: number, options?: { bigint?: boolean }): Stats | BigIntStats {
    // fstat(2) describes the DESCRIPTOR. Resolving the fd back to the name it
    // was opened from answers about whatever now holds that name — a different
    // inode after a rename, and nothing at all after an unlink.
    //
    // The `statSync` overload accepts a union of `{bigint?:false}` /
    // `{bigint:true}` literals; here `options.bigint` is `boolean` (loosened
    // by our entry-point overloads), so the call site needs a `StatOptions`
    // cast. Going through the public `StatOptions` type instead of `any`
    // preserves the rest of the option-bag's shape.
    return statSync(getFH(fd, 'fstat')._fdStatTarget(), options as StatOptions);
}

export function fstat(fd: number, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void): void;
export function fstat(
    fd: number,
    options: StatOptions,
    callback: (err: NodeJS.ErrnoException | null, stats: Stats | BigIntStats) => void,
): void;
export function fstat(
    fd: number,
    optionsOrCb: StatOptions | ((err: NodeJS.ErrnoException | null, stats: Stats | BigIntStats) => void),
    callback?: (err: NodeJS.ErrnoException | null, stats: Stats | BigIntStats) => void,
): void {
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : requireCallback(callback);
    const options: StatOptions = typeof optionsOrCb === 'function' ? {} : optionsOrCb;
    fstatAsync(fd, options).then(
        (s) => cb(null, s),
        (err) => cb(err as NodeJS.ErrnoException, undefined as unknown as Stats),
    );
}

export async function fstatAsync(fd: number, options?: StatOptions): Promise<Stats | BigIntStats> {
    // Pick the right overload of fstatSync based on the runtime bigint flag.
    // Casting through the precise union form keeps the call type-safe at
    // each branch instead of using `as any`.
    if (options?.bigint === true) return fstatSync(fd, options as { bigint: true });
    return fstatSync(fd, options as { bigint?: false });
}

export function ftruncateSync(fd: number, len = 0): void {
    getFH(fd, 'ftruncate')._truncateSync(len);
}

export function ftruncate(fd: number, callback: (err: NodeJS.ErrnoException | null) => void): void;
export function ftruncate(fd: number, len: number, callback: (err: NodeJS.ErrnoException | null) => void): void;
export function ftruncate(
    fd: number,
    lenOrCb: number | ((err: NodeJS.ErrnoException | null) => void),
    callback?: (err: NodeJS.ErrnoException | null) => void,
): void {
    const cb = typeof lenOrCb === 'function' ? lenOrCb : requireCallback(callback);
    const len = typeof lenOrCb === 'function' ? 0 : lenOrCb;
    ftruncateAsync(fd, len).then(() => cb(null), cb);
}

export async function ftruncateAsync(fd: number, len = 0): Promise<void> {
    ftruncateSync(fd, len);
}

// Best-effort: flush the IOChannel write buffer (equivalent to fdatasync on GJS).

export function fdatasyncSync(fd: number): void {
    getFH(fd, 'fdatasync')._flushSync();
}
export function fdatasync(fd: number, callback: (err: NodeJS.ErrnoException | null) => void): void {
    requireCallback(callback);
    Promise.resolve()
        .then(() => fdatasyncSync(fd))
        .then(() => callback(null), callback);
}
export async function fdatasyncAsync(fd: number): Promise<void> {
    fdatasyncSync(fd);
}

export function fsyncSync(fd: number): void {
    getFH(fd, 'fsync')._flushSync();
}
export function fsync(fd: number, callback: (err: NodeJS.ErrnoException | null) => void): void {
    requireCallback(callback);
    Promise.resolve()
        .then(() => fsyncSync(fd))
        .then(() => callback(null), callback);
}
export async function fsyncAsync(fd: number): Promise<void> {
    fsyncSync(fd);
}

export function fchmodSync(fd: number, mode: number | string): void {
    // fchmod(2): the descriptor, so a swapped path cannot capture the change.
    chmodSync(getFH(fd, 'fchmod')._fdStatTarget(), mode);
}
export function fchmod(fd: number, mode: number | string, callback: (err: NodeJS.ErrnoException | null) => void): void {
    requireCallback(callback);
    Promise.resolve()
        .then(() => fchmodSync(fd, mode))
        .then(() => callback(null), callback);
}
export async function fchmodAsync(fd: number, mode: number | string): Promise<void> {
    fchmodSync(fd, mode);
}

export function fchownSync(fd: number, uid: number, gid: number): void {
    chownSync(normalizePath(getFH(fd, 'fchown').options.path), uid, gid);
}
export function fchown(
    fd: number,
    uid: number,
    gid: number,
    callback: (err: NodeJS.ErrnoException | null) => void,
): void {
    requireCallback(callback);
    Promise.resolve()
        .then(() => fchownSync(fd, uid, gid))
        .then(() => callback(null), callback);
}
export async function fchownAsync(fd: number, uid: number, gid: number): Promise<void> {
    fchownSync(fd, uid, gid);
}

export function futimesSync(fd: number, atime: TimeLike, mtime: TimeLike): void {
    utimesSync(normalizePath(getFH(fd, 'futimes').options.path), atime, mtime);
}
export function futimes(
    fd: number,
    atime: TimeLike,
    mtime: TimeLike,
    callback: (err: NodeJS.ErrnoException | null) => void,
): void {
    requireCallback(callback);
    Promise.resolve()
        .then(() => futimesSync(fd, atime, mtime))
        .then(() => callback(null), callback);
}
export async function futimesAsync(fd: number, atime: TimeLike, mtime: TimeLike): Promise<void> {
    futimesSync(fd, atime, mtime);
}

export function closeSync(fd: number): void {
    // Never close the process's own stdin/stdout/stderr underneath it.
    if (isStdFd(fd)) return;
    getFH(fd, 'close')._closeSync();
}

export function readSync(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset?: number | null,
    length?: number | null,
    position?: number | null,
): number;
export function readSync(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    options: { offset?: number; length?: number; position?: number | null },
): number;
export function readSync(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offsetOrOptions?: number | null | { offset?: number; length?: number; position?: number | null },
    length?: number | null,
    position?: number | null,
): number {
    let offset = 0;
    if (offsetOrOptions !== null && typeof offsetOrOptions === 'object') {
        offset = offsetOrOptions.offset ?? 0;
        // `byteLength - offset`, matching the positional form four lines down.
        // These two spellings of one API disagreed, so the documented options
        // form threw RangeError on `readSync(fd, Buffer.alloc(8), {offset: 4})`
        // where the positional one read 4 bytes.
        length = offsetOrOptions.length ?? buffer.byteLength - offset;
        position = offsetOrOptions.position ?? null;
    } else {
        offset = (offsetOrOptions as number | null | undefined) ?? 0;
        length = length ?? buffer.byteLength - offset;
    }
    if (isStdFd(fd)) return readStdFdSync(fd, buffer, offset, length!);
    return getFH(fd, 'read')._readSync(buffer, offset, length!, position ?? null);
}

export function writeSync(
    fd: number,
    buffer: NodeJS.ArrayBufferView,
    offset?: number | null,
    length?: number | null,
    position?: number | null,
): number;
export function writeSync(
    fd: number,
    string: string,
    position?: number | null,
    encoding?: BufferEncoding | null,
): number;
export function writeSync(
    fd: number,
    bufferOrString: NodeJS.ArrayBufferView | string,
    offsetOrPosition?: number | null,
    lengthOrEncoding?: number | string | null,
    position?: number | null,
): number {
    let data: Uint8Array;
    if (typeof bufferOrString === 'string') {
        data = new TextEncoder().encode(bufferOrString);
        if (typeof offsetOrPosition === 'number') position = offsetOrPosition;
    } else {
        const offset = typeof offsetOrPosition === 'number' ? offsetOrPosition : 0;
        const len = typeof lengthOrEncoding === 'number' ? lengthOrEncoding : bufferOrString.byteLength - offset;
        data = new Uint8Array(bufferOrString.buffer as ArrayBuffer, bufferOrString.byteOffset + offset, len);
    }
    if (isStdFd(fd)) return writeStdFdSync(fd, data);
    return getFH(fd, 'write')._writeSync(data, position ?? null);
}

export function readvSync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | null): number {
    let bytesRead = 0;
    for (const buf of buffers) {
        const n = readSync(fd, buf, 0, buf.byteLength, position != null ? position + bytesRead : null);
        bytesRead += n;
        if (n < buf.byteLength) break;
    }
    return bytesRead;
}

export function readv(
    fd: number,
    buffers: NodeJS.ArrayBufferView[],
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void;
export function readv(
    fd: number,
    buffers: NodeJS.ArrayBufferView[],
    position: number | null,
    callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void;
export function readv(
    fd: number,
    buffers: NodeJS.ArrayBufferView[],
    positionOrCb:
        | number
        | null
        | ((err: NodeJS.ErrnoException | null, bytesRead: number, buffers: NodeJS.ArrayBufferView[]) => void),
    callback?: (err: NodeJS.ErrnoException | null, bytesRead: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void {
    const cb = typeof positionOrCb === 'function' ? positionOrCb : requireCallback(callback);
    const position = typeof positionOrCb === 'function' ? null : positionOrCb;
    readvAsync(fd, buffers, position).then(
        (r) => cb(null, r.bytesRead, r.buffers),
        (err) => cb(err as NodeJS.ErrnoException, 0, buffers),
    );
}

export async function readvAsync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | null) {
    return { bytesRead: readvSync(fd, buffers, position), buffers };
}

export function writevSync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | null): number {
    let bytesWritten = 0;
    for (const buf of buffers) {
        const n = writeSync(fd, buf, 0, buf.byteLength, position != null ? position + bytesWritten : null);
        bytesWritten += n;
    }
    return bytesWritten;
}

export function writev(
    fd: number,
    buffers: NodeJS.ArrayBufferView[],
    callback: (err: NodeJS.ErrnoException | null, bytesWritten: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void;
export function writev(
    fd: number,
    buffers: NodeJS.ArrayBufferView[],
    position: number | null,
    callback: (err: NodeJS.ErrnoException | null, bytesWritten: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void;
export function writev(
    fd: number,
    buffers: NodeJS.ArrayBufferView[],
    positionOrCb:
        | number
        | null
        | ((err: NodeJS.ErrnoException | null, bytesWritten: number, buffers: NodeJS.ArrayBufferView[]) => void),
    callback?: (err: NodeJS.ErrnoException | null, bytesWritten: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void {
    const cb = typeof positionOrCb === 'function' ? positionOrCb : requireCallback(callback);
    const position = typeof positionOrCb === 'function' ? null : positionOrCb;
    writevAsync(fd, buffers, position).then(
        (r) => cb(null, r.bytesWritten, r.buffers),
        (err) => cb(err as NodeJS.ErrnoException, 0, buffers),
    );
}

export async function writevAsync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | null) {
    return { bytesWritten: writevSync(fd, buffers, position), buffers };
}

/**
 * The one entry point in `node:fs` whose callback takes `(exists)` rather than
 * `(err, value)`. Three consequences, all measured against node v24.19.0.
 *
 * The answer is DELIVERED, not handed over in place: Node reads it out of
 * `fs.access`'s async completion, so `exists(p, cb)` returns before `cb` runs —
 * the same one-microtask contract `withHandle` documents in `callback.ts`.
 *
 * Delivering it also moves the call OUT of the try below, which is the half
 * that was silently wrong. The call used to sit inside, so a callback that
 * threw was caught and re-entered with `false`: the caller's own exception came
 * back to them as a filesystem answer, and an existing file read as missing.
 * Node lets that throw reach the host. Sibling rule: `fs-semantics.spec.ts`
 * K-19, the same defect in `mkdtemp`.
 *
 * `util.promisify.custom` below is what the `(exists)` shape costs: without it
 * a promisified `exists` reads the lone `true` as an `err` and rejects.
 */
export function exists(path: PathLike, callback: (exists: boolean) => void): void {
    requireCallback(callback);
    let found: boolean;
    try {
        statSync(normalizePath(path));
        found = true;
    } catch {
        // The stat failure IS the answer — Node reports every `access(F_OK)`
        // error as "does not exist". This catch converts, it does not swallow.
        found = false;
    }
    Promise.resolve().then(() => callback(found));
}

// `Symbol.for`, not a fresh symbol: the REGISTERED key is what both `node:util`
// and `@gjsify/util` look up, so one definition serves either runtime.
Object.defineProperty(exists, Symbol.for('nodejs.util.promisify.custom'), {
    value: (path: PathLike): Promise<boolean> => new Promise((resolve) => exists(path, resolve)),
});

export async function openAsBlob(path: PathLike, options?: { type?: string }): Promise<Blob> {
    const data = readFileSync(normalizePath(path)) as unknown as ArrayBuffer;
    return new Blob([data], { type: options?.type ?? '' });
}
