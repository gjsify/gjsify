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
    // The kernel's own order, so a path that trips two rules reports the code
    // `open(2)` would. Length goes first: it is decided before any lookup
    // happens, and it needs no syscall at all.
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

    // "I was not allowed to look" is neither "it is not there" nor "it is
    // there" — it is the permission answer, which is the one `open(2)` gave.
    // See {@link answered}: this used to fall into the `existing` branch below
    // and report EEXIST for a hard EACCES.
    if (unanswered) return refusalNotAboutThePath(path, spec, file, null);

    if (existing) {
        // EEXIST is gated on O_EXCL. Reporting "file already exists" for what
        // is really a permission error would be a silently wrong answer from
        // the mechanism added to remove silently wrong answers.
        if (spec.excl) return fsError('EEXIST', 'open', path);

        // The open that just failed FOLLOWED this symlink (unless the caller
        // asked it not to), so the name found here is not the object the kernel
        // refused. Two of `open(2)`'s codes are reachable only from the chain,
        // and both used to arrive as EACCES — which is what sent a retry loop
        // keyed on ELOOP down the give-up branch instead.
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

        // `O_DIRECTORY` is the caller saying "a directory or nothing", and
        // `open(2)` answers ENOTDIR when it is anything else. The flag was
        // parsed and then never consulted, so the refusal fell through to the
        // permission answer — the one code that tells a caller to stop rather
        // than to look elsewhere.
        if (spec.directory && existing.get_file_type() !== Gio.FileType.DIRECTORY) {
            return fsError('ENOTDIR', 'open', path);
        }

        return refusalNotAboutThePath(path, spec, file, existing);
    }

    // BEFORE the ENOENT below, because `open(2)` decides it before it decides
    // ENOENT: a prefix component that exists and is not a directory ends the
    // path walk whatever the caller asked for. Gating this on `O_CREAT` — the
    // shape this replaces — made `openSync(file/child, 'r')` answer ENOENT
    // ("not there, try the next candidate") for a base path that is a FILE,
    // while `openSync(file/child, 'w')`, `readFileSync`, `accessSync` and
    // `statSync` on the very same name all answered ENOTDIR. A config loader
    // walking candidate paths silently skipped the misconfiguration.
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
 * The immediate parent is not enough: for `<file>/a/b.json` the parent
 * `<file>/a` cannot be looked up AT ALL — the lookup dies one level higher —
 * so the first ancestor that answers is the one that decides. Walking up until
 * something answers is exactly the order `open(2)` resolves the name in, and it
 * stops at the first answer, so it costs one lookup in the ordinary case.
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
        // No answer (see {@link answered}) is not evidence of a non-directory;
        // the permission branch above already owns that case.
        if (!answered(info)) return false;
        return info.get_file_type() !== Gio.FileType.DIRECTORY;
    }
    return false;
}

/**
 * Does this `GFileInfo` actually ANSWER, or is it an empty shell?
 *
 * `g_file_query_info()` does NOT fail when the kernel refuses to stat a name.
 * A path under a directory the process cannot search comes back as a non-NULL
 * `GFileInfo` carrying NO attributes at all — measured directly:
 * `list_attributes(null)` is `[]` and `has_attribute('standard::type')` is
 * `false`, where an ordinary lookup returns `['standard::type']`.
 *
 * Two things follow, and this package got both wrong. Reading the type off
 * that shell logs `GFileInfo created without standard::type` plus
 * `g_file_info_get_file_type: should not be reached` — two `GLib-GIO-CRITICAL`
 * lines that `G_DEBUG=fatal-criticals` (standard in GNOME CI, and the exact
 * condition {@link isSeekableFd} below exists to satisfy) turns into a
 * SIGABRT before the caller's `catch` can run. And taking the shell as proof
 * the name EXISTS answered EEXIST — "the name is taken" — for a plain
 * permission denial, which sends an `openSync(lock,'wx')` retry loop round
 * forever and makes the ubiquitous
 * `try { mkdirSync(d) } catch (e) { if (e.code !== 'EEXIST') throw }`
 * swallow a hard EACCES and carry on as if the directory were there.
 *
 * So every read of an attribute in this module is gated on this, and a
 * `false` means "no answer" — never "no".
 */
function answered(info: Gio.FileInfo | null): boolean {
    return info !== null && info.has_attribute('standard::type');
}

/** `NAME_MAX` / `PATH_MAX`, counted in BYTES — the limits are on the encoded name, not on code points. */
function nameTooLong(path: string, syscall: string): NodeJS.ErrnoException | null {
    const encoder = new TextEncoder();
    if (encoder.encode(path).length > 4096) return fsError('ENAMETOOLONG', syscall, path);
    for (const component of path.split('/')) {
        if (encoder.encode(component).length > 255) return fsError('ENAMETOOLONG', syscall, path);
    }
    return null;
}

