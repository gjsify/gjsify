// Raw file-descriptor I/O — the only module in `@gjsify/fs` that owns an fd.
//
// The whole descriptor is reachable from GI, so nothing here emulates POSIX.
// `GLib.open()` is introspectable and takes a mode, so the KERNEL applies it
// atomically at creation, masked by the live umask, in the same syscall that
// honours `O_EXCL` — which is also why `O_EXCL` refuses a symlink whatever it
// points at, where a `file_test(EXISTS)` pre-check follows the link and reads a
// dangling one as free. `GioUnix.{Input,Output}Stream` do real `read(2)`/`write(2)`
// and the kernel advances the offset; `GLib.IOChannel.unix_new()` is a working
// `lseek(2)` on the same open file description.
//
// WHAT IS NOT REACHABLE
//
//   - `errno`. `GLib.open()` returns `-1` with no `GError`, and GioUnix collapses
//     `EBADF` into `G_IO_ERROR_FAILED` with a LOCALIZED message. Open failures are
//     therefore CLASSIFIED (`classifyOpenFailure`) from state observable after the
//     kernel refused; codes we know deterministically (`EBADF` for wrong-direction
//     I/O) come from our own access mode. NEVER parse a message. Not covered:
//     ENOSPC / EDQUOT / EIO discrimination.
//   - `pread`/`pwrite`/`lseek`-tell. Positional I/O is seek-then-io against one
//     authoritative shadow offset (`file-handle.ts`); `tellFd()` reads the truth
//     from procfs where the kernel moved the offset behind us.
//   - `fstat`/`fchmod`/`ftruncate` on the descriptor. They go through
//     `/proc/self/fd/<fd>`, which is Linux-only; elsewhere they degrade to the path
//     and lose descriptor identity after a rename. Measured, not assumed — see
//     `CAN_PROC_FD` in `capabilities.spec.ts`.

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import GioUnix from '@girs/giounix-2.0';
import { splitPathComponents } from '@gjsify/utils/core';

import { createNodeError } from './errors.js';

import type { OpenSpec } from './posix-flags.js';

/** POSIX errno numbers for the codes this module raises, so `err.errno` is Node's. */
const ERRNO: Record<string, number> = {
    EPERM: -1,
    ENOENT: -2,
    EIO: -5,
    ENXIO: -6,
    EBADF: -9,
    EACCES: -13,
    EEXIST: -17,
    ENOTDIR: -20,
    EISDIR: -21,
    EINVAL: -22,
    ENFILE: -23,
    EMFILE: -24,
    ETXTBSY: -26,
    ENOSPC: -28,
    ESPIPE: -29,
    EROFS: -30,
    ENAMETOOLONG: -36,
    ENOTEMPTY: -39,
    ELOOP: -40,
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
        case 'ELOOP':
            return 'too many symbolic links encountered';
        case 'ENAMETOOLONG':
            return 'name too long';
        case 'EMFILE':
            return 'too many open files';
        case 'ENFILE':
            return 'file table overflow';
        case 'EROFS':
            return 'read-only file system';
        case 'ESPIPE':
            return 'invalid seek';
        case 'ENXIO':
            return 'no such device or address';
        default:
            return 'i/o error';
    }
}

let procFdSupported: boolean | null = null;

/**
 * Can this host name an open descriptor as a path?
 *
 * Lazy, not at module eval: a probe there runs in every consumer that merely
 * imports `node:fs`. Do not assume procfs exists — in `respond-with-file.ts` the
 * path resolved to nothing on macOS, `statSync` threw, and a swallowed catch meant
 * the check silently never ran.
 */
export function hasProcFd(): boolean {
    if (procFdSupported === null) {
        procFdSupported = GLib.file_test('/proc/self/fd', GLib.FileTest.IS_DIR);
    }
    return procFdSupported;
}

/**
 * A path naming the DESCRIPTOR rather than the name it was opened from, or `null`
 * where the host cannot express one. `/proc/self/fd/<fd>` resolves to the inode
 * the fd holds even after the directory entry is gone, which is what lets
 * `fstat`/`fchmod`/`ftruncate` survive a rename or unlink.
 */
export function fdPath(fd: number): string | null {
    return hasProcFd() ? `/proc/self/fd/${fd}` : null;
}

/** `open(2)`. */
export function openFd(path: string, spec: OpenSpec, mode: number): number {
    const fd = GLib.open(path, spec.posix, mode);
    if (fd < 0) throw classifyOpenFailure(path, spec);
    return fd;
}

