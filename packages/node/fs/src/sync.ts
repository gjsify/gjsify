// Reference: Node.js lib/fs.js (sync API)
// Reimplemented for GJS using Gio.File synchronous operations

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { existsSync } from '@gjsify/utils';
import { isDarwin } from '@gjsify/utils/core';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';

import FSWatcher from './fs-watcher.js';
import { getEncodingFromOptions, encodeUint8Array, decode } from './encoding.js';
import { FileHandle } from './file-handle.js';
import { Dirent } from './dirent.js';
import { Stats, BigIntStats, STAT_ATTRIBUTES, statsFrom } from './stats.js';
import { createNodeError, isNotFoundError } from './errors.js';
import { normalizePath, randomName } from './utils.js';
import { isStdFd, readStdFdAll, writeStdFdSync } from './std-fd.js';
import { normalizeMode } from './posix-flags.js';
import { classifyMkdirFailure, fsError } from './fd-io.js';

import type { OpenFlags, EncodingOption } from './types/index.js';
import type {
    PathLike,
    Mode,
    MakeDirectoryOptions,
    BufferEncodingOption,
    RmOptions,
    RmDirOptions,
    StatSyncOptions,
} from 'node:fs'; // Types from @types/node

export { existsSync };

export function statSync(path: PathLike, options?: StatSyncOptions): Stats | BigIntStats | undefined {
    const pathStr = normalizePath(path);
    try {
        const file = Gio.File.new_for_path(pathStr);
        const info = file.query_info(STAT_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, null);
        return statsFrom(info, pathStr, 'stat', options?.bigint);
    } catch (err: unknown) {
        if (options?.throwIfNoEntry === false && isNotFoundError(err)) return undefined;
        throw createNodeError(err, 'stat', pathStr);
    }
}