/**
 * Follow a symlink chain the way `open(2)` would, and name how it ends.
 *
 * `SYMLOOP_MAX` is 40 on Linux: the kernel gives up at that depth and reports
 * ELOOP whether or not the links form an actual cycle. Counting hops is
 * therefore the faithful test, and it terminates on a self-referential pair
 * without having to remember where it has already been.
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
        // No answer ends the walk: the kernel would not describe this hop, so
        // it is neither a loop nor a dangling link — and reading the type off
        // the empty info it handed back is the `GLib-GIO-CRITICAL` that
        // {@link answered} documents. The caller then reaches the permission
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
 * The refusals that are not about this path at all.
 *
 * Everything above reads the NAME; these two read the process and the mount,
 * and they are why this function no longer ends in a bare `EACCES`. A
 * descriptor-table exhaustion reported as "permission denied" is the worst of
 * the codes that were collapsed: EMFILE is the one a caller is expected to back
 * off and retry on, and EACCES tells it to give up instead.
 */
function refusalNotAboutThePath(
    path: string,
    spec: OpenSpec,
    file: Gio.File,
    existing: Gio.FileInfo | null,
): NodeJS.ErrnoException {
    // Ask for a descriptor that cannot be refused for any reason of its own. If
    // even that fails, the table is full and the caller's path was never the
    // problem. One fd, closed immediately.
    const probe = GLib.open('/dev/null', 0, 0);
    if (probe < 0) return fsError('EMFILE', 'open', path);
    GLib.close(probe);

    if (spec.writable || spec.creat) {
        try {
            const fsInfo = file.query_filesystem_info('filesystem::readonly', null);
            if (fsInfo.get_attribute_boolean('filesystem::readonly')) return fsError('EROFS', 'open', path);
        } catch {
            // A mount that will not describe itself is not evidence of anything;
            // fall through to the permission answer rather than invent one.
        }
    }

    if (existing && nothingOnTheOtherEnd(spec, existing)) return fsError('ENXIO', 'open', path);

    return fsError('EACCES', 'open', path);
}