export function closeFd(fd: number): void {
    GLib.close(fd);
}

/**
 * Name the reason `open(2)` refused, reconstructed from what is observable AFTER
 * the kernel refused. A classification, not a check-then-act: it decides nothing
 * about creating anything, so it carries no TOCTOU. The lookup must be
 * `NOFOLLOW_SYMLINKS` so a dangling symlink reads as "the name is taken".
 */
export function classifyOpenFailure(path: string, spec: OpenSpec): NodeJS.ErrnoException {
    // The kernel's own order, so a path tripping two rules reports the code
    // `open(2)` would. Length first: decided before any lookup, needs no syscall.
    const tooLong = nameTooLong(path, 'open');
    if (tooLong) return tooLong;

    const file = Gio.File.new_for_path(path);
    let existing: Gio.FileInfo | null = null;
    let unanswered = false;
    try {
        // `unix::mode` and `access::*` ride along on the one lookup this
        // function already makes: `refusalNotAboutThePath` needs both to tell
        // "the device has nothing on the other end" from "you may not".
        const info = file.query_info(
            'standard::type,standard::symlink-target,unix::mode,access::can-read,access::can-write',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null,
        );
        if (answered(info)) existing = info;
        else unanswered = true;
    } catch {
        existing = null;
    }

    // "I was not allowed to look" is neither "not there" nor "there" — it is the
    // permission answer, the one `open(2)` gave. Falling into the `existing` branch
    // instead reports EEXIST for a hard EACCES. See {@link answered}.
    if (unanswered) return refusalNotAboutThePath(path, spec, file, null);

    if (existing) {
        // EEXIST is gated on O_EXCL: "file already exists" for what is really a
        // permission error is exactly the silently wrong answer to avoid.
        if (spec.excl) return fsError('EEXIST', 'open', path);

        // The failed open FOLLOWED this symlink unless the caller said otherwise, so
        // the name found here is not the object the kernel refused. ELOOP and
        // ENAMETOOLONG are reachable only from the chain; report them as EACCES and
        // a retry loop keyed on ELOOP takes the give-up branch.
        if (existing.get_file_type() === Gio.FileType.SYMBOLIC_LINK && !spec.nofollow) {
            const chain = walkSymlinkChain(file);
            if (chain === 'loop') return fsError('ELOOP', 'open', path);
            if (chain === 'too-long') return fsError('ENAMETOOLONG', 'open', path);
            // A dangling link reads as "the name is taken" to `lstat` but as
            // "nothing is there" to `open`, which is why `O_CREAT` creates the
            // TARGET through it while a plain read reports ENOENT.
            if (chain === 'dangling' && !spec.creat) return fsError('ENOENT', 'open', path);
        }

        if (existing.get_file_type() === Gio.FileType.DIRECTORY && spec.writable) {
            return fsError('EISDIR', 'open', path);
        }

        // `O_DIRECTORY` means "a directory or nothing", and `open(2)` answers ENOTDIR
        // for anything else. Not consulting the flag leaves the refusal as the
        // permission answer, which tells a caller to stop rather than look elsewhere.
        if (spec.directory && existing.get_file_type() !== Gio.FileType.DIRECTORY) {
            return fsError('ENOTDIR', 'open', path);
        }

        return refusalNotAboutThePath(path, spec, file, existing);
    }

    // BEFORE the ENOENT below, and NOT gated on `O_CREAT`: `open(2)` decides ENOTDIR
    // first, because a prefix component that exists and is not a directory ends the
    // walk whatever the caller asked for. Gate it and `openSync('file/child','r')`
    // answers ENOENT — "try the next candidate" — where `'w'`, `readFileSync`,
    // `accessSync` and `statSync` on the same name all answer ENOTDIR, so a config
    // loader walking candidates silently skips the misconfiguration.
    const notDir = ancestorIsNotADirectory(file);
    if (notDir) return fsError('ENOTDIR', 'open', path);

    if (!spec.creat) return fsError('ENOENT', 'open', path);

    const parent = file.get_parent();
    if (!parent) return fsError('ENOENT', 'open', path);
    try {
        parent.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return fsError('ENOENT', 'open', path);
    }
    return refusalNotAboutThePath(path, spec, file, null);
}

/**
 * Does an existing ancestor of `path` block the walk by not being a directory?
 *
 * The immediate parent is not enough: for `<file>/a/b.json` the parent `<file>/a`
 * cannot be looked up AT ALL, so the first ancestor that ANSWERS decides. Climbing
 * until one does is the order `open(2)` resolves the name in, and it stops at the
 * first answer, so the ordinary case costs one lookup.
 */