export function lstatSync(path: PathLike, options?: StatSyncOptions): Stats | BigIntStats | undefined {
    const pathStr = normalizePath(path);
    try {
        const file = Gio.File.new_for_path(pathStr);
        const info = file.query_info(STAT_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        return statsFrom(info, pathStr, 'lstat', options?.bigint);
    } catch (err: unknown) {
        if (options?.throwIfNoEntry === false && isNotFoundError(err)) return undefined;
        throw createNodeError(err, 'lstat', pathStr);
    }
}

export function readdirSync(
    path: PathLike,
    options?: { withFileTypes?: boolean; encoding?: string; recursive?: boolean },
): string[] | Dirent[] {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    // NOFOLLOW_SYMLINKS so `standard::type` describes the real dirent:
    // `readdir(withFileTypes:true)`'s `Dirent.isSymbolicLink()` must be true for an
    // entry that IS a symlink, not report its target's type. @nodelib/fs.scandir,
    // and so fast-glob, relies on this.
    //
    // Drain into an array and CLOSE the enumerator before recursing or returning:
    // unclosed, GJS holds the Gio.FileEnumerator and its dirfd until GC, and a deep
    // walk (`rmSync` over a node_modules tree ~20 levels of nested @girs/* deep)
    // exhausts the per-process fd limit as EMFILE.
    const enumerator = file.enumerate_children(
        'standard::name,standard::type',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );

    interface Entry {
        name: string;
        type: Gio.FileType;
    }

    const entries: Entry[] = [];
    try {
        let info = enumerator.next_file(null);
        while (info !== null) {
            entries.push({ name: info.get_name(), type: info.get_file_type() });
            info = enumerator.next_file(null);
        }
    } finally {
        try {
            enumerator.close(null);
        } catch {
            // GIO sometimes throws on close after iteration completes — non-fatal.
        }
    }

    const result: (string | Dirent)[] = [];
    for (const entry of entries) {
        const childPath = join(pathStr, entry.name);

        if (options?.withFileTypes) {
            result.push(new Dirent(childPath, entry.name, entry.type));
        } else {
            result.push(entry.name);
        }

        if (options?.recursive && entry.type === Gio.FileType.DIRECTORY) {
            // After the try/finally closed this level's enumerator, so live fds stay
            // bounded by recursion depth rather than depth × open-during-iteration.
            const subEntries = readdirSync(childPath, options);
            for (const subEntry of subEntries) {
                if (typeof subEntry === 'string') {
                    result.push(join(entry.name, subEntry));
                } else {
                    result.push(subEntry);
                }
            }
        }
    }

    return result as string[] | Dirent[];
}

const MAX_SYMLINK_DEPTH = 40; // matches Linux MAXSYMLINKS

/**
 * POSIX `realpath(3)`: resolve EVERY component, not merely a trailing symlink.
 *
 * Checking only the LEAF lets a symlinked ANCESTOR survive into the result, which is
 * invisible on a typical Linux box — `/tmp` is a real directory, so the identity
 * answer is accidentally right. On macOS `/var` is a symlink to `private/var`, so
 * `realpathSync(os.tmpdir())` answered `/var/folders/…` while the child process
 * asked for its own cwd reported `/private/var/folders/…`: six
 * `@gjsify/child_process` cwd failures on main's macOS leg, the only leg that runs
 * it. The platform was incidental — a symlinked parent directory reproduces it on
 * Linux.
 *
 * The symlink budget is shared across the whole walk because POSIX counts TOTAL
 * resolutions, not per-component ones, so a cycle through any component terminates.
 */
export function realpathSync(path: PathLike): string {
    const pathStr = normalizePath(path);
    return resolveEveryComponent(Gio.File.new_for_path(pathStr), { left: MAX_SYMLINK_DEPTH }, pathStr);
}

/** Resolve `file`'s ancestors first, then `file` itself. */
function resolveEveryComponent(file: Gio.File, budget: { left: number }, original: string): string {
    const parent = file.get_parent();
    // At the root there is nothing above left to resolve.
    const here =
        parent === null
            ? file
            : Gio.File.new_for_path(resolveEveryComponent(parent, budget, original)).get_child(file.get_basename()!);
    return expandSymlinks(here, budget, original);
}

/**
 * Expand `file` while it is a symlink. A target may itself sit behind symlinked
 * ancestors, so each hop is resolved in full rather than appended — hence the mutual
 * recursion with {@link resolveEveryComponent}, both directions on one budget.
 */
function expandSymlinks(file: Gio.File, budget: { left: number }, original: string): string {
    let current = file;
    for (;;) {
        const info = current.query_info(
            'standard::is-symlink,standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null,
        );

        if (!info.get_is_symlink()) {
            return current.get_path()!;
        }

        if (--budget.left < 0) {
            throw new Error(`ELOOP: too many levels of symbolic links, realpath '${original}'`);
        }

        const target = info.get_symlink_target()!;
        const parent = current.get_parent();
        // `resolve_relative_path` is documented for relative inputs only, so branch
        // explicitly rather than trust how the local-file backend treats an absolute one.
        const hop = GLib.path_is_absolute(target)
            ? Gio.File.new_for_path(target)
            : (parent ?? current).resolve_relative_path(target);
        current = Gio.File.new_for_path(resolveEveryComponent(hop, budget, original));
    }
}
(realpathSync as unknown as { native: typeof realpathSync }).native = realpathSync;

export function symlinkSync(target: PathLike, path: PathLike, _type?: 'file' | 'dir' | 'junction'): void {
    const pathStr = normalizePath(path);
    const targetStr = normalizePath(target);
    const file = Gio.File.new_for_path(pathStr);
    file.make_symbolic_link(targetStr, null);
}

export function readFileSync(
    path: PathLike | number | FileHandle,
    options: { encoding?: string | null; flag?: string } | string | null = { encoding: null, flag: 'r' },
) {
    // `openSync()` returns a FileHandle where Node returns a number, so this is the
    // shape `readFileSync(openSync(p, 'r'))` arrives in. Unwrapped onto the numeric
    // branch — otherwise it stringifies to `'[object Object]'` and reads that name
    // out of the CWD.
    if (path instanceof FileHandle) path = path.fd;
    // Descriptors 0/1/2 have no path, so they are read from the process's own Unix
    // stream — the Node `readFileSync(0)` stdin idiom.
    if (typeof path === 'number' && isStdFd(path)) {
        const enc = getEncodingFromOptions(options as Parameters<typeof getEncodingFromOptions>[0], 'buffer');
        return encodeUint8Array(enc, readStdFdAll(path));
    }
    if (typeof path === 'number') {
        // Through the handle's cursor: Node reads an fd from its CURRENT position and
        // consumes it, so resolving the fd back to a path and re-reading from 0 gives
        // a different answer to any caller that had already read part of it.
        const enc = getEncodingFromOptions(options as Parameters<typeof getEncodingFromOptions>[0], 'buffer');
        return encodeUint8Array(enc, FileHandle.getInstance(path, 'read')._readToEndSync());
    }
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);

    try {
        const [ok, data] = file.load_contents(null);

        if (!ok) {
            throw createNodeError(new Error('failed to read file'), 'read', pathStr);
        }

        return encodeUint8Array(
            getEncodingFromOptions(options as Parameters<typeof getEncodingFromOptions>[0], 'buffer'),
            data,
        );
    } catch (err: unknown) {
        if ((err as { code?: unknown }).code && typeof (err as { code?: unknown }).code === 'string') throw err; // Already a Node error
        throw createNodeError(err, 'read', pathStr);
    }
}