/**
 * Is this "the device exists but there is nothing on the other end" (ENXIO)
 * rather than "you may not" (EACCES)?
 *
 * Both arrive here as the same bare `-1`, and the two tell a caller opposite
 * things: a writer that retries on ENXIO until a reader attaches gives up
 * permanently when it is told "permission denied" instead. Two ordinary paths
 * reach it — `open('/dev/tty')` with no controlling terminal, and a FIFO opened
 * `O_WRONLY | O_NONBLOCK` with no reader (measured against Node v24.15.0: both
 * ENXIO, errno -6).
 *
 * The discriminator is `access(2)`, which GIO exposes as `access::can-*`: if
 * the kernel grants the access the caller asked for and the open STILL failed,
 * permission was not the obstruction. Narrowed to devices and FIFOs on purpose
 * — those are the only objects `open(2)` raises ENXIO for, so an ordinary file
 * keeps the EACCES answer whatever `access(2)` says about it.
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
    // Same order as `classifyOpenFailure`, and for the same reason: the kernel
    // rejects an over-long name before it looks anything up. This call was
    // missing entirely, so `mkdirSync(<500-char name>)` reported "permission
    // denied" for a length the open-side sibling already named correctly —
    // the two halves of one failure disagreeing inside one release.
    const tooLong = nameTooLong(path, 'mkdir');
    if (tooLong) return tooLong;

    const file = Gio.File.new_for_path(path);
    try {
        const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (answered(info)) return fsError('EEXIST', 'mkdir', path);
        // No answer means the search bit on some parent, not a taken name —
        // see {@link answered}. Reporting EEXIST here is what made
        // `try { mkdirSync(d) } catch (e) { if (e.code !== 'EEXIST') throw }`
        // swallow a hard permission denial.
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

const seekableFds = new Map<number, boolean>();

/**
 * Can this descriptor be positioned at all?
 *
 * `seekFd` used to be issued before EVERY read and write, unconditionally, so a
 * FIFO / pipe / socket / tty produced one
 * `g_io_channel_seek_position: assertion 'channel->is_seekable' failed`
 * per I/O call — a `GLib-CRITICAL`, which `G_DEBUG=fatal-criticals` (standard
 * in GNOME CI) turns into an abort. The bytes happened to survive because a
 * pipe ignores the offset, so the failed seek was a silent no-op and `_pos`
 * accumulated a number that meant nothing.
 *
 * The answer is therefore ASKED FOR rather than discovered by tripping an
 * assertion. `GIOChannel` decides it with `lseek(fd, 0, SEEK_CUR)`, which GJS
 * cannot reach, and its `is_seekable` field is not introspectable — so the file
 * TYPE is the available instrument.
 *
 * The rule is deliberately narrow: only `S_IFIFO` and `S_IFSOCK` are refused.
 * The tempting "seekable means `S_IFREG` or `S_IFBLK`" is WRONG and would trade
 * this defect for a worse one — a character device usually seeks fine
 * (`noop_llseek`), and Node performs positional I/O on `/dev/null`,
 * `/dev/zero` and `/dev/urandom` without complaint (measured against
 * v24.15.0). Refusing those would have turned a stray log line into an ESPIPE
 * that Node never raises.
 *
 * The type test alone is NOT the whole answer, and a TTY is where it runs out:
 * `/dev/pts/N` is `S_IFCHR` exactly like `/dev/zero`, but it has `no_llseek`.
 * So after the type test the DESCRIPTOR ITSELF is asked, with the same
 * `lseek(fd, 0, SEEK_CUR)` `GIOChannel` uses internally — a pure query that
 * moves nothing. Measured under gjs 1.88.1: it returns `G_IO_STATUS_NORMAL` on
 * a regular file, on `/dev/zero` and on `/dev/null`, and THROWS
 * `GLib.IOChannelError` ("Illegal seek") on a pty slave — cleanly, with no
 * CRITICAL, because a `GIOChannel` over a tty is `is_seekable` and the failure
 * comes from the kernel rather than from an assertion. Order matters: the type
 * test runs FIRST because a FIFO / socket channel is NOT `is_seekable`, and
 * asking one to seek is the `g_io_channel_seek_position: assertion failed`
 * CRITICAL this function exists to avoid.
 *
 * Without the second test, writing to a terminal by path was impossible: the
 * unconditional `seekFd` threw a RAW `Gio.IOErrorEnum` — `code === 8` as a
 * NUMBER, `instanceof Error === false` — straight out of `writeFileSync`,
 * `writeSync` and `createWriteStream`, so `catch (e) { if (e.code === 'ESPIPE') }`
 * could not see it and the classic "write to the terminal even when stdout is
 * redirected" idiom simply failed.
 *
 * The process's own stdin/stdout/stderr — the overwhelmingly common tty case —
 * never reach this code: `isStdFd()` intercepts them first.
 *
 * Cached per fd: the type behind an open file description cannot change under
 * it, and the cache is dropped by {@link releaseFd} so a recycled fd number
 * never inherits the previous holder's answer.
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
        // No answer is not the same as "no" — fall through and ask the
        // descriptor, which answers about the object rather than about a name.
    }

    try {
        seekHandle(fd).seek_position(0, GLib.SeekType.CUR);
        return true;
    } catch {
        // `lseek(fd, 0, SEEK_CUR)` failing IS the definition of a
        // non-seekable descriptor, and it is the only definition available
        // here: `GIOChannel.is_seekable` is not introspectable.
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
    seekableFds.delete(fd);
}

// ─── descriptor metadata ─────────────────────────────────────────────────────

/** The size of the file behind `fd`, via the descriptor where the host allows. */
export function sizeOfFd(fd: number, fallbackPath: string): number {
    const target = fdPath(fd) ?? fallbackPath;
    const info = Gio.File.new_for_path(target).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
    return Number(info.get_size());
}

/**
 * `ftruncate(2)`, as closely as GJS can express it.
 *
 * THE PART THAT IS REACHABLE, AND WHERE IT LIVES
 *
 * `ftruncate(2)` checks ONE thing: that the descriptor is open for writing. It
 * never looks at the file's mode. That check is pure bookkeeping we already
 * hold, so it is enforced where the access mode lives — `FileHandle`, next to
 * the identical gates in `_readCore`/`_writeCore` — and NOT here. Without it a
 * handle opened `'r'` could destroy the file, because the re-open below asks
 * the kernel for its own fresh permission and gets it.
 *
 * THE PART THAT IS NOT, MEASURED
 *
 * There is no `g_ftruncate`, and no route from an fd to a `GSeekable`:
 * `GioUnix.OutputStream` does not implement it, and `GBufferedOutputStream` /
 * `GDataOutputStream` wrapped around one both report `can_truncate() == false`
 * (measured under gjs 1.88.1). Truncation therefore needs a second `open(2)`,
 * by the descriptor's procfs name so it lands on the right inode after a rename
 * or an unlink — and a second open is checked against the FILE's mode.
 *
 * So the re-open takes the least privilege that can truncate: `append_to()` is
 * `O_WRONLY`, `open_readwrite()` is `O_RDWR`. That is not a micro-optimisation
 * — it is the difference between working and not on a write-only file: mode
 * 0o200 truncates through the first and is refused by the second (measured).
 * What remains unreachable is a file whose mode denies its own owner write
 * (0o444, 0o400, 0o000): Node truncates those through the descriptor, we cannot.
 * The failure is at least REPORTED now — it used to escape as a bare
 * `Gio.IOErrorEnum` with a numeric `code` and `instanceof Error === false`, so
 * `catch (e) { if (e.code === 'EACCES') }` could not see it.
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
