// Raw file-descriptor I/O — the only module in `@gjsify/fs` that owns an fd.
//
// WHY THIS EXISTS
//
// `@gjsify/fs` never had a file descriptor. It had a `GLib.IOChannel` whose fd
// it read once for a number, and then did all real I/O by RE-OPENING THE PATH.
// Every defect this redesign closes follows mechanically from that:
//
//   - no kernel cursor to inherit, so a JS cursor had to be invented — and four
//     of them appeared, disagreeing with each other;
//   - no `open(2)` to hand a mode to, so `mode` had to be emulated with a
//     post-create `chmod`, which needed a umask to be correct, which needed a
//     probe, a cache and a "probe failed" fallback — and each of those grew its
//     own defects (a probe blind to the execute bits, a cached `umask 0`, a
//     chmod that stripped INHERITED setgid, a chmod by path that could land on
//     a different inode);
//   - no `O_EXCL`, so exclusivity had to be emulated with `file_test(EXISTS)`,
//     which FOLLOWS SYMLINKS — a dangling link read as "free", so `wx` created
//     and wrote THROUGH it.
//
// The fd is reachable. `GLib.open()` is introspectable and takes a mode, so the
// KERNEL applies it, atomically, masked by the live umask, at creation, in the
// same syscall that honours `O_EXCL`. `GioUnix.{Input,Output}Stream` do real
// `read(2)`/`write(2)` on that fd and the kernel advances the offset.
// `GLib.IOChannel.unix_new()` is a working `lseek(2)` on the same open file
// description. So the emulation is not improved here — it is DELETED, and with
// it every defect that lived in it.
//
// WHAT IS NOT REACHABLE, STATED PLAINLY
//
//   - `errno`. `GLib.open()` returns `-1` with no `GError`, and GioUnix
//     collapses `EBADF` into `G_IO_ERROR_FAILED` with a LOCALIZED message.
//     Open failures are therefore CLASSIFIED (see `classifyOpenFailure`) from
//     state we can observe after the kernel has already refused; per-operation
//     codes we know deterministically (`EBADF` for wrong-direction I/O) are
//     raised from our own access mode instead of read from the OS. Never parse
//     a message. Not covered: ENOSPC / EDQUOT / EIO discrimination.
//   - `pread`/`pwrite`/`lseek`-tell. Positional I/O is seek-then-io against a
//     single authoritative shadow offset (see `file-handle.ts`); `tellFd()`
//     reads the truth from procfs where the kernel moved the offset behind us.
//   - `fstat`/`fchmod`/`ftruncate` on the descriptor. These go through
//     `/proc/self/fd/<fd>`, which is Linux-only; elsewhere they degrade to the
//     path and lose descriptor identity after a rename. Measured, not assumed —
//     see `CAN_PROC_FD` in `capabilities.spec.ts`.

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import GioUnix from '@girs/giounix-2.0';

import type { OpenSpec } from './posix-flags.js';

/** POSIX errno numbers for the codes this module raises, so `err.errno` is Node's. */
const ERRNO: Record<string, number> = {
    EPERM: -1,
    ENOENT: -2,
    EBADF: -9,
    EACCES: -13,
    EEXIST: -17,
    ENOTDIR: -20,
    EISDIR: -21,
    EINVAL: -22,
    ENOSPC: -28,
    EROFS: -30,
    ENOTEMPTY: -39,
    EIO: -5,
};

type ErrnoExceptionWithDest = NodeJS.ErrnoException & { dest?: string };

/** Build a Node `ErrnoException` from a code we determined ourselves. */
export function fsError(code: string, syscall: string, path?: string, dest?: string): NodeJS.ErrnoException {
    let message = `${code}: ${describe(code)}, ${syscall}`;
    if (path) message += ` '${path}'`;
    if (dest) message += ` -> '${dest}'`;
    const err = new Error(message) as NodeJS.ErrnoException;
    err.code = code;
    err.errno = ERRNO[code] ?? -1;
    err.syscall = syscall;
    if (path) err.path = path;
    // `dest` is on Node's error object but not on the @types/node interface.
    if (dest) (err as ErrnoExceptionWithDest).dest = dest;
    return err;
}

function describe(code: string): string {
    switch (code) {
        case 'ENOENT':
            return 'no such file or directory';
        case 'EEXIST':
            return 'file already exists';
        case 'EACCES':
            return 'permission denied';
        case 'EISDIR':
            return 'illegal operation on a directory';
        case 'ENOTDIR':
            return 'not a directory';
        case 'EBADF':
            return 'bad file descriptor';
        case 'EPERM':
            return 'operation not permitted';
        case 'EINVAL':
            return 'invalid argument';
        default:
            return 'i/o error';
    }
}

// ─── procfs ──────────────────────────────────────────────────────────────────