function ancestorIsNotADirectory(file: Gio.File): boolean {
    for (let parent = file.get_parent(); parent; parent = parent.get_parent()) {
        let info: Gio.FileInfo;
        try {
            info = parent.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            // This component does not exist either — keep climbing.
            continue;
        }
        // No answer is not evidence of a non-directory; the permission branch above
        // owns that case. See {@link answered}.
        if (!answered(info)) return false;
        return info.get_file_type() !== Gio.FileType.DIRECTORY;
    }
    return false;
}

/**
 * Does this `GFileInfo` actually ANSWER, or is it an empty shell?
 *
 * `g_file_query_info()` does NOT fail when the kernel refuses to stat a name. A
 * path under a directory the process cannot search returns a non-NULL `GFileInfo`
 * with NO attributes at all — measured: `list_attributes(null)` is `[]` and
 * `has_attribute('standard::type')` is `false`, where an ordinary lookup gives
 * `['standard::type']`. Every attribute read in this module is therefore gated on
 * this, and `false` means "no answer", NEVER "no".
 *
 * Both ways of skipping the gate are live hazards:
 *   - reading the type off the shell logs `GFileInfo created without
 *     standard::type` and `g_file_info_get_file_type: should not be reached`, two
 *     `GLib-GIO-CRITICAL`s that `G_DEBUG=fatal-criticals` (standard in GNOME CI)
 *     turns into a SIGABRT before the caller's `catch` can run;
 *   - taking the shell as proof the name EXISTS answers EEXIST for a plain
 *     permission denial, so an `openSync(lock,'wx')` retry loop spins forever and
 *     the ubiquitous `catch (e) { if (e.code !== 'EEXIST') throw }` around
 *     `mkdirSync` swallows a hard EACCES.
 *
 * Exported because the stat family needs the identical gate; without it `statSync`
 * hits both hazards at once and returns a fabricated `{mode: 0, size: 0, ino: 0}`
 * as fact where Node raises EACCES. `statsFrom()` in `stats.ts` owns that decision.
 */
export function answered(info: Gio.FileInfo | null): boolean {
    return info !== null && info.has_attribute('standard::type');
}

/**
 * `NAME_MAX` / `PATH_MAX`, counted in BYTES — the limits are on the encoded name, not on
 * code points.
 *
 * Components come from `@gjsify/utils/core`, which splits on the separators the path
 * actually uses: `split('/')` yielded ONE component for `C:\a\b`, so a win32 path was
 * length-checked as a whole and every per-name limit went unenforced (#1143).
 */
function nameTooLong(path: string, syscall: string): NodeJS.ErrnoException | null {
    const encoder = new TextEncoder();
    if (encoder.encode(path).length > 4096) return fsError('ENAMETOOLONG', syscall, path);
    for (const component of splitPathComponents(path)) {
        if (encoder.encode(component).length > 255) return fsError('ENAMETOOLONG', syscall, path);
    }
    return null;
}

/**
 * Follow a symlink chain the way `open(2)` would, and name how it ends.
 *
 * `SYMLOOP_MAX` is 40 on Linux and the kernel reports ELOOP at that depth whether
 * or not the links form a real cycle, so counting hops is the faithful test — and
 * it terminates on a self-referential pair without remembering where it has been.
 */
function walkSymlinkChain(start: Gio.File): 'loop' | 'dangling' | 'too-long' | 'resolved' {
    const encoder = new TextEncoder();
    let current = start;
    for (let hop = 0; hop < 40; hop++) {
        let info: Gio.FileInfo;
        try {
            info = current.query_info(
                'standard::type,standard::symlink-target',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                null,
            );
        } catch {
            return 'dangling';
        }
        // No answer ends the walk: the kernel would not describe this hop, so it is
        // neither a loop nor dangling, and reading the type off the empty info is the
        // CRITICAL {@link answered} documents. The caller then reaches the permission
        // answer, which is the one `open(2)` gave.
        if (!answered(info)) return 'resolved';
        if (info.get_file_type() !== Gio.FileType.SYMBOLIC_LINK) return 'resolved';
        const target = info.get_symlink_target();
        if (!target) return 'dangling';
        if (encoder.encode(target).length > 4096) return 'too-long';
        const parent = current.get_parent();
        current = target.startsWith('/')
            ? Gio.File.new_for_path(target)
            : (parent?.resolve_relative_path(target) ?? Gio.File.new_for_path(target));
    }
    return 'loop';
}

