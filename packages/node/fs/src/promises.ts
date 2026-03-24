// Reference: Node.js lib/internal/fs/promises.js
// Reimplemented for GJS using Gio.File

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { warnNotImplemented } from '@gjsify/utils';
import { join, dirname } from 'path';
import { getEncodingFromOptions, encodeUint8Array, decode } from './encoding.js';
import { rmdirSync, unlinkSync, realpathSync, readdirSync as readdirSyncFn } from './sync.js';
import { FileHandle } from './file-handle.js';
import { tempDirPath } from './utils.js';
import { Dirent } from './dirent.js';
import { Stats, BigIntStats, STAT_ATTRIBUTES } from './stats.js';
import { createNodeError } from './errors.js';

import type { 
  OpenFlags,
  ReadOptions,
} from './types/index.js';
import type {
  PathLike,
  Mode,
  RmOptions,
  ObjectEncodingOptions,
  BufferEncodingOption,
  MakeDirectoryOptions,
  RmDirOptions
} from 'fs';

/**
 * Asynchronously creates a directory.
 *
 * The optional `options` argument can be an integer specifying `mode` (permission
 * and sticky bits), or an object with a `mode` property and a `recursive`property indicating whether parent directories should be created. Calling`fsPromises.mkdir()` when `path` is a directory
 * that exists results in a
 * rejection only when `recursive` is false.
 * @since v10.0.0
 * @return Upon success, fulfills with `undefined` if `recursive` is `false`, or the first directory path created if `recursive` is `true`.
 */
async function mkdir(
  path: PathLike,
  options: MakeDirectoryOptions & {
    recursive: true;
  }
): Promise<string | undefined>;
/**
 * Asynchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
async function mkdir(
  path: PathLike,
  options?:
      | Mode
      | (MakeDirectoryOptions & {
            recursive?: false | undefined;
        })
      | null
): Promise<void>;
/**
 * Asynchronous mkdir(2) - create a directory.
 * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
 * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
 * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
 */
async function mkdir(path: PathLike, options?: Mode | MakeDirectoryOptions | null): Promise<string | undefined> 

async function mkdir(path: PathLike, options?: Mode | MakeDirectoryOptions | null): Promise<string | undefined | void> {

  let recursive: boolean | undefined;
  let _mode: Mode | undefined = 0o777;

  if (typeof options === 'object') {
    if(options.recursive) recursive = options.recursive;
    if(options.mode) _mode = options.mode
  } else {
    _mode = options;
  }

  const pathStr = path.toString();

  if (recursive) {
    return mkdirRecursiveAsync(pathStr);
  }

  const file = Gio.File.new_for_path(pathStr);
  return new Promise<undefined>((resolve, reject) => {
    file.make_directory_async(GLib.PRIORITY_DEFAULT, null, (_s: any, res: Gio.AsyncResult) => {
      try {
        file.make_directory_finish(res);
        resolve(undefined);
      } catch (err: any) {
        reject(createNodeError(err, 'mkdir', path));
      }
    });
  });
}

/**
 * Recursively creates directories, similar to `mkdir -p`.
 * Returns the first directory path created, or undefined if all directories already existed.
 */
async function mkdirRecursiveAsync(pathStr: string): Promise<string | undefined> {
  const file = Gio.File.new_for_path(pathStr);

  // Try to create the directory directly first
  try {
    await new Promise<void>((resolve, reject) => {
      file.make_directory_async(GLib.PRIORITY_DEFAULT, null, (_s: any, res: Gio.AsyncResult) => {
        try {
          file.make_directory_finish(res);
          resolve();
        } catch (err: any) {
          reject(err);
        }
      });
    });
    // This directory was created; it's the deepest one.
    // Now check if we also created parents by recursing on the parent first.
    // Since we succeeded directly, this is the "first created" path candidate.
    return pathStr;
  } catch (err: any) {
    // If it already exists, nothing to create
    if (err.code === Gio.IOErrorEnum.EXISTS) {
      return undefined;
    }
    // If parent doesn't exist, create parent first then retry
    if (err.code === Gio.IOErrorEnum.NOT_FOUND) {
      const parentPath = dirname(pathStr);
      if (parentPath === pathStr) {
        // Reached root, cannot go further
        throw createNodeError(err, 'mkdir', pathStr);
      }
      const firstCreated = await mkdirRecursiveAsync(parentPath);
      // Now create this directory
      const retryFile = Gio.File.new_for_path(pathStr);
      await new Promise<void>((resolve, reject) => {
        retryFile.make_directory_async(GLib.PRIORITY_DEFAULT, null, (_s: any, res: Gio.AsyncResult) => {
          try {
            retryFile.make_directory_finish(res);
            resolve();
          } catch (retryErr: any) {
            reject(createNodeError(retryErr, 'mkdir', pathStr));
          }
        });
      });
      return firstCreated ?? pathStr;
    }
    throw createNodeError(err, 'mkdir', pathStr);
  }
}