let procFdSupported: boolean | null = null;

/**
 * Can this host name an open descriptor as a path?
 *
 * Measured once, and only ONCE it is needed — a module-eval probe would run in
 * every consumer that merely imports `node:fs`. `respond-with-file.ts` carries
 * the scar of assuming procfs exists: the path resolved to nothing on macOS,
 * `statSync` threw, and a swallowed catch meant the check silently never ran.
 */
export function hasProcFd(): boolean {
    if (procFdSupported === null) {
        procFdSupported = GLib.file_test('/proc/self/fd', GLib.FileTest.IS_DIR);
    }
    return procFdSupported;
}

/**
 * A path that names the DESCRIPTOR rather than the name it was opened from,
 * or `null` where the host cannot express one.
 *
 * This is what makes `fstat`/`fchmod`/`ftruncate` survive a rename or an
 * unlink: `/proc/self/fd/<fd>` resolves to the inode the fd holds, even after
 * the directory entry is gone.
 */
export function fdPath(fd: number): string | null {
    return hasProcFd() ? `/proc/self/fd/${fd}` : null;
}

// ─── open / close ────────────────────────────────────────────────────────────

/**
 * `open(2)`.
 *
 * The mode reaches the kernel, so it is applied ATOMICALLY at creation, masked
 * by the live umask, and it survives a crash — none of which a post-create or
 * close-time `chmod` can offer. `O_EXCL` is likewise the kernel's, so it is
 * atomic and it refuses a symlink whatever the link points at.
 */
export function openFd(path: string, spec: OpenSpec, mode: number): number {
    const fd = GLib.open(path, spec.posix, mode);
    if (fd < 0) throw classifyOpenFailure(path, spec);
    return fd;
}

export function closeFd(fd: number): void {
    GLib.close(fd);
}

/**
 * Name the reason `open(2)` refused.
 *
 * GJS cannot read `errno`, so the code is reconstructed from what is observable
 * AFTER the kernel has already refused. That makes this a classification, not a
 * check-then-act: it never decides whether to create anything, so it carries no
 * TOCTOU. The `lstat`-equivalent lookup (`NOFOLLOW_SYMLINKS`) matters — a
 * dangling symlink must read as "the name is taken", which is exactly why
 * `file_test(EXISTS)` was the wrong instrument for the check this replaces.
 */