/**
 * The refusals that are not about this path at all: everything above reads the
 * NAME, these read the process and the mount. Collapsing them into a bare `EACCES`
 * costs the most on EMFILE — the one code a caller is expected to back off and
 * retry on, where "permission denied" tells it to give up.
 */
function refusalNotAboutThePath(
    path: string,
    spec: OpenSpec,
    file: Gio.File,
    existing: Gio.FileInfo | null,
): NodeJS.ErrnoException {
    // A descriptor that cannot be refused for any reason of its own: if even this
    // fails, the table is full and the caller's path was never the problem.
    const probe = GLib.open('/dev/null', 0, 0);
    if (probe < 0) return fsError('EMFILE', 'open', path);
    GLib.close(probe);

    // The FILE's own mode must be checked BEFORE the MOUNT's claim. A mode with no
    // write bit for anyone explains the refusal by itself and no filesystem fact can
    // make that EROFS, while the reverse does hold: 0o644 on a read-only mount is a
    // genuine EROFS. Measured: GitHub's macOS runners report
    // `filesystem::readonly == true` for a volume they then happily write to (macOS
    // synthesizes a read-only system root), so the mount branch first answers EROFS
    // for a plain chmod-0444 EACCES — on the darwin leg only, invisible from Linux.
    const deniedByMode = existing !== null && (existing.get_attribute_uint32('unix::mode') & 0o222) === 0;

    if ((spec.writable || spec.creat) && !deniedByMode) {
        try {
            const fsInfo = file.query_filesystem_info('filesystem::readonly', null);
            if (fsInfo.get_attribute_boolean('filesystem::readonly')) return fsError('EROFS', 'open', path);
        } catch {
            // A mount that will not describe itself is not evidence of anything.
        }
    }

    if (existing && nothingOnTheOtherEnd(spec, existing)) return fsError('ENXIO', 'open', path);

    return fsError('EACCES', 'open', path);
}

/**
 * Is this "the device exists but nothing is on the other end" (ENXIO) rather than
 * "you may not" (EACCES)? Both arrive as the same bare `-1` and tell a caller
 * opposite things: a writer that retries on ENXIO until a reader attaches gives up
 * permanently on "permission denied". Two ordinary paths reach it —
 * `open('/dev/tty')` with no controlling terminal, and a FIFO opened
 * `O_WRONLY | O_NONBLOCK` with no reader (both ENXIO, errno -6, on Node v24.15.0).
 *
 * The discriminator is `access(2)` via GIO's `access::can-*`: if the kernel grants
 * what the caller asked for and the open STILL failed, permission was not the
 * obstruction. Narrowed to devices and FIFOs on purpose, the only objects
 * `open(2)` raises ENXIO for — an ordinary file keeps EACCES regardless.
 */
function nothingOnTheOtherEnd(spec: OpenSpec, existing: Gio.FileInfo): boolean {
    if (!existing.has_attribute('unix::mode')) return false;
    const format = existing.get_attribute_uint32('unix::mode') & 0o170000;
    const isDeviceOrFifo =
        format === 0o020000 /* S_IFCHR */ || format === 0o060000 /* S_IFBLK */ || format === 0o010000; /* S_IFIFO */
    if (!isDeviceOrFifo) return false;

    const permits = (attribute: string) =>
        existing.has_attribute(attribute) && existing.get_attribute_boolean(attribute);
    if (spec.readable && !permits('access::can-read')) return false;
    if (spec.writable && !permits('access::can-write')) return false;
    return true;
}

/** The same reconstruction for `mkdir(2)`, which also returns a bare `-1`. */
export function classifyMkdirFailure(path: string): NodeJS.ErrnoException {
    // Same order as `classifyOpenFailure`: the kernel rejects an over-long name
    // before it looks anything up. Omit this and `mkdirSync(<500-char name>)` reports
    // "permission denied" for a length the open side names correctly.
    const tooLong = nameTooLong(path, 'mkdir');
    if (tooLong) return tooLong;

    const file = Gio.File.new_for_path(path);
    try {
        const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (answered(info)) return fsError('EEXIST', 'mkdir', path);
        // No answer means the search bit on some parent, not a taken name — see
        // {@link answered}. EEXIST here is what makes the ubiquitous
        // `catch (e) { if (e.code !== 'EEXIST') throw }` swallow a permission denial.
        return fsError('EACCES', 'mkdir', path);
    } catch {
        // Not there — so the obstruction is above it.
    }

    const parent = file.get_parent();
    if (!parent) return fsError('ENOENT', 'mkdir', path);
    try {
        const parentInfo = parent.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (answered(parentInfo) && parentInfo.get_file_type() !== Gio.FileType.DIRECTORY) {
            return fsError('ENOTDIR', 'mkdir', path);
        }
    } catch {
        return fsError('ENOENT', 'mkdir', path);
    }
    return fsError('EACCES', 'mkdir', path);
}