/**
 * [`mkdir(2)`](http://man7.org/linux/man-pages/man2/mkdir.2.html). Returns the FIRST
 * directory created under `recursive: true`, otherwise `undefined`. A string mode is
 * parsed as octal; the default is `0o777`.
 */
export function mkdirSync(
    path: PathLike,
    options: MakeDirectoryOptions & {
        recursive: true;
    },
): string | undefined;
export function mkdirSync(
    path: PathLike,
    options?:
        | Mode
        | (MakeDirectoryOptions & {
              recursive?: false | undefined;
          })
        | null,
): void;
export function mkdirSync(path: PathLike, options?: Mode | MakeDirectoryOptions | null): string | undefined | void;
export function mkdirSync(path: PathLike, options?: Mode | MakeDirectoryOptions | null): string | undefined | void {
    let recursive = false;
    let requested: Mode | undefined;

    if (options !== null && options !== undefined) {
        if (typeof options === 'object') {
            if (options.recursive) recursive = options.recursive;
            // `!== undefined`, not truthiness: `{ mode: 0 }` is a legitimate request
            // for an inaccessible directory.
            if (options.mode !== undefined) requested = options.mode;
        } else {
            requested = options;
        }
    }

    path = normalizePath(path);
    const mode = normalizeMode(requested, 0o777);

    if (recursive) return mkdirSyncRecursive(path, mode);

    mkdirWithMode(path, mode);
    return undefined;
}

/**
 * `mkdir(2)` with the mode the caller asked for. `GLib.mkdir()` and not
 * `Gio.File.make_directory()`, which takes no mode at all: the KERNEL then applies
 * it — masked by the live umask, `S_ISGID` inherited from the parent, a requested
 * setuid/setgid dropped — which is Node's asymmetry, reproduced with no code here.
 */
function mkdirWithMode(pathStr: string, mode: number): void {
    if (GLib.mkdir(pathStr, mode) !== 0) throw classifyMkdirFailure(pathStr);
}

/**
 * `mkdir -p`, returning the first directory created or `undefined` if all existed.
 * Walked rather than `GLib.mkdir_with_parents()`, which cannot report which
 * directory was first.
 */
function mkdirSyncRecursive(pathStr: string, mode: number): string | undefined {
    if (GLib.mkdir(pathStr, mode) === 0) return pathStr;

    const failure = classifyMkdirFailure(pathStr);
    // Already there: Node applies no mode to directories that existed.
    if (failure.code === 'EEXIST') {
        if (GLib.file_test(pathStr, GLib.FileTest.IS_DIR)) return undefined;
        throw failure;
    }
    if (failure.code !== 'ENOENT') throw failure;

    const parentPath = join(pathStr, '..');
    const resolvedParent = Gio.File.new_for_path(parentPath).get_path()!;
    if (resolvedParent === pathStr) throw failure;

    const firstCreated = mkdirSyncRecursive(resolvedParent, mode);
    mkdirWithMode(pathStr, mode);
    return firstCreated ?? pathStr;
}

/**
 * [`rmdir(2)`](http://man7.org/linux/man-pages/man2/rmdir.2.html) — empty directories
 * only; `rm -rf` behaviour is {@link rmSync} with `{ recursive: true, force: true }`.
 * On a FILE this is ENOTDIR on POSIX but ENOENT on Windows.
 */
export function rmdirSync(path: PathLike, _options?: RmDirOptions): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    try {
        const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (info.get_file_type() !== Gio.FileType.DIRECTORY) {
            const err = Object.assign(new Error(), { code: 4 }); // Gio.IOErrorEnum.NOT_DIRECTORY
            throw createNodeError(err, 'rmdir', pathStr);
        }
        const enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        if (enumerator.next_file(null) !== null) {
            const err = Object.assign(new Error(), { code: 5 }); // Gio.IOErrorEnum.NOT_EMPTY
            throw createNodeError(err, 'rmdir', pathStr);
        }
        file.delete(null);
    } catch (err: unknown) {
        if ((err as { code?: unknown }).code && typeof (err as { code?: unknown }).code === 'string') throw err; // Already a Node error
        throw createNodeError(err, 'rmdir', pathStr);
    }
}

export function unlinkSync(path: PathLike): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    try {
        file.delete(null);
    } catch (err: unknown) {
        throw createNodeError(err, 'unlink', pathStr);
    }
}

/** The `{ encoding, mode, flag }` bag `writeFileSync` / `appendFileSync` accept. */
type WriteFileOptions = { encoding?: string | null; mode?: Mode; flag?: OpenFlags | string } | string | null;

/**
 * Write a whole file through a descriptor, honouring `mode` and `flag`. Both are
 * load-bearing and silent when dropped: a bare `GLib.file_set_contents()` makes
 * `writeFileSync(p, secret, {mode: 0o600})` world-readable and loses `{flag: 'wx'}`'s
 * exclusivity, reporting success either way.
 */
function writeWholeFile(
    path: PathLike | number | FileHandle,
    data: string | Uint8Array,
    options: WriteFileOptions,
    defaultFlag: OpenFlags,
): void {
    const encoding = getEncodingFromOptions(options as Parameters<typeof getEncodingFromOptions>[0], 'utf8');
    const bag = typeof options === 'object' && options !== null ? options : {};
    const bytes = typeof data === 'string' ? Buffer.from(data, (encoding as BufferEncoding) || 'utf8') : data;

    // A DESCRIPTOR, not a name: write at its own position, ignore `mode` and `flag`
    // (the file is open, so neither has anything left to decide) and do NOT close it.
    // Falling through to `normalizePath` instead yields `'8'` or `'[object Object]'`
    // and writes the payload to a file of THAT name in the CWD, reporting success
    // while the file the caller had open is untouched.
    if (typeof path === 'number' || path instanceof FileHandle) {
        if (typeof path === 'number' && isStdFd(path)) {
            writeStdFdSync(path, bytes);
            return;
        }
        FileHandle.getInstance(path, 'write')._writeSync(bytes, null);
        return;
    }

    const handle = new FileHandle({
        path: normalizePath(path),
        flags: (bag.flag as OpenFlags) ?? defaultFlag,
        mode: bag.mode ?? 0o666,
    });
    try {
        handle._writeSync(bytes, null);
    } finally {
        handle._closeSync();
    }
}

export function writeFileSync(
    path: PathLike | number | FileHandle,
    data: string | Uint8Array,
    options?: WriteFileOptions,
) {
    writeWholeFile(path, data, options ?? null, 'w');
}

export function renameSync(oldPath: PathLike, newPath: PathLike): void {
    const oldStr = normalizePath(oldPath);
    const newStr = normalizePath(newPath);
    const src = Gio.File.new_for_path(oldStr);
    const dest = Gio.File.new_for_path(newStr);
    try {
        src.move(dest, Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (err: unknown) {
        throw createNodeError(err, 'rename', oldStr, newStr);
    }
}

export function copyFileSync(src: PathLike, dest: PathLike, mode?: number): void {
    const srcStr = normalizePath(src);
    const destStr = normalizePath(dest);
    const srcFile = Gio.File.new_for_path(srcStr);
    const destFile = Gio.File.new_for_path(destStr);
    let flags = Gio.FileCopyFlags.NONE;
    // mode 0 = default (overwrite), COPYFILE_EXCL (1) = no overwrite
    if (mode && (mode & 1) === 0) {
        flags = Gio.FileCopyFlags.OVERWRITE;
    } else if (!mode) {
        flags = Gio.FileCopyFlags.OVERWRITE;
    }
    try {
        srcFile.copy(destFile, flags, null, null);
    } catch (err: unknown) {
        throw createNodeError(err, 'copyfile', srcStr, destStr);
    }
    stripPrivilegeBitsAfterCopy(destFile, srcStr, destStr);
}

/**
 * `Gio.File.copy` reproduces the source mode WHOLE, set-user-ID and set-group-ID
 * included. Node's `copyFile` does not, and the difference is a
 * privilege-escalation shape: a setuid binary copied into a writable directory
 * would otherwise arrive still setuid.
 *
 * NODE DOES NOT MASK ANYTHING — that is the whole trap here, and a `& ~0o6000`
 * written from the obvious reading of the docs is wrong in six measurable ways.
 * libuv `fchmod`s the SOURCE mode onto the destination BEFORE its copy loop, and
 * what removes the bits is the kernel, on the subsequent `write(2)`:
 * `should_remove_suid()` in `fs/inode.c`. So the rule to reproduce is that
 * predicate, and it has two conditions the mask cannot express:
 *
 *   - S_ISUID goes on any write.
 *   - S_ISGID goes ONLY when S_IXGRP is also set — ON LINUX. Without group-exec
 *     the bit is the mandatory-locking mark rather than a privilege, and
 *     `should_remove_suid()` leaves it. XNU does not make that distinction and
 *     strips it either way: measured on both macOS legs, `2644 -> 0644` where
 *     Linux gives `2644 -> 2644`. Node inherits the difference for free because
 *     the KERNEL is what strips; we have to spell it, through the one OS
 *     detector (ADR 0018) this package already uses for the `O_*` table.
 *   - No write happens at all for a ZERO-LENGTH source, so nothing is stripped.
 *
 * Measured against node v24.15.0, and every row here is a row a mask gets wrong
 * or a row that pins the shape:
 *
 *   len 3  src 4755 → dst 0755   set-user-ID goes
 *   len 3  src 2755 → dst 0755   set-group-ID goes — S_IXGRP is set
 *   len 3  src 2644 → dst 2644   ...and STAYS without it
 *   len 3  src 2744 → dst 2744   user-exec does not count, only GROUP-exec
 *   len 3  src 2614 → dst 0614   other-exec does not either; S_IXGRP does
 *   len 3  src 6644 → dst 2644   both bits set: only S_ISUID goes
 *   len 3  src 1755 → dst 1755   sticky is never touched
 *   len 0  src 4755 → dst 4755   NO WRITE, NO STRIP
 *   len 0  src 7755 → dst 7755   same, all three survive
 *   src 0666 under umask 0027 → 0666       the umask does NOT apply
 *   pre-existing dst 0600, src 0644 → 0644 overwrite is no different
 *
 * An empty setuid source copied ONTO a non-empty destination also keeps 4755:
 * libuv's `ftruncate` precedes its `fchmod`, so the truncate's own strip is
 * overwritten. The size read below is the destination's AFTER the copy, which is
 * the source's, so that case falls out of the same guard.
 *
 * Left alone when the result would not change: without the bits `Gio.File.copy`
 * already lands on Node's answer, so an unconditional chmod would buy a syscall
 * per copy and a second place for the mode to come from.
 *
 * DELIBERATELY NOT APPLIED to `fs.cp`/`cpSync`. Measured on the same Node, they
 * are already right: a single-file `cp` onto an ABSENT destination KEEPS 4755,
 * and only the recursive walk and the overwrite path drop it. Masking there
 * would introduce a divergence rather than close one. That asymmetry is Node's
 * own, it is not a security shape (an existing destination means the file was
 * already there), and reproducing it exactly needs its own measurement pass —
 * `status/open-todos.md` carries the numbers.
 */
function stripPrivilegeBitsAfterCopy(destFile: Gio.File, srcStr: string, destStr: string): void {
    const S_ISUID = 0o4000;
    const S_ISGID = 0o2000;
    const S_IXGRP = 0o0010;
    try {
        const info = destFile.query_info('unix::mode,standard::size', Gio.FileQueryInfoFlags.NONE, null);
        // No bytes written, no strip — see the `len 0` rows above.
        if (info.get_size() === 0) return;
        const mode = info.get_attribute_uint32('unix::mode');
        let stripped = mode & ~S_ISUID;
        if (isDarwin() || mode & S_IXGRP) stripped &= ~S_ISGID;
        if (stripped === mode) return;
        destFile.set_attribute_uint32('unix::mode', stripped, Gio.FileQueryInfoFlags.NONE, null);
    } catch (err: unknown) {
        // `srcStr` in `path` and `destStr` in `dest`, matching the copy's own throw
        // above: a caller matching on `err.path` must not get a different file
        // depending on WHICH half of copyFile failed.
        throw createNodeError(err, 'copyfile', srcStr, destStr);
    }
}

export function accessSync(path: PathLike, mode?: number): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    try {
        const info = file.query_info('access::*', Gio.FileQueryInfoFlags.NONE, null);
        // mode: F_OK=0, R_OK=4, W_OK=2, X_OK=1
        if (mode !== undefined && mode !== 0) {
            // Gio.IOErrorEnum.PERMISSION_DENIED = 14 → maps to EACCES via createNodeError
            const permErr = { code: 14, message: `permission denied, access '${pathStr}'` };
            if (mode & 4 && !info.get_attribute_boolean('access::can-read')) {
                throw createNodeError(permErr, 'access', pathStr);
            }
            if (mode & 2 && !info.get_attribute_boolean('access::can-write')) {
                throw createNodeError(permErr, 'access', pathStr);
            }
            if (mode & 1 && !info.get_attribute_boolean('access::can-execute')) {
                throw createNodeError(permErr, 'access', pathStr);
            }
        }
    } catch (err: unknown) {
        if ((err as { code?: unknown }).code && typeof (err as { code?: unknown }).code === 'string') throw err; // Already a Node-style error
        throw createNodeError(err, 'access', pathStr);
    }
}

export function appendFileSync(
    path: PathLike | number | FileHandle,
    data: string | Uint8Array,
    options?: WriteFileOptions,
): void {
    writeWholeFile(path, data, options ?? null, 'a');
}

export function readlinkSync(path: PathLike, options?: { encoding?: string } | string): string | Buffer {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    try {
        const info = file.query_info('standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        const target = info.get_symlink_target();
        if (!target) {
            throw Object.assign(new Error(`EINVAL: invalid argument, readlink '${pathStr}'`), {
                code: 'EINVAL',
                errno: -22,
                syscall: 'readlink',
                path: pathStr,
            });
        }
        const encoding = typeof options === 'string' ? options : options?.encoding;
        if (encoding === 'buffer') {
            return Buffer.from(target);
        }
        return target;
    } catch (err: unknown) {
        if (typeof (err as { code?: unknown }).code === 'string') throw err;
        throw createNodeError(err, 'readlink', pathStr);
    }
}

export function linkSync(existingPath: PathLike, newPath: PathLike): void {
    const existingStr = normalizePath(existingPath);
    const newStr = normalizePath(newPath);
    // Introspection exposes no hard-link call (copy/move/make_symbolic_link only), so
    // this spawns `ln` — as an argv ARRAY via GLib.spawn_sync, NEVER a command line:
    // `GLib.spawn_command_line_sync()` word-splits and unquotes, so a path with a
    // space builds the wrong argv and one with shell metacharacters is an injection.
    //
    // Node's semantics are enforced up front because bare `ln` diverges: link(2) never
    // overwrites (EEXIST) where `ln` into an existing DIRECTORY creates
    // `<newPath>/<basename>`; a missing source is ENOENT. The NOFOLLOW probes match
    // link(2) on Linux, which links the source SYMLINK itself, not its target.
    const existingFile = Gio.File.new_for_path(existingStr);
    if (existingFile.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.UNKNOWN) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, link '${existingStr}' -> '${newStr}'`), {
            code: 'ENOENT',
            errno: -2,
            syscall: 'link',
            path: existingStr,
            dest: newStr,
        });
    }
    const newFile = Gio.File.new_for_path(newStr);
    if (newFile.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) !== Gio.FileType.UNKNOWN) {
        throw Object.assign(new Error(`EEXIST: file already exists, link '${existingStr}' -> '${newStr}'`), {
            code: 'EEXIST',
            errno: -17,
            syscall: 'link',
            path: existingStr,
            dest: newStr,
        });
    }
    // `--` keeps a dash-leading path from parsing as an option. A failed SPAWN (`ln`
    // not on PATH) throws a GLib.Error, but an `ln` that RAN and exited non-zero shows
    // only in the wait status — hence the explicit check below.
    let detail = '';
    try {
        const [, , stderr, waitStatus] = GLib.spawn_sync(
            null,
            ['ln', '--', existingStr, newStr],
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null,
        );
        detail = stderr ? new TextDecoder().decode(stderr).trim() : '';
        // Normally throws a GLib.Error on non-zero exit; the boolean guards a binding
        // that reports instead of throwing.
        if (!GLib.spawn_check_wait_status(waitStatus)) {
            throw new Error(`ln exited non-zero (${waitStatus})`);
        }
        return;
    } catch (err: unknown) {
        if (detail === '' && err instanceof Error) detail = err.message;
        throw Object.assign(
            new Error(
                `EPERM: operation not permitted, link '${existingStr}' -> '${newStr}'` + (detail ? ` (${detail})` : ''),
            ),
            {
                code: 'EPERM',
                errno: -1,
                syscall: 'link',
                path: existingStr,
                dest: newStr,
            },
        );
    }
}

export function truncateSync(path: PathLike, len?: number): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    try {
        // `open_readwrite().truncate()` is the real operation: same inode, extends with
        // zeros when growing. A `replace()` + rewrite instead gives a NEW INODE, which
        // orphans every open descriptor and detaches every hard link.
        const stream = file.open_readwrite(null);
        try {
            (stream.get_output_stream() as Gio.FileOutputStream).truncate(Math.max(0, len ?? 0), null);
        } finally {
            stream.close(null);
        }
    } catch (err: unknown) {
        throw createNodeError(err, 'truncate', pathStr);
    }
}

export function chmodSync(path: PathLike, mode: Mode): void {
    const pathStr = normalizePath(path);
    // The octal parser is shared with open/mkdir/mkdtemp/writeFile so the spellings of
    // "mode" cannot drift, but with NO default — the one thing chmod does not share.
    // Node's `chmod` REQUIRES a mode and rejects a missing one; defaulting to 0o666
    // makes `chmodSync(p, cfg.mode)` with an absent `cfg.mode` silently turn a 0600
    // secret world-writable. All six chmod spellings route through here.
    const modeNum = normalizeMode(mode);
    // Natively, no subprocess: G_FILE_ATTRIBUTE_UNIX_MODE is settable on local files.
    // A `chmod` shell-out breaks on any path containing a space.
    try {
        const file = Gio.File.new_for_path(pathStr);
        file.set_attribute_uint32('unix::mode', modeNum, Gio.FileQueryInfoFlags.NONE, null);
    } catch (err: unknown) {
        throw createNodeError(err, 'chmod', pathStr);
    }
}

export function chownSync(path: PathLike, uid: number, gid: number): void {
    const pathStr = normalizePath(path);
    // Natively via unix::uid / unix::gid, for the same reason as chmodSync. Node
    // semantics: -1 leaves the respective id unchanged.
    try {
        const file = Gio.File.new_for_path(pathStr);
        const info = new Gio.FileInfo();
        if (uid !== -1) info.set_attribute_uint32('unix::uid', uid);
        if (gid !== -1) info.set_attribute_uint32('unix::gid', gid);
        file.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null);
    } catch (err: unknown) {
        throw createNodeError(err, 'chown', pathStr);
    }
}

type WatchListener = (eventType: string, filename: string | null) => void;
type WatchOpts = { persistent?: boolean; recursive?: boolean; encoding?: string };

export function watch(filename: PathLike, listener?: WatchListener): FSWatcher;
export function watch(filename: PathLike, options?: WatchOpts, listener?: WatchListener): FSWatcher;

export function watch(filename: PathLike, options?: WatchOpts | WatchListener, listener?: WatchListener): FSWatcher {
    // `fs.watch(path, listener)` is the two-argument form Node documents first, and
    // it reached FSWatcher as an options object that failed the `typeof === 'object'`
    // test — so the options were replaced by the defaults and the LISTENER was
    // dropped on the floor. A watcher that fires nothing looks exactly like a
    // filesystem that changed nothing.
    if (typeof options === 'function') {
        listener = options;
        options = undefined;
    }
    return new FSWatcher(normalizePath(filename), options, listener);
}

export function openSync(path: PathLike, flags?: OpenFlags | number, mode?: Mode): FileHandle {
    return new FileHandle({ path, flags: flags as OpenFlags | undefined, mode });
}

/**
 * Create a unique temporary directory: six random characters appended to `prefix`.
 * Returns its path, encoded per `options` (default `'utf8'`).
 */
export function mkdtempSync(prefix: string, options?: EncodingOption): string;
export function mkdtempSync(prefix: string, options: BufferEncodingOption): Buffer;
export function mkdtempSync(prefix: string, options?: EncodingOption): string | Buffer;

export function mkdtempSync(prefix: string, options?: EncodingOption | BufferEncodingOption): string | Buffer {
    const encoding: string | undefined = getEncodingFromOptions(options);
    const made = mkdtempAt(prefix);
    // `'buffer'` is not a TextDecoder label — `decode()` would construct
    // `new TextDecoder('buffer')` and throw a RangeError, leaving the directory
    // created and the caller with an error instead of the Buffer Node returns.
    // Measured: `fs.mkdtempSync(p, { encoding: 'buffer' })` is a Buffer on v24.15.0.
    return encoding === 'buffer' ? Buffer.from(made) : decode(made, encoding);
}

/**
 * `mkdtemp(3)`: claim a unique name and create it 0700, atomically.
 *
 * The mode is not negotiable — this is the one API whose whole purpose is a PRIVATE
 * scratch space, and 0o777 hands it to everyone. Nor is the atomicity: a
 * `while (existsSync(path))` test-then-create is racy against any other process, and
 * `existsSync` is `Gio.File.query_exists()`, true even for a dangling symlink.
 * `mkdir(2)` answers both in one syscall, failing EEXIST on a taken name, so the loop
 * retries rather than guesses.
 *
 * Both entry points call THIS so `mkdtempSync` and `promises.mkdtemp` cannot disagree
 * on the mode — they once did, by 0o077.
 */
export function mkdtempAt(prefix: string): string {
    // mkdtemp(3) is specified as `mkdir(pathname, S_IRWXU)`. A ceiling, not a request:
    // the umask can only make it tighter.
    const PRIVATE_DIR_MODE = 0o700;
    for (let attempt = 0; attempt < 64; attempt++) {
        const candidate = prefix + randomName();
        if (GLib.mkdir(candidate, PRIVATE_DIR_MODE) === 0) return candidate;
        const failure = classifyMkdirFailure(candidate);
        if (failure.code !== 'EEXIST') {
            failure.syscall = 'mkdtemp';
            throw failure;
        }
    }
    throw fsError('EEXIST', 'mkdtemp', prefix + 'XXXXXX');
}

/** Remove files and directories, modelled on POSIX `rm`. */
export function rmSync(path: PathLike, options?: RmOptions): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    const recursive = options?.recursive || false;
    const force = options?.force || false;

    // NOFOLLOW is DATA-LOSS CRITICAL. The default `Gio.FileQueryInfoFlags.NONE`
    // follows symlinks and calls a symlink-to-directory a directory, so the descent
    // below walks the TARGET's children: `rmSync(node_modules/@pkg/foo,
    // { recursive: true })` on a symlink to `packages/foo` deletes the real sources.
    // Node removes a top-level symlink as a single entry, never descending.
    let topType: Gio.FileType;
    try {
        topType = file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (err: unknown) {
        if (force && isNotFoundError(err)) return;
        throw createNodeError(err, 'rm', path);
    }

    if (topType === Gio.FileType.SYMBOLIC_LINK) {
        try {
            file.delete(null);
        } catch (err: unknown) {
            if (force && isNotFoundError(err)) return;
            throw createNodeError(err, 'rm', path);
        }
        return;
    }

    if (topType === Gio.FileType.DIRECTORY) {
        // No `withFileTypes`: the recursive call re-stats each child anyway, and the
        // plain name list lets the enumerator close before the first descent — see
        // `readdirSync` for the EMFILE-on-deep-trees rationale.
        const childNames = readdirSync(path) as string[];

        if (!recursive && childNames.length) {
            const err = Object.assign(new Error(), { code: 5 }); // Gio.IOErrorEnum.NOT_EMPTY
            throw createNodeError(err, 'rm', path);
        }

        for (const childName of childNames) {
            rmSync(join(pathStr, childName), options);
        }
    }

    try {
        file.delete(null);
    } catch (err: unknown) {
        if (force && isNotFoundError(err)) return;
        throw createNodeError(err, 'rm', path);
    }
}