export function classifyOpenFailure(path: string, spec: OpenSpec): NodeJS.ErrnoException {
    const file = Gio.File.new_for_path(path);
    let existing: Gio.FileInfo | null = null;
    try {
        existing = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch {
        existing = null;
    }

    if (existing) {
        // EEXIST is gated on O_EXCL. Reporting "file already exists" for what
        // is really a permission error would be a silently wrong answer from
        // the mechanism added to remove silently wrong answers.
        if (spec.excl) return fsError('EEXIST', 'open', path);
        if (existing.get_file_type() === Gio.FileType.DIRECTORY && spec.writable) {
            return fsError('EISDIR', 'open', path);
        }
        return fsError('EACCES', 'open', path);
    }

    if (!spec.creat) return fsError('ENOENT', 'open', path);

    const parent = file.get_parent();
    if (!parent) return fsError('ENOENT', 'open', path);
    try {
        const parentInfo = parent.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (parentInfo.get_file_type() !== Gio.FileType.DIRECTORY) return fsError('ENOTDIR', 'open', path);
    } catch {
        return fsError('ENOENT', 'open', path);
    }
    return fsError('EACCES', 'open', path);
}

/** The same reconstruction for `mkdir(2)`, which also returns a bare `-1`. */
export function classifyMkdirFailure(path: string): NodeJS.ErrnoException {
    const file = Gio.File.new_for_path(path);
    try {
        file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        return fsError('EEXIST', 'mkdir', path);
    } catch {
        // Not there — so the obstruction is above it.
    }

    const parent = file.get_parent();
    if (!parent) return fsError('ENOENT', 'mkdir', path);
    try {
        const parentInfo = parent.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (parentInfo.get_file_type() !== Gio.FileType.DIRECTORY) return fsError('ENOTDIR', 'mkdir', path);
    } catch {
        return fsError('ENOENT', 'mkdir', path);
    }
    return fsError('EACCES', 'mkdir', path);
}

// ─── seek / tell ─────────────────────────────────────────────────────────────

/**
 * Per-fd seek handles.
 *
 * `GioUnix` streams are NOT `Gio.Seekable` and `GLib.lseek` is not
 * introspected, so the only route to `lseek(2)` from GJS is an `IOChannel`
 * wrapped around the same descriptor. Its three settings are an invariant, not
 * a preference, and they live in exactly one place because getting any of them
 * wrong is silent: an encoding makes GLib transcode the bytes, buffering makes
 * the channel hold writes the GioUnix streams know nothing about, and
 * `close_on_unref` hands our fd to the garbage collector.
 */
const seekHandles = new Map<number, GLib.IOChannel>();
const inputStreams = new Map<number, GioUnix.InputStream>();
const outputStreams = new Map<number, GioUnix.OutputStream>();

function seekHandle(fd: number): GLib.IOChannel {
    let channel = seekHandles.get(fd);
    if (!channel) {
        channel = GLib.IOChannel.unix_new(fd);
        channel.set_encoding(null as unknown as string);
        channel.set_buffered(false);
        channel.set_close_on_unref(false);
        seekHandles.set(fd, channel);
    }
    return channel;
}

function input(fd: number): GioUnix.InputStream {
    let stream = inputStreams.get(fd);
    if (!stream) {
        // `close_fd: false` — the descriptor belongs to the FileHandle, and a
        // stream that closed it would strand every other view of the same fd.
        stream = GioUnix.InputStream.new(fd, false);
        inputStreams.set(fd, stream);
    }
    return stream;
}

function output(fd: number): GioUnix.OutputStream {
    let stream = outputStreams.get(fd);
    if (!stream) {
        stream = GioUnix.OutputStream.new(fd, false);
        outputStreams.set(fd, stream);
    }
    return stream;
}

/** Absolute `lseek(2)`. */
export function seekFd(fd: number, position: number): void {
    seekHandle(fd).seek_position(position, GLib.SeekType.SET);
}

/**
 * The descriptor's true offset, or `null` where the host cannot report it.
 *
 * Only needed where the KERNEL moved the offset behind us — an `O_APPEND`
 * write jumps to EOF without telling anyone, and computing the new position
 * from the pre-write value is how the previous attempt let the cursor drift
 * away from the file after the first append. `seek_position()` cannot answer
 * this: it returns a `GIOStatus`, not an offset.
 */
export function tellFd(fd: number): number | null {
    if (!hasProcFd()) return null;
    try {
        const [ok, data] = GLib.file_get_contents(`/proc/self/fdinfo/${fd}`);
        if (!ok) return null;
        const match = /^pos:\s*(\d+)/m.exec(new TextDecoder().decode(data));
        return match ? Number(match[1]) : null;
    } catch {
        // procfs is readable or it is not; an unreadable one means "no answer",
        // and the caller has a documented fallback. Nothing is dropped here.
        return null;
    }
}

// ─── read / write ────────────────────────────────────────────────────────────

/** `read(2)` at the descriptor's current offset. The kernel advances it. */
export function readFd(fd: number, length: number): Uint8Array {
    if (length <= 0) return new Uint8Array(0);
    const bytes = input(fd).read_bytes(length, null);
    return bytes.get_data() ?? new Uint8Array(0);
}

/** `write(2)` at the descriptor's current offset. The kernel advances it. */
export function writeFd(fd: number, data: Uint8Array): number {
    if (data.length === 0) return 0;
    const [, written] = output(fd).write_all(data, null);
    return written;
}

export function fsyncFd(fd: number): void {
    output(fd).flush(null);
    GLib.fsync(fd);
}

/**
 * Release the cached per-fd views.
 *
 * The streams must go before the descriptor does: a GioUnix stream outliving
 * its fd would answer a later call against whatever the OS handed that number
 * to next.
 */
export function releaseFd(fd: number): void {
    const out = outputStreams.get(fd);
    if (out) {
        try {
            out.flush(null);
        } catch {
            // A flush failure on teardown is reported by the caller's close();
            // dropping the cache entry must still happen or the next fd with
            // this number inherits a stale stream.
        }
    }
    seekHandles.delete(fd);
    inputStreams.delete(fd);
    outputStreams.delete(fd);
}

// ─── descriptor metadata ─────────────────────────────────────────────────────

/** The size of the file behind `fd`, via the descriptor where the host allows. */
export function sizeOfFd(fd: number, fallbackPath: string): number {
    const target = fdPath(fd) ?? fallbackPath;
    const info = Gio.File.new_for_path(target).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
    return Number(info.get_size());
}

/**
 * `ftruncate(2)`.
 *
 * There is no `g_ftruncate`, so this re-opens the descriptor by its procfs
 * name — inode-correct, but a second `open(2)`, which means it is the one
 * operation in this module that a mode without owner-write can still refuse.
 * The path fallback off Linux additionally loses descriptor identity. Both are
 * narrow and both are named rather than hidden.
 */
export function truncateFd(fd: number, length: number, fallbackPath: string): void {
    const target = fdPath(fd) ?? fallbackPath;
    const stream = Gio.File.new_for_path(target).open_readwrite(null);
    try {
        (stream.get_output_stream() as Gio.FileOutputStream).truncate(length, null);
    } finally {
        stream.close(null);
    }
}