/**
 * Per-fd seek handles.
 *
 * `GioUnix` streams are NOT `Gio.Seekable` and `GLib.lseek` is not introspected, so
 * the only route to `lseek(2)` from GJS is an `IOChannel` over the same descriptor.
 * Its three settings are an invariant, not a preference, because each failure is
 * silent: an encoding makes GLib transcode the bytes, buffering makes the channel
 * hold writes the GioUnix streams know nothing about, and `close_on_unref` hands
 * our fd to the garbage collector.
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

const seekableFds = new Map<number, boolean>();

/**
 * Can this descriptor be positioned at all?
 *
 * Seeking unconditionally before every read and write emits one
 * `g_io_channel_seek_position: assertion 'channel->is_seekable' failed` per I/O
 * call on a FIFO / pipe / socket / tty — a `GLib-CRITICAL`, which
 * `G_DEBUG=fatal-criticals` (standard in GNOME CI) turns into an abort. The bytes
 * survive, because a pipe ignores the offset, so `_pos` silently accumulates a
 * number that means nothing.
 *
 * The answer must therefore be ASKED FOR, not discovered by tripping the
 * assertion, and it takes TWO tests in this order:
 *
 * 1. The file TYPE, refusing ONLY `S_IFIFO` and `S_IFSOCK` — the two whose channel
 *    is not `is_seekable`, so asking them at all is the CRITICAL above. The
 *    tempting "seekable means `S_IFREG` or `S_IFBLK`" is WRONG: a character device
 *    usually seeks fine (`noop_llseek`) and Node does positional I/O on
 *    `/dev/null`, `/dev/zero` and `/dev/urandom` (measured, v24.15.0), so
 *    refusing those raises an ESPIPE Node never raises.
 * 2. The DESCRIPTOR itself, via the same `lseek(fd, 0, SEEK_CUR)` `GIOChannel` uses
 *    internally — a pure query that moves nothing. Needed because a TTY is
 *    `S_IFCHR` exactly like `/dev/zero` but has `no_llseek`. Measured under gjs
 *    1.88.1: `G_IO_STATUS_NORMAL` on a regular file, `/dev/zero` and `/dev/null`;
 *    a clean `GLib.IOChannelError` ("Illegal seek") on a pty slave, with no
 *    CRITICAL, because that channel IS `is_seekable` and the kernel refuses.
 *
 * Skipping test 2 makes writing to a terminal by path impossible: the seek throws
 * a RAW `Gio.IOErrorEnum` — numeric `code`, `instanceof Error === false` — out of
 * `writeFileSync`/`writeSync`/`createWriteStream`, invisible to
 * `catch (e) { if (e.code === 'ESPIPE') }`.
 *
 * The process's own stdin/stdout/stderr never arrive here; `isStdFd()` takes them
 * first. Cached per fd — the type behind an open file description cannot change —
 * and dropped by {@link releaseFd} so a recycled fd number inherits nothing.
 */
export function isSeekableFd(fd: number, fallbackPath: string): boolean {
    let known = seekableFds.get(fd);
    if (known === undefined) {
        known = probeSeekable(fd, fallbackPath);
        seekableFds.set(fd, known);
    }
    return known;
}