async function readFile(path: PathLike | FileHandle, options: ReadOptions = { encoding: null, flag: 'r' }) {
  const file = Gio.File.new_for_path(path.toString());

  const [ok, data] = await new Promise<[boolean, Uint8Array, string]>((resolve, reject) => {
    file.load_contents_async(null, (self, res) => {
      try {
        resolve(file.load_contents_finish(res));
      } catch (error) {
        reject(error);
      }
    });
  });

  if (!ok) {
    // TODO: throw a better error
    throw new Error('failed to read file');
  }

  return encodeUint8Array(getEncodingFromOptions(options, 'buffer'), data);
}

/**
 * Creates a unique temporary directory. A unique directory name is generated by
 * appending six random characters to the end of the provided `prefix`. Due to
 * platform inconsistencies, avoid trailing `X` characters in `prefix`. Some
 * platforms, notably the BSDs, can return more than six random characters, and
 * replace trailing `X` characters in `prefix` with random characters.
 *
 * The optional `options` argument can be a string specifying an encoding, or an
 * object with an `encoding` property specifying the character encoding to use.
 *
 * ```js
 * import { mkdtemp } from 'fs/promises';
 *
 * try {
 *   await mkdtemp(path.join(os.tmpdir(), 'foo-'));
 * } catch (err) {
 *   console.error(err);
 * }
 * ```
 *
 * The `fsPromises.mkdtemp()` method will append the six randomly selected
 * characters directly to the `prefix` string. For instance, given a directory`/tmp`, if the intention is to create a temporary directory _within_`/tmp`, the`prefix` must end with a trailing
 * platform-specific path separator
 * (`require('path').sep`).
 * @since v10.0.0
 * @return Fulfills with a string containing the filesystem path of the newly created temporary directory.
 */
 async function mkdtemp(prefix: string, options?: ObjectEncodingOptions | BufferEncoding | null): Promise<string>;
/**
 * Asynchronously creates a unique temporary directory.
 * Generates six random characters to be appended behind a required `prefix` to create a unique temporary directory.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 */
async function mkdtemp(prefix: string, options: BufferEncodingOption): Promise<Buffer>;
/**
 * Asynchronously creates a unique temporary directory.
 * Generates six random characters to be appended behind a required `prefix` to create a unique temporary directory.
 * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
 */
async function mkdtemp(prefix: string, options?: ObjectEncodingOptions | BufferEncoding | null): Promise<string | Buffer>;

async function mkdtemp(prefix: string, options?: BufferEncodingOption | ObjectEncodingOptions | BufferEncoding | null): Promise<string | Buffer> {
  const encoding: string | undefined = getEncodingFromOptions(options);
  const path = tempDirPath(prefix);

  await mkdir(
    path,
    { recursive: false, mode: 0o700 }
  )

  return decode(path, encoding);
}

async function writeFile(path: string, data: any) {
  const file = Gio.File.new_for_path(path);

  // Convert data to Uint8Array if it's a string
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    // Fallback: convert to string first
    bytes = new TextEncoder().encode(String(data));
  }

  const glibBytes = new GLib.Bytes(bytes);

  // Open the file for writing (replace contents), creating if needed
  const outputStream = await new Promise<Gio.FileOutputStream>((resolve, reject) => {
    file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null, (_s: any, res: Gio.AsyncResult) => {
      try {
        resolve(file.replace_finish(res));
      } catch (err: any) {
        reject(createNodeError(err, 'open', path));
      }
    });
  });

  // Write the bytes to the stream
  await new Promise<void>((resolve, reject) => {
    outputStream.write_bytes_async(glibBytes, GLib.PRIORITY_DEFAULT, null, (_s: any, res: Gio.AsyncResult) => {
      try {
        outputStream.write_bytes_finish(res);
        resolve();
      } catch (err: any) {
        reject(createNodeError(err, 'write', path));
      }
    });
  });

  // Close the output stream
  await new Promise<void>((resolve, reject) => {
    outputStream.close_async(GLib.PRIORITY_DEFAULT, null, (_s: any, res: Gio.AsyncResult) => {
      try {
        outputStream.close_finish(res);
        resolve();
      } catch (err: any) {
        reject(createNodeError(err, 'close', path));
      }
    });
  });
}

/**
 * Removes the directory identified by `path`.
 *
 * Using `fsPromises.rmdir()` on a file (not a directory) results in the
 * promise being rejected with an `ENOENT` error on Windows and an `ENOTDIR`error on POSIX.
 *
 * To get a behavior similar to the `rm -rf` Unix command, use `fsPromises.rm()` with options `{ recursive: true, force: true }`.
 * @since v10.0.0
 * @return Fulfills with `undefined` upon success.
 */
async function rmdir(path: PathLike, options?: RmDirOptions): Promise<void> {
  // TODO async
  return rmdirSync(path, options);
}

async function unlink(path: string) {
  // TODO async
  return unlinkSync(path);
}

async function open(path: PathLike, flags?: OpenFlags, mode?: Mode): Promise<FileHandle> {
  return new FileHandle({
    path,
    flags,
    mode,
  });
}

