import GLib from '@gjsify/types/GLib-2.0';
import Gio from '@gjsify/types/Gio-2.0';
import { Buffer } from 'buffer';
import { join } from 'path';

import FSWatcher from './fs-watcher';
import { getEncodingFromOptions, encodeUint8Array, decode } from './encoding.js';
import { FileHandle } from './file-handle.js';
import { Dirent } from './dirent.js';
import { tempDirPath } from './utils.js';

import type { PathLike, Mode, OpenFlags, MakeDirectoryOptions, BufferEncodingOption, EncodingOption, RmOptions, RmDirOptions } from './types/index.js';
import type { ObjectEncodingOptions } from 'fs'; // Types from @types/node

export function existsSync(path: string) {
  // TODO: accept buffer and URL too
  if (typeof path !== 'string' || path === '') {
    return false;
  }

  const file = Gio.File.new_for_path(path);
  return file.query_exists(null);
}

/**
 * Reads the contents of the directory.
 *
 * See the POSIX [`readdir(3)`](http://man7.org/linux/man-pages/man3/readdir.3.html) documentation for more details.
 *
 * The optional `options` argument can be a string specifying an encoding, or an
 * object with an `encoding` property specifying the character encoding to use for
 * the filenames returned. If the `encoding` is set to `'buffer'`,
 * the filenames returned will be passed as `Buffer` objects.
 *
 * If `options.withFileTypes` is set to `true`, the result will contain `fs.Dirent` objects.
 * @since v0.1.21
 */
export function readdirSync(
  path: PathLike,
  options?:
      | {
            encoding: BufferEncoding | null;
            withFileTypes?: false | undefined;
        }
      | BufferEncoding
      | null
): string[];
/**
 * Synchronous readdir(3) - read a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 */
export function readdirSync(
  path: PathLike,
  options:
      | {
            encoding: 'buffer';
            withFileTypes?: false | undefined;
        }
      | 'buffer'
): Buffer[];
/**
 * Synchronous readdir(3) - read a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 */
export function readdirSync(
  path: PathLike,
  options?:
      | (ObjectEncodingOptions & {
            withFileTypes?: false | undefined;
        })
      | BufferEncoding
      | null
): string[] | Buffer[];
/**
 * Synchronous readdir(3) - read a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options If called with `withFileTypes: true` the result data will be an array of Dirent.
 */
export function readdirSync(
  path: PathLike,
  options: ObjectEncodingOptions & {
      withFileTypes: true;
  }
): Dirent[];

export function readdirSync(path: string, options: (BufferEncodingOption | ObjectEncodingOptions) & { withFileTypes?: boolean } | BufferEncoding = 'utf8'): Buffer[] | Dirent[] | string[] {
  const encoding = getEncodingFromOptions(options);
  const withFileTypes = typeof options === 'object' ? options.withFileTypes: false;
  const dir = Gio.File.new_for_path(path);
  let list: any[] = [];

  const enumerator = dir.enumerate_children('standard::*', 0, null);
  let info = enumerator.next_file(null);

  while (info) {
    const child = enumerator.get_child(info);
    const fileName = child.get_basename();

    if (encoding === 'buffer') {
      const encodedName = Buffer.from(fileName);
      list.push(encodedName);
    } else {
      const encodedName = Buffer.from(fileName).toString(encoding);
      list.push(encodedName);
    }

    info = enumerator.next_file(null);    
  }


  if (withFileTypes) {
    list = list.map((filename: string | Buffer) => {
      if (filename instanceof Buffer) {
        filename = filename.toString();
      }
      return new Dirent(join(path, filename), filename);
    });
  }

  return list;
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

  const recursive = options?.recursive || false;

  const childFiles = readdirSync(path, { withFileTypes: true });

  if (!recursive && childFiles.length) {
    throw new Error('Dir is not empty!');
  }

  for (const childFile of childFiles) {
    if (childFile.isDirectory()) {
      rmdirSync(join(path.toString(), childFile.name));
    } else if (childFile.isFile()) {
      rmSync(join(path.toString(), childFile.name));
    }
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
      if (childFile.isDirectory()) {
        rmdirSync(join(path.toString(), childFile.name), options);
      } else if (childFile.isFile()) {
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