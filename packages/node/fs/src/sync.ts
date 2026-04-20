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
import { tempDirPath, normalizePath } from './utils.js';

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

export { existsSync }

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
  options?: { withFileTypes?: boolean; encoding?: string; recursive?: boolean }
): string[] | Dirent[] {
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);
  const enumerator = file.enumerate_children(
    'standard::name,standard::type',
    Gio.FileQueryInfoFlags.NONE,
    null,
  );

  const result: (string | Dirent)[] = [];
  let info = enumerator.next_file(null);

  while (info !== null) {
    const childName = info.get_name();
    const childPath = join(pathStr, childName);

    if (options?.withFileTypes) {
      result.push(new Dirent(childPath, childName));
    } else {
      result.push(childName);
    }

    if (options?.recursive && info.get_file_type() === Gio.FileType.DIRECTORY) {
      const subEntries = readdirSync(childPath, options);
      for (const entry of subEntries) {
        if (typeof entry === 'string') {
          result.push(join(childName, entry));
        } else {
          result.push(entry);
        }
      }
    }

    info = enumerator.next_file(null);
  }

  return result as string[] | Dirent[];
}

// --- realpath ---

const MAX_SYMLINK_DEPTH = 40; // matches Linux MAXSYMLINKS

export function realpathSync(path: PathLike): string {
  const pathStr = normalizePath(path);
  let current = Gio.File.new_for_path(pathStr);
  let depth = 0;

  while (true) {
    const info = current.query_info(
      'standard::is-symlink,standard::symlink-target',
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );

    if (!info.get_is_symlink()) {
      return current.get_path()!;
    }

    const target = info.get_symlink_target()!;
    const parent = current.get_parent();
    current = parent ? parent.resolve_relative_path(target) : Gio.File.new_for_path(target);

    if (++depth > MAX_SYMLINK_DEPTH) {
      throw new Error(`ELOOP: too many levels of symbolic links, realpath '${pathStr}'`);
    }
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

export function readFileSync(path: PathLike, options: any = { encoding: null, flag: 'r' }) {
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);

  try {
    const [ok, data] = file.load_contents(null);

    if (!ok) {
      throw createNodeError(new Error('failed to read file'), 'read', pathStr);
    }

    return encodeUint8Array(getEncodingFromOptions(options, "buffer"), data);
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
  }
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
      | null
): void;
/**
 * Synchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
export function mkdirSync(path: PathLike, options?: Mode | MakeDirectoryOptions | null): string | undefined | void
/**
 * Synchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
export function mkdirSync(path: PathLike, options?: Mode | MakeDirectoryOptions | null): string | undefined | void {

  let recursive = false
  let mode: Mode | undefined = 0o777;

  if (typeof options === 'object') {
    if(options?.recursive) recursive = options.recursive;
    if(options?.mode) mode = options.mode;
  } else {
    mode = options || 0o777;
  }

  path = normalizePath(path);

  if(typeof mode === 'string') {
    throw new TypeError("mode as string is currently not supported!");
  }

  if (recursive) {
    return mkdirSyncRecursive(path, mode as number);
  }

  // Non-recursive: create a single directory
  const file = Gio.File.new_for_path(path);
  try {
    file.make_directory(null);
  } catch (err: unknown) {
    throw createNodeError(err, 'mkdir', path);
  }
  return undefined;
}

/**
 * Recursively creates directories, similar to `mkdir -p`.
 * Returns the first directory path created, or undefined if all directories already existed.
 */
function mkdirSyncRecursive(pathStr: string, mode: number): string | undefined {
  const file = Gio.File.new_for_path(pathStr);

  // Try to create the directory directly
  try {
    file.make_directory(null);
    // This directory was created successfully — it's a candidate for "first created"
    return pathStr;
  } catch (err: unknown) {
    const gErr = err as { code?: number };
    // If it already exists, nothing to create
    if (gErr.code === Gio.IOErrorEnum.EXISTS) {
      return undefined;
    }
    // If parent doesn't exist, create parent first then retry
    if (gErr.code === Gio.IOErrorEnum.NOT_FOUND) {
      const parentPath = join(pathStr, '..');
      const resolvedParent = Gio.File.new_for_path(parentPath).get_path()!;
      if (resolvedParent === pathStr) {
        // Reached root, cannot go further
        throw createNodeError(err, 'mkdir', pathStr);
      }
      const firstCreated = mkdirSyncRecursive(resolvedParent, mode);
      // Now create this directory
      const retryFile = Gio.File.new_for_path(pathStr);
      try {
        retryFile.make_directory(null);
      } catch (retryErr: unknown) {
        throw createNodeError(retryErr, 'mkdir', pathStr);
      }
      return firstCreated ?? pathStr;
    }
    throw createNodeError(err, 'mkdir', pathStr);
  }
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

export function writeFileSync(path: PathLike, data: string | Uint8Array) {
  GLib.file_set_contents(normalizePath(path), data);
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
      if ((mode & 4) && !info.get_attribute_boolean('access::can-read')) {
        throw createNodeError(permErr, 'access', pathStr);
      }
      if ((mode & 2) && !info.get_attribute_boolean('access::can-write')) {
        throw createNodeError(permErr, 'access', pathStr);
      }
      if ((mode & 1) && !info.get_attribute_boolean('access::can-execute')) {
        throw createNodeError(permErr, 'access', pathStr);
      }
    }
  } catch (err: unknown) {
    if ((err as { code?: unknown }).code && typeof (err as { code?: unknown }).code === 'string') throw err; // Already a Node-style error
    throw createNodeError(err, 'access', pathStr);
  }
}