async function write<TBuffer extends Uint8Array>(
  fd: number,
  buffer: TBuffer,
  offset?: number | null,
  length?: number | null,
  position?: number | null
): Promise<{
  bytesWritten: number;
  buffer: TBuffer;
}>

async function write(
  fd: number,
  data: string,
  position?: number | null,
  encoding?: BufferEncoding | null
): Promise<{
  bytesWritten: number;
  buffer: string;
}>

async function write<TBuffer extends Uint8Array>(
  fd: number,
  data: string | TBuffer,
  positionOrOffset?: number | null,
  encodingOrLength?: BufferEncoding | null | number,
  position?: number | null
): Promise<{
  bytesWritten: number;
  buffer: string;
}> {
  if(typeof data === 'string') {
    return _writeStr(fd, data, positionOrOffset, encodingOrLength as BufferEncoding | null);
  }
  return _writeBuf<any>(fd, data, positionOrOffset as number | null, encodingOrLength as  null | number, position);
}

async function _writeBuf<TBuffer extends Uint8Array>(
  fd: number,
  buffer: TBuffer,
  offset?: number | null,
  length?: number | null,
  position?: number | null
): Promise<{
  bytesWritten: number;
  buffer: TBuffer;
}> {
  warnNotImplemented("fs.promises.write");
  return {
    bytesWritten: 0,
    buffer
  }
}

async function _writeStr(
  fd: number,
  data: string,
  position?: number | null,
  encoding?: BufferEncoding | null
): Promise<{
  bytesWritten: number;
  buffer: string;
}> {
  warnNotImplemented("fs.promises.write");
  return {
    bytesWritten: 0,
    buffer: data,
  }
}

// --- helpers ---

function queryInfoAsync(path: PathLike, flags: Gio.FileQueryInfoFlags, syscall: string, options?: { bigint?: boolean }): Promise<Stats | BigIntStats> {
  return new Promise((resolve, reject) => {
    const file = Gio.File.new_for_path(path.toString());
    file.query_info_async(STAT_ATTRIBUTES, flags, GLib.PRIORITY_DEFAULT, null, (_s: any, res: Gio.AsyncResult) => {
      try {
        const info = file.query_info_finish(res);
        resolve(options?.bigint ? new BigIntStats(info, path) : new Stats(info, path));
      } catch (err: any) {
        reject(createNodeError(err, syscall, path));
      }
    });
  });
}

// --- stat / lstat ---

async function stat(path: PathLike, options?: { bigint?: boolean }): Promise<Stats | BigIntStats> {
  return queryInfoAsync(path, Gio.FileQueryInfoFlags.NONE, 'stat', options);
}

async function lstat(path: PathLike, options?: { bigint?: boolean }): Promise<Stats | BigIntStats> {
  return queryInfoAsync(path, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, 'lstat', options);
}

// --- readdir / realpath / symlink — delegate to sync (sync is the canonical impl) ---

async function readdir(path: PathLike, options?: { withFileTypes?: boolean; encoding?: string; recursive?: boolean }): Promise<string[] | Dirent[]> {
  return readdirSyncFn(path, options);
}

async function realpath(path: PathLike): Promise<string> {
  return realpathSync(path);
}

async function symlink(target: PathLike, path: PathLike, _type?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = Gio.File.new_for_path(path.toString());
    file.make_symbolic_link_async(target.toString(), GLib.PRIORITY_DEFAULT, null, (_s: any, res: Gio.AsyncResult) => {
      try {
        file.make_symbolic_link_finish(res);
        resolve();
      } catch (err: any) {
        reject(createNodeError(err, 'symlink', target, path));
      }
    });
  });
}

/**
 * Removes files and directories (modeled on the standard POSIX `rm` utility).
 * @since v14.14.0
 * @return Fulfills with `undefined` upon success.
 */
async function rm(path: PathLike, options?: RmOptions): Promise<void> {
  const file = Gio.File.new_for_path(path.toString());

  const recursive = options?.recursive || false;

  const dirent = new Dirent(path.toString());

  if (dirent.isDirectory()) {
    const childFiles = await readdir(path, { withFileTypes: true });

    if (!recursive && childFiles.length) {
      throw new Error('Dir is not empty!');
    }

    for (const childFile of childFiles) {
      if (typeof childFile !== 'string') {
        await rm(join(path.toString(), childFile.name), options);
      }
    }
  }

  const ok = await new Promise<boolean>((resolve, reject) => {
    try {
      file.delete_async(GLib.PRIORITY_DEFAULT, null, (self, res) => {
        try {
          resolve(file.delete_finish(res));
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }

  });

  if (!ok) {
    const err = new Error('failed to remove file ' + path);
    throw err;
  }
}

export {
  readFile,
  mkdir,
  mkdtemp,
  realpath,
  readdir,
  writeFile,
  rmdir,
  unlink,
  open,
  write,
  rm,
  lstat,
  symlink,
  stat,
};

export default {
  readFile,
  mkdir,
  mkdtemp,
  realpath,
  readdir,
  writeFile,
  rmdir,
  unlink,
  open,
  write,
  rm,
  lstat,
  symlink,
  stat,
};