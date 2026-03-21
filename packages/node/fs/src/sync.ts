import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { existsSync } from '@gjsify/utils';
import { Buffer } from 'buffer';
import { join } from 'path';

import FSWatcher from './fs-watcher.js';
import { getEncodingFromOptions, encodeUint8Array, decode } from './encoding.js';
import { FileHandle } from './file-handle.js';
import { Dirent } from './dirent.js';
import { Stats, BigIntStats, STAT_ATTRIBUTES } from './stats.js';
import { createNodeError, isNotFoundError } from './errors.js';
import { tempDirPath } from './utils.js';

import type { OpenFlags, EncodingOption } from './types/index.js';
import type {
  PathLike,
  Mode,
  MakeDirectoryOptions,
  BufferEncodingOption,
  RmOptions,
  RmDirOptions,
  StatSyncOptions,
} from 'fs'; // Types from @types/node

export { existsSync }

// --- stat / lstat ---

export function statSync(path: PathLike, options?: StatSyncOptions): Stats | BigIntStats | undefined {
  try {
    const file = Gio.File.new_for_path(path.toString());
    const info = file.query_info(STAT_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, null);
    return options?.bigint ? new BigIntStats(info, path) : new Stats(info, path);
  } catch (err: any) {
    if (options?.throwIfNoEntry === false && isNotFoundError(err)) return undefined;
    throw createNodeError(err, 'stat', path);
  }
}

export function lstatSync(path: PathLike, options?: StatSyncOptions): Stats | BigIntStats | undefined {
  try {
    const file = Gio.File.new_for_path(path.toString());
    const info = file.query_info(STAT_ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    return options?.bigint ? new BigIntStats(info, path) : new Stats(info, path);
  } catch (err: any) {
    if (options?.throwIfNoEntry === false && isNotFoundError(err)) return undefined;
    throw createNodeError(err, 'lstat', path);
  }
}

// --- readdir ---

export function readdirSync(
  path: PathLike,
  options?: { withFileTypes?: boolean; encoding?: string; recursive?: boolean }
): string[] | Dirent[] {
  const pathStr = path.toString();
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

  return result as any;
}

// --- realpath ---

const MAX_SYMLINK_DEPTH = 40; // matches Linux MAXSYMLINKS

export function realpathSync(path: PathLike): string {
  let current = Gio.File.new_for_path(path.toString());
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
      throw new Error(`ELOOP: too many levels of symbolic links, realpath '${path}'`);
    }
  }
}
(realpathSync as any).native = realpathSync;

// --- symlink ---

export function symlinkSync(target: PathLike, path: PathLike, _type?: 'file' | 'dir' | 'junction'): void {
  const file = Gio.File.new_for_path(path.toString());
  file.make_symbolic_link(target.toString(), null);
}

export function readFileSync(path: string, options = { encoding: null, flag: 'r' }) {
  const file = Gio.File.new_for_path(path);

  const [ok, data] = file.load_contents(null);

  if (!ok) {
    // TODO: throw a better error
    throw new Error('failed to read file');
  }

  return encodeUint8Array(getEncodingFromOptions(options, "buffer"), data);
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

  if (typeof path !== 'string') {
    path = path.toString();
  }

  if(typeof mode === 'string') {
    throw new TypeError("mode as string is currently not supported!");
  }

  if (GLib.mkdir_with_parents(path, mode) !== 0) {
    // TODO: throw a better error
    throw new Error(`failed to make ${path} directory`);
  }

  if (recursive) {
    // TODO: Returns `undefined`, or if `recursive` is`true`, the first directory path created.
    return path.split('/')[0];
  }
  return undefined;
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
export function rmdirSync(path: PathLike, options?: RmDirOptions): void {

  const childFiles = readdirSync(path, { withFileTypes: true });

  if (childFiles.length) {
    throw new Error('Dir is not empty!');
  }

  const result = GLib.rmdir(path.toString());

  if (result !== 0) {
    // TODO: throw a better error
    throw new Error(`Failed to remove ${path} directory`);
  }
}

export function unlinkSync(path: string) {
  GLib.unlink(path);
}

export function writeFileSync(path: string, data: any) {
  GLib.file_set_contents(path, data);
}

export function watch(filename: string, options, listener) {
  return new FSWatcher(filename, options, listener);
}

export function openSync(path: PathLike, flags?: OpenFlags, mode?: Mode): FileHandle {
  return new FileHandle({ path, flags, mode });
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
  const file = Gio.File.new_for_path(path.toString());
  const recursive = options?.recursive || false;

  const dirent = new Dirent(path.toString());

  if (dirent.isDirectory()) {
    const childFiles = readdirSync(path, { withFileTypes: true });

    if (!recursive && childFiles.length) {
      throw new Error('Dir is not empty!');
    }
  
    for (const childFile of childFiles) {
      if (typeof childFile !== 'string') {
        rmSync(join(path.toString(), childFile.name), options);
      }
    }
  }

  const ok = file.delete(null);

  if (!ok) {
    // TODO: throw a better error
    const err = new Error('failed to remove file ' + path);
    throw err;
  }
}