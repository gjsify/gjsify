// Reference: Node.js lib/fs.js (sync API)
// Reimplemented for GJS using Gio.File synchronous operations

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { existsSync } from '@gjsify/utils';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';

import FSWatcher from './fs-watcher.js';
import { getEncodingFromOptions, encodeUint8Array, decode } from './encoding.js';
import { FileHandle } from './file-handle.js';
import { Dirent } from './dirent.js';
import { Stats, BigIntStats, STAT_ATTRIBUTES } from './stats.js';
import { createNodeError, isNotFoundError } from './errors.js';
import { normalizePath, randomName } from './utils.js';
import { isStdFd, readStdFdAll } from './std-fd.js';
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

// --- stat / lstat ---

export function statSync(path: PathLike, options?: StatSyncOptions): Stats | BigIntStats | undefined {
    const pathStr = normalizePath(path);
    try {
        const file = Gio.File.new_for_path(pathStr);
        const info = file.query_info(STAT_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, null);
        return options?.bigint ? new BigIntStats(info, pathStr) : new Stats(info, pathStr);
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
        return options?.bigint ? new BigIntStats(info, pathStr) : new Stats(info, pathStr);
    } catch (err: unknown) {
        if (options?.throwIfNoEntry === false && isNotFoundError(err)) return undefined;
        throw createNodeError(err, 'lstat', pathStr);
    }
}

// --- readdir ---

export function readdirSync(
    path: PathLike,
    options?: { withFileTypes?: boolean; encoding?: string; recursive?: boolean },
): string[] | Dirent[] {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    // NOFOLLOW_SYMLINKS so the enumerator's standard::type reflects the real
    // dirent — Node's readdir(withFileTypes:true).Dirent.isSymbolicLink()
    // must return true for entries that are themselves symlinks (rather than
    // following them and reporting the target's type). @nodelib/fs.scandir
    // (used by fast-glob) relies on this.
    // Pre-pass: drain the enumerator into a name/type array, then CLOSE it
    // before recursing or returning. Without the explicit close, GJS would
    // hold the underlying Gio.FileEnumerator (and its dirfd) alive until
    // garbage collection — deep recursive walks (e.g. `rmSync` on a
    // node_modules tree with ~20 levels of nested @girs/* packages) hit
    // the per-process fd limit and surface as
    //   "Error opening directory: Zu viele offene Dateien" (EMFILE).
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
            // Recurse only after this directory's enumerator has been closed
            // (via the try/finally above) — keeps the open-fd count bounded
            // by recursion depth × 1 instead of recursion depth × open-during-iteration.
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

// --- realpath ---

const MAX_SYMLINK_DEPTH = 40; // matches Linux MAXSYMLINKS

/**
 * POSIX `realpath(3)`: resolve EVERY component, not merely a trailing symlink.
 *
 * This used to `query_info` the path once and return it UNCHANGED whenever the
 * LEAF was not a symlink, so a symlinked ANCESTOR survived into the result. On a
 * typical Linux box that is invisible — `/tmp` is a real directory, so the
 * identity answer happens to be the right one. On macOS `/var` is a symlink to
 * `private/var`, so `realpathSync(os.tmpdir())` returned `/var/folders/…` while a
 * child process asked for its own cwd reported `/private/var/folders/…`. That
 * surfaced as six `@gjsify/child_process` cwd failures on main's macOS leg — the
 * only leg that runs it, macOS being off for pull requests. The platform was
 * incidental: reproduced on Linux with nothing but a symlinked parent directory.
 *
 * The symlink budget is shared across the whole walk because POSIX counts total
 * resolutions rather than per-component ones, so a cycle reachable through any
 * component still terminates.
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
 * Expand `file` for as long as it is a symlink. A target may itself sit behind
 * symlinked ancestors, so every hop is resolved in full rather than just
 * appended — which is what makes this mutually recursive with
 * {@link resolveEveryComponent}. Both directions consume the same budget.
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
        // An ABSOLUTE target is not relative to anything — `resolve_relative_path`
        // is documented for relative inputs only, so branch explicitly instead of
        // relying on how the local-file backend happens to treat one.
        const hop = GLib.path_is_absolute(target)
            ? Gio.File.new_for_path(target)
            : (parent ?? current).resolve_relative_path(target);
        current = Gio.File.new_for_path(resolveEveryComponent(hop, budget, original));
    }
}
(realpathSync as unknown as { native: typeof realpathSync }).native = realpathSync;

// --- symlink ---

export function symlinkSync(target: PathLike, path: PathLike, _type?: 'file' | 'dir' | 'junction'): void {
    const pathStr = normalizePath(path);
    const targetStr = normalizePath(target);
    const file = Gio.File.new_for_path(pathStr);
    file.make_symbolic_link(targetStr, null);
}

export function readFileSync(
    path: PathLike | number,
    options: { encoding?: string | null; flag?: string } | string | null = { encoding: null, flag: 'r' },
) {
    // A numeric fd: the standard descriptors 0/1/2 have no path and are read
    // from the process's own Unix stream (the Node `readFileSync(0)` stdin
    // idiom); any other number is an open FileHandle, resolved to its path.
    if (typeof path === 'number' && isStdFd(path)) {
        const enc = getEncodingFromOptions(options as Parameters<typeof getEncodingFromOptions>[0], 'buffer');
        return encodeUint8Array(enc, readStdFdAll(path));
    }
    if (typeof path === 'number') {
        // Node reads an fd from its CURRENT position and consumes it. Resolving
        // the fd back to its path and re-reading the whole file from 0 gave a
        // different answer to every caller that had already read part of it.
        const enc = getEncodingFromOptions(options as Parameters<typeof getEncodingFromOptions>[0], 'buffer');
        return encodeUint8Array(enc, FileHandle.getInstance(path)._readToEndSync());
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
 * Synchronously creates a directory. Returns `undefined`, or if `recursive` is`true`, the first directory path created.
 * This is the synchronous version of {@link mkdir}.
 *
 * See the POSIX [`mkdir(2)`](http://man7.org/linux/man-pages/man2/mkdir.2.html) documentation for more details.
 * @since v0.1.21
 */
export function mkdirSync(
    path: PathLike,
    options: MakeDirectoryOptions & {
        recursive: true;
    },
): string | undefined;
/**
 * Synchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
export function mkdirSync(
    path: PathLike,
    options?:
        | Mode
        | (MakeDirectoryOptions & {
              recursive?: false | undefined;
          })
        | null,
): void;
/**
 * Synchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
export function mkdirSync(path: PathLike, options?: Mode | MakeDirectoryOptions | null): string | undefined | void;
/**
 * Synchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
export function mkdirSync(path: PathLike, options?: Mode | MakeDirectoryOptions | null): string | undefined | void {
    let recursive = false;
    let requested: Mode | undefined;

    if (options !== null && options !== undefined) {
        if (typeof options === 'object') {
            if (options.recursive) recursive = options.recursive;
            // `!== undefined`, not truthiness: `{ mode: 0 }` is a legitimate
            // request for an inaccessible directory and used to be replaced.
            if (options.mode !== undefined) requested = options.mode;
        } else {
            requested = options;
        }
    }

    path = normalizePath(path);
    // Node parses a string mode as OCTAL. The `TypeError('mode as string is
    // currently not supported!')` this replaces was the only place in the
    // package that rejected a documented argument outright.
    const mode = normalizeMode(requested, 0o777);

    if (recursive) return mkdirSyncRecursive(path, mode);

    mkdirWithMode(path, mode);
    return undefined;
}

/**
 * `mkdir(2)` with the mode the caller asked for.
 *
 * `Gio.File.make_directory()` takes no mode, which is why `mkdirSync` used to
 * drop it and why `mkdirSyncRecursive` carried a NOTE conceding as much.
 * `GLib.mkdir()` is plain `mkdir(2)`, so the KERNEL applies the mode — masked
 * by the live umask, with `S_ISGID` inherited from the parent and a requested
 * setuid/setgid dropped, which is exactly Node's asymmetry and needs no code
 * on this side to reproduce.
 */
function mkdirWithMode(pathStr: string, mode: number): void {
    if (GLib.mkdir(pathStr, mode) !== 0) throw classifyMkdirFailure(pathStr);
}

/**
 * Recursively creates directories, similar to `mkdir -p`.
 * Returns the first directory path created, or undefined if all directories already existed.
 *
 * Walks rather than calling `GLib.mkdir_with_parents()` because Node's return
 * value is the FIRST directory created, which the C helper cannot report.
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
 * Synchronous [`rmdir(2)`](http://man7.org/linux/man-pages/man2/rmdir.2.html). Returns `undefined`.
 *
 * Using `fs.rmdirSync()` on a file (not a directory) results in an `ENOENT` error
 * on Windows and an `ENOTDIR` error on POSIX.
 *
 * To get a behavior similar to the `rm -rf` Unix command, use {@link rmSync} with options `{ recursive: true, force: true }`.
 * @since v0.1.21
 */
export function rmdirSync(path: PathLike, _options?: RmDirOptions): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    try {
        // Check if it's a directory
        const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
        if (info.get_file_type() !== Gio.FileType.DIRECTORY) {
            const err = Object.assign(new Error(), { code: 4 }); // Gio.IOErrorEnum.NOT_DIRECTORY
            throw createNodeError(err, 'rmdir', pathStr);
        }
        // Check if empty — rmdir only removes empty directories (use rmSync for recursive)
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
 * Write a whole file through a descriptor, honouring `mode` and `flag`.
 *
 * `writeFileSync` had NO options parameter at all — it was a bare
 * `GLib.file_set_contents()` — so `fs.writeFileSync(p, secret, {mode: 0o600})`
 * silently produced a world-readable file and `{flag: 'wx'}` silently lost its
 * exclusivity. That is the same disclosure the handle path had, in the spelling
 * consumers actually use.
 */
function writeWholeFile(
    pathStr: string,
    data: string | Uint8Array,
    options: WriteFileOptions,
    defaultFlag: OpenFlags,
): void {
    const encoding = getEncodingFromOptions(options as Parameters<typeof getEncodingFromOptions>[0], 'utf8');
    const bag = typeof options === 'object' && options !== null ? options : {};
    const bytes = typeof data === 'string' ? Buffer.from(data, (encoding as BufferEncoding) || 'utf8') : data;

    const handle = new FileHandle({
        path: pathStr,
        flags: (bag.flag as OpenFlags) ?? defaultFlag,
        mode: bag.mode ?? 0o666,
    });
    try {
        handle._writeSync(bytes, null);
    } finally {
        handle._closeSync();
    }
}

export function writeFileSync(path: PathLike, data: string | Uint8Array, options?: WriteFileOptions) {
    writeWholeFile(normalizePath(path), data, options ?? null, 'w');
}

// --- rename ---

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

// --- copyFile ---

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
}

// --- access ---

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

// --- appendFile ---

export function appendFileSync(path: PathLike, data: string | Uint8Array, options?: WriteFileOptions): void {
    // The third parameter used to be named `_options` — declared, typed, and
    // thrown away, so a `{mode: 0o600}` append log came out world-readable.
    writeWholeFile(normalizePath(path), data, options ?? null, 'a');
}

// --- readlink ---

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

// --- link ---

export function linkSync(existingPath: PathLike, newPath: PathLike): void {
    const existingStr = normalizePath(existingPath);
    const newStr = normalizePath(newPath);
    // Neither Gio.File nor GLib exposes link(2) through introspection (there is
    // copy/move/make_symbolic_link, but no hard-link call), so the fallback is a
    // spawned `ln` — as an argv ARRAY via GLib.spawn_sync, NEVER a shell command
    // line: GLib.spawn_command_line_sync() word-splits and unquotes its input,
    // so a path containing a space produced a wrong argv and a path containing
    // shell metacharacters was a command-injection hazard.
    //
    // Node semantics are enforced up front, because bare `ln` diverges:
    //   - newPath already exists → EEXIST (link(2) never overwrites; `ln` into
    //     an existing DIRECTORY would create `<newPath>/<basename>` instead).
    //   - existingPath missing → ENOENT.
    // The lstat-style NOFOLLOW probes match link(2) on Linux (the source
    // symlink itself is linked, not its target).
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
    // `--` stops a dash-leading path from being parsed as an option. Under GJS
    // a failed spawn (ln not on PATH) throws a GLib.Error; a spawned `ln` that
    // EXITED non-zero only shows in the wait status, which
    // spawn_check_wait_status turns into a thrown GLib.Error too.
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
        // Throws a GLib.Error on a non-zero exit; the boolean return is
        // belt-and-suspenders for a binding that reports instead of throwing.
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

// --- truncate ---

export function truncateSync(path: PathLike, len?: number): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    try {
        // `replace()` + rewrite gave a NEW INODE, so every open descriptor on
        // this file was orphaned and any hard link stopped following it —
        // ftruncate(2) does neither. `open_readwrite().truncate()` is the real
        // operation: same inode, extends with zeros when growing.
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

// --- chmodSync ---

export function chmodSync(path: PathLike, mode: Mode): void {
    const pathStr = normalizePath(path);
    // One shared octal parser with open/mkdir/mkdtemp/writeFile, so the two
    // spellings of "mode" cannot drift apart again.
    const modeNum = normalizeMode(mode, 0o666);
    // Gio can chmod natively (G_FILE_ATTRIBUTE_UNIX_MODE is settable on local
    // files) — no subprocess. The previous `chmod` shell-out broke on any path
    // containing a space and never even checked the child's exit status.
    try {
        const file = Gio.File.new_for_path(pathStr);
        file.set_attribute_uint32('unix::mode', modeNum, Gio.FileQueryInfoFlags.NONE, null);
    } catch (err: unknown) {
        throw createNodeError(err, 'chmod', pathStr);
    }
}

// --- chownSync ---

export function chownSync(path: PathLike, uid: number, gid: number): void {
    const pathStr = normalizePath(path);
    // Gio can chown natively (unix::uid / unix::gid are settable on local
    // files) — no subprocess (same unquoted-shell-out bug class as chmodSync).
    // Node semantics: -1 leaves the respective id unchanged.
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

export function watch(
    filename: PathLike,
    options: { persistent?: boolean; recursive?: boolean; encoding?: string } | undefined,
    listener: ((eventType: string, filename: string | null) => void) | undefined,
) {
    return new FSWatcher(normalizePath(filename), options, listener);
}

export function openSync(path: PathLike, flags?: OpenFlags | number, mode?: Mode): FileHandle {
    return new FileHandle({ path, flags: flags as OpenFlags | undefined, mode });
}

/**
 * Returns the created directory path.
 *
 * For detailed information, see the documentation of the asynchronous version of
 * this API: {@link mkdtemp}.
 *
 * The optional `options` argument can be a string specifying an encoding, or an
 * object with an `encoding` property specifying the character encoding to use.
 * @since v5.10.0
 */
export function mkdtempSync(prefix: string, options?: EncodingOption): string;
/**
 * Synchronously creates a unique temporary directory.
 * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 */
export function mkdtempSync(prefix: string, options: BufferEncodingOption): Buffer;
/**
 * Synchronously creates a unique temporary directory.
 * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 */
export function mkdtempSync(prefix: string, options?: EncodingOption): string | Buffer;

export function mkdtempSync(prefix: string, options?: EncodingOption | BufferEncodingOption): string | Buffer {
    const encoding: string | undefined = getEncodingFromOptions(options);
    return decode(mkdtempAt(prefix), encoding);
}

/**
 * `mkdtemp(3)`: claim a unique name and create it 0700, atomically.
 *
 * TWO defects lived in the four lines this replaces. It asked `mkdirSync` for
 * `mode: 0o777` — inert while `mode` was ignored, and a WORLD-READABLE
 * directory the moment `mode` started working, from the one API whose whole
 * purpose is a private scratch space. And it picked the name with
 * `while (existsSync(path))`, a test-then-create whose `existsSync` was
 * `Gio.File.query_exists()` — true for a dangling symlink, and racy against
 * any other process regardless. `mkdir(2)` decides both questions in one
 * syscall: it fails EEXIST if the name is taken, so the loop retries instead
 * of guessing.
 *
 * Both entry points call THIS, so `mkdtempSync` and `promises.mkdtemp` cannot
 * disagree on the mode again — they already did, by 0o077.
 */
export function mkdtempAt(prefix: string): string {
    // mkdtemp(3) is specified as `mkdir(pathname, S_IRWXU)`; the umask can only
    // make it tighter, never looser, so this is a ceiling and not a request.
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

/**
 * Synchronously removes files and directories (modeled on the standard POSIX `rm`utility). Returns `undefined`.
 * @since v14.14.0
 */
export function rmSync(path: PathLike, options?: RmOptions): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    const recursive = options?.recursive || false;
    const force = options?.force || false;

    // Probe the top-level path with NOFOLLOW so a symlink is identified as
    // such — `new Dirent(pathStr)` (default `Gio.FileQueryInfoFlags.NONE`)
    // follows symlinks and reports a symlink-to-directory as a directory,
    // which then walks the TARGET's children into the recursive `rmSync`
    // descent below — the workspace-source-wipe data-loss bug: calling
    // `rmSync(<root>/node_modules/@pkg/foo, { recursive: true })` where the
    // path is a symlink to `packages/foo` would delete every file under
    // packages/foo. Node's `fs.rmSync` removes a top-level symlink as a
    // single entry, never descending into the target — match that.
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
        // Use plain `readdirSync` (no withFileTypes) — the recursive call
        // re-stats each child anyway, so allocating + holding Dirent
        // objects per level just adds GC pressure. The pre-collected name
        // list also lets `readdirSync`'s enumerator close before the first
        // recursive call descends, keeping the live fd count bounded by
        // recursion depth × 1 (see readdirSync header for the EMFILE-on-
        // deep-trees rationale).
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