function probeSeekable(fd: number, fallbackPath: string): boolean {
    try {
        const info = Gio.File.new_for_path(fdPath(fd) ?? fallbackPath).query_info(
            'unix::mode',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
        if (info.has_attribute('unix::mode')) {
            const format = info.get_attribute_uint32('unix::mode') & 0o170000;
            // The two the CHANNEL refuses to be asked about at all.
            if (format === 0o010000 /* S_IFIFO */ || format === 0o140000 /* S_IFSOCK */) return false;
        }
    } catch {
        // No answer is not "no" — ask the descriptor, which answers about the object
        // rather than about a name.
    }

    try {
        seekHandle(fd).seek_position(0, GLib.SeekType.CUR);
        return true;
    } catch {
        // A failing `lseek(fd, 0, SEEK_CUR)` IS the definition of non-seekable, and
        // the only one available: `GIOChannel.is_seekable` is not introspectable.
        return false;
    }
}

/** Absolute `lseek(2)`. Only valid on a descriptor {@link isSeekableFd} accepts. */
export function seekFd(fd: number, position: number): void {
    seekHandle(fd).seek_position(position, GLib.SeekType.SET);
}

/**
 * The descriptor's true offset, or `null` where the host cannot report it.
 *
 * Only needed where the KERNEL moved the offset behind us: an `O_APPEND` write jumps
 * to EOF silently, and computing the new position from the pre-write value drifts.
 * `seek_position()` cannot answer this — it returns a `GIOStatus`, not an offset.
 */
export function tellFd(fd: number): number | null {
    if (!hasProcFd()) return null;
    try {
        const [ok, data] = GLib.file_get_contents(`/proc/self/fdinfo/${fd}`);
        if (!ok) return null;
        const match = /^pos:\s*(\d+)/m.exec(new TextDecoder().decode(data));
        return match ? Number(match[1]) : null;
    } catch {
        // An unreadable procfs means "no answer"; the caller has a documented fallback.
        return null;
    }
}

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
 * Release the cached per-fd views. They must go before the descriptor does: a
 * GioUnix stream outliving its fd answers later calls against whatever the OS
 * handed that number to next.
 */
export function releaseFd(fd: number): void {
    const out = outputStreams.get(fd);
    if (out) {
        try {
            out.flush(null);
        } catch {
            // The caller's close() reports a teardown flush failure; the cache entry
            // must be dropped regardless, or the next fd with this number inherits it.
        }
    }
    seekHandles.delete(fd);
    inputStreams.delete(fd);
    outputStreams.delete(fd);
    seekableFds.delete(fd);
}

/** The size of the file behind `fd`, via the descriptor where the host allows. */
export function sizeOfFd(fd: number, fallbackPath: string): number {
    const target = fdPath(fd) ?? fallbackPath;
    const info = Gio.File.new_for_path(target).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
    return Number(info.get_size());
}

/**
 * `ftruncate(2)`, as closely as GJS can express it.
 *
 * The access-mode check `ftruncate(2)` performs — descriptor open for writing, mode
 * never consulted — is bookkeeping we already hold, so it lives in `FileHandle`
 * beside the identical gates in `_readCore`/`_writeCore`, NOT here. Without it a
 * handle opened `'r'` destroys the file, because the re-open below asks the kernel
 * for fresh permission and gets it.
 *
 * A re-open is unavoidable: there is no `g_ftruncate` and no route from an fd to a
 * `GSeekable` — `GioUnix.OutputStream` does not implement it, and
 * `GBufferedOutputStream` / `GDataOutputStream` around one both report
 * `can_truncate() == false` (measured, gjs 1.88.1). It goes by the descriptor's
 * procfs name so it lands on the right inode after a rename or unlink, and being a
 * second open it IS checked against the file's mode.
 *
 * Hence the least privilege that can truncate: `append_to()` is `O_WRONLY`,
 * `open_readwrite()` is `O_RDWR`. Not an optimisation — on a write-only file, mode
 * 0o200 truncates through the first and is refused by the second (measured). Still
 * unreachable: a mode denying its own owner write (0o444, 0o400, 0o000), which Node
 * truncates through the descriptor. That failure must at least be REPORTED as an
 * ErrnoException — raw it escapes as a `Gio.IOErrorEnum` with a numeric `code` and
 * `instanceof Error === false`, invisible to `catch (e) { if (e.code === 'EACCES') }`.
 */
export function truncateFd(fd: number, length: number, fallbackPath: string): void {
    const file = Gio.File.new_for_path(fdPath(fd) ?? fallbackPath);
    let refusal: unknown;

    try {
        const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        try {
            stream.truncate(length, null);
        } finally {
            stream.close(null);
        }
        return;
    } catch (err: unknown) {
        refusal = err;
    }

    try {
        const stream = file.open_readwrite(null);
        try {
            (stream.get_output_stream() as Gio.FileOutputStream).truncate(length, null);
        } finally {
            stream.close(null);
        }
        return;
    } catch {
        // Report the FIRST refusal: the O_WRONLY attempt is the one whose
        // requirements match `ftruncate(2)`, so its error describes the real
        // obstruction. The O_RDWR retry exists only to cover filesystems that
        // refuse `append_to` for reasons of their own.
    }

    throw createNodeError(refusal, 'ftruncate', fallbackPath);
}