// --- appendFile ---

export function appendFileSync(path: PathLike, data: string | Uint8Array, options?: { encoding?: string; mode?: number; flag?: string } | string): void {
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else {
    bytes = data;
  }

  try {
    const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
    if (bytes.length > 0) {
      stream.write_bytes(new GLib.Bytes(bytes), null);
    }
    stream.close(null);
  } catch (err: unknown) {
    throw createNodeError(err, 'appendfile', pathStr);
  }
}

// --- readlink ---

export function readlinkSync(path: PathLike, options?: { encoding?: string } | string): string | Buffer {
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);
  try {
    const info = file.query_info('standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    const target = info.get_symlink_target();
    if (!target) {
      throw Object.assign(new Error(`EINVAL: invalid argument, readlink '${pathStr}'`), { code: 'EINVAL', errno: -22, syscall: 'readlink', path: pathStr });
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
  // Gio doesn't have a direct hard link API, use GLib
  const result = GLib.spawn_command_line_sync(`ln ${existingStr} ${newStr}`);
  if (!result[0]) {
    throw Object.assign(new Error(`EPERM: operation not permitted, link '${existingStr}' -> '${newStr}'`), { code: 'EPERM', errno: -1, syscall: 'link', path: existingStr, dest: newStr });
  }
}

// --- truncate ---

export function truncateSync(path: PathLike, len?: number): void {
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);
  try {
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    if (len && len > 0) {
      // Read existing content, truncate to len
      const [, data] = file.load_contents(null);
      const truncated = data.slice(0, len);
      if (truncated.length > 0) {
        stream.write_bytes(new GLib.Bytes(truncated), null);
      }
    }
    stream.close(null);
  } catch (err: unknown) {
    throw createNodeError(err, 'truncate', pathStr);
  }
}

// --- chmodSync ---

export function chmodSync(path: PathLike, mode: Mode): void {
  const pathStr = normalizePath(path);
  const modeNum = typeof mode === 'string' ? parseInt(mode, 8) : mode;
  const result = GLib.spawn_command_line_sync(`chmod ${modeNum.toString(8)} ${pathStr}`);
  if (!result[0]) {
    throw Object.assign(new Error(`EPERM: operation not permitted, chmod '${pathStr}'`), { code: 'EPERM', errno: -1, syscall: 'chmod', path: pathStr });
  }
}

// --- chownSync ---

export function chownSync(path: PathLike, uid: number, gid: number): void {
  const pathStr = normalizePath(path);
  const result = GLib.spawn_command_line_sync(`chown ${uid}:${gid} ${pathStr}`);
  if (!result[0]) {
    throw Object.assign(new Error(`EPERM: operation not permitted, chown '${pathStr}'`), { code: 'EPERM', errno: -1, syscall: 'chown', path: pathStr });
  }
}

export function watch(filename: PathLike, options: { persistent?: boolean; recursive?: boolean; encoding?: string } | undefined, listener: ((eventType: string, filename: string | null) => void) | undefined) {
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
  const path = tempDirPath(prefix);

  mkdirSync(
    path,
    { recursive: false, mode: 0o777 }
  )

  return decode(path, encoding);
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

  let dirent: Dirent;
  try {
    dirent = new Dirent(pathStr);
  } catch (err: unknown) {
    if (force && isNotFoundError(err)) return;
    throw createNodeError(err, 'rm', path);
  }

  if (dirent.isDirectory()) {
    const childFiles = readdirSync(path, { withFileTypes: true });

    if (!recursive && childFiles.length) {
      const err = Object.assign(new Error(), { code: 5 }); // Gio.IOErrorEnum.NOT_EMPTY
      throw createNodeError(err, 'rm', path);
    }

    for (const childFile of childFiles) {
      if (typeof childFile !== 'string') {
        rmSync(join(pathStr, childFile.name), options);
      }
    }
  }

  try {
    file.delete(null);
  } catch (err: unknown) {
    if (force && isNotFoundError(err)) return;
    throw createNodeError(err, 'rm', path);
  }
}