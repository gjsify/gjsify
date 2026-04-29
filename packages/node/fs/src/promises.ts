// Reference: Node.js lib/internal/fs/promises.js
// Reimplemented for GJS using Gio.File

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { join, dirname } from 'node:path';
import { getEncodingFromOptions, encodeUint8Array, decode } from './encoding.js';
import { realpathSync, readdirSync as readdirSyncFn, renameSync, copyFileSync, accessSync, appendFileSync, readlinkSync, truncateSync, chmodSync, chownSync, linkSync } from './sync.js';
import { cpAsync } from './cp.js';
import { FileHandle } from './file-handle.js';
import { tempDirPath, normalizePath } from './utils.js';
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
} from 'node:fs';

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

  const pathStr = normalizePath(path);

  if (recursive) {
    return mkdirRecursiveAsync(pathStr);
  }

  const file = Gio.File.new_for_path(pathStr);
  return new Promise<undefined>((resolve, reject) => {
    file.make_directory_async(GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        file.make_directory_finish(res);
        resolve(undefined);
      } catch (err: unknown) {
        reject(createNodeError(err, 'mkdir', pathStr));
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
      file.make_directory_async(GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
        try {
          file.make_directory_finish(res);
          resolve();
        } catch (err: unknown) {
          reject(err);
        }
      });
    });
    // This directory was created; it's the deepest one.
    // Now check if we also created parents by recursing on the parent first.
    // Since we succeeded directly, this is the "first created" path candidate.
    return pathStr;
  } catch (err: unknown) {
    const gErr = err as { code?: number };
    // If it already exists, nothing to create
    if (gErr.code === Gio.IOErrorEnum.EXISTS) {
      return undefined;
    }
    // If parent doesn't exist, create parent first then retry
    if (gErr.code === Gio.IOErrorEnum.NOT_FOUND) {
      const parentPath = dirname(pathStr);
      if (parentPath === pathStr) {
        // Reached root, cannot go further
        throw createNodeError(err, 'mkdir', pathStr);
      }
      const firstCreated = await mkdirRecursiveAsync(parentPath);
      // Now create this directory
      const retryFile = Gio.File.new_for_path(pathStr);
      await new Promise<void>((resolve, reject) => {
        retryFile.make_directory_async(GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
          try {
            retryFile.make_directory_finish(res);
            resolve();
          } catch (retryErr: unknown) {
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
  const pathStr = normalizePath(path as PathLike);
  const file = Gio.File.new_for_path(pathStr);

  let ok: boolean;
  let data: Uint8Array;
  try {
    [ok, data] = await new Promise<[boolean, Uint8Array, string]>((resolve, reject) => {
      file.load_contents_async(null, (self, res) => {
        try {
          resolve(file.load_contents_finish(res));
        } catch (error) {
          reject(error);
        }
      });
    });
  } catch (error) {
    throw createNodeError(error, 'open', pathStr);
  }

  if (!ok) {
    throw createNodeError(new Error('failed to read file'), 'open', pathStr);
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
 * import { mkdtemp } from 'node:fs/promises';
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

async function writeFile(path: PathLike, data: string | Uint8Array | unknown) {
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);

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

  // Open the file for writing (replace contents), creating if needed
  const outputStream = await new Promise<Gio.FileOutputStream>((resolve, reject) => {
    file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        resolve(file.replace_finish(res));
      } catch (err: unknown) {
        reject(createNodeError(err, 'open', pathStr));
      }
    });
  });

  // Write the bytes to the stream (skip if empty — GLib rejects null/empty buffer)
  if (bytes.length > 0) {
    const glibBytes = new GLib.Bytes(bytes);
    await new Promise<void>((resolve, reject) => {
      outputStream.write_bytes_async(glibBytes, GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
        try {
          outputStream.write_bytes_finish(res);
          resolve();
        } catch (err: unknown) {
          reject(createNodeError(err, 'write', pathStr));
        }
      });
    });
  }

  // Close the output stream
  await new Promise<void>((resolve, reject) => {
    outputStream.close_async(GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        outputStream.close_finish(res);
        resolve();
      } catch (err: unknown) {
        reject(createNodeError(err, 'close', pathStr));
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
async function rmdir(path: PathLike, _options?: RmDirOptions): Promise<void> {
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);
  // Check if it's a directory
  const info = await new Promise<Gio.FileInfo>((resolve, reject) => {
    file.query_info_async('standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        resolve(file.query_info_finish(res));
      } catch (err: unknown) {
        reject(createNodeError(err, 'rmdir', pathStr));
      }
    });
  });
  if (info.get_file_type() !== Gio.FileType.DIRECTORY) {
    const err = Object.assign(new Error(), { code: 4 }); // Gio.IOErrorEnum.NOT_DIRECTORY
    throw createNodeError(err, 'rmdir', pathStr);
  }
  // Check if empty
  const children = await new Promise<Gio.FileEnumerator>((resolve, reject) => {
    file.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        resolve(file.enumerate_children_finish(res));
      } catch (err: unknown) {
        reject(createNodeError(err, 'rmdir', pathStr));
      }
    });
  });
  const firstChild = children.next_file(null);
  if (firstChild !== null) {
    const err = Object.assign(new Error(), { code: 5 }); // Gio.IOErrorEnum.NOT_EMPTY
    throw createNodeError(err, 'rmdir', pathStr);
  }
  // Delete the empty directory
  await new Promise<void>((resolve, reject) => {
    file.delete_async(GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        file.delete_finish(res);
        resolve();
      } catch (err: unknown) {
        reject(createNodeError(err, 'rmdir', pathStr));
      }
    });
  });
}

async function unlink(path: PathLike): Promise<void> {
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);
  await new Promise<void>((resolve, reject) => {
    file.delete_async(GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        file.delete_finish(res);
        resolve();
      } catch (err: unknown) {
        reject(createNodeError(err, 'unlink', pathStr));
      }
    });
  });
}

async function open(path: PathLike, flags?: OpenFlags | number, mode?: Mode): Promise<FileHandle> {
  // FileHandle constructor maps GLib.FileError to NodeJS.ErrnoException on failure.
  return new FileHandle({ path, flags: flags as OpenFlags | undefined, mode });
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
  return _writeBuf(fd, data, positionOrOffset as number | null, encodingOrLength as null | number, position) as unknown as Promise<{ bytesWritten: number; buffer: string }>;
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
  const fileHandle = FileHandle.getInstance(fd);
  const result = await fileHandle.write(buffer, offset, length, position);
  return { bytesWritten: result.bytesWritten, buffer };
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
  const fileHandle = FileHandle.getInstance(fd);
  const result = await fileHandle.write(data, position, encoding);
  return { bytesWritten: result.bytesWritten, buffer: data };
}

// --- helpers ---

function queryInfoAsync(path: PathLike, flags: Gio.FileQueryInfoFlags, syscall: string, options?: { bigint?: boolean }): Promise<Stats | BigIntStats> {
  const pathStr = normalizePath(path);
  return new Promise((resolve, reject) => {
    const file = Gio.File.new_for_path(pathStr);
    file.query_info_async(STAT_ATTRIBUTES, flags, GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        const info = file.query_info_finish(res);
        resolve(options?.bigint ? new BigIntStats(info, pathStr) : new Stats(info, pathStr));
      } catch (err: unknown) {
        reject(createNodeError(err, syscall, pathStr));
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
  try {
    return readdirSyncFn(path, options);
  } catch (error) {
    throw createNodeError(error, 'scandir', path);
  }
}

async function realpath(path: PathLike): Promise<string> {
  return realpathSync(path);
}

async function symlink(target: PathLike, path: PathLike, _type?: string): Promise<void> {
  const pathStr = normalizePath(path);
  const targetStr = normalizePath(target);
  return new Promise((resolve, reject) => {
    const file = Gio.File.new_for_path(pathStr);
    file.make_symbolic_link_async(targetStr, GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        file.make_symbolic_link_finish(res);
        resolve();
      } catch (err: unknown) {
        reject(createNodeError(err, 'symlink', targetStr, pathStr));
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
  const pathStr = normalizePath(path);
  const file = Gio.File.new_for_path(pathStr);
  const recursive = options?.recursive || false;
  const force = options?.force || false;

  let dirent: Dirent;
  try {
    dirent = new Dirent(pathStr);
  } catch (err: unknown) {
    if (force) return; // force: ignore non-existent paths
    throw createNodeError(err, 'rm', path);
  }

  if (dirent.isDirectory()) {
    const childFiles = await readdir(path, { withFileTypes: true });

    if (!recursive && childFiles.length) {
      const err = Object.assign(new Error(), { code: 5 }); // Gio.IOErrorEnum.NOT_EMPTY
      throw createNodeError(err, 'rm', path);
    }

    for (const childFile of childFiles) {
      if (typeof childFile !== 'string') {
        await rm(join(pathStr, childFile.name), options);
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    file.delete_async(GLib.PRIORITY_DEFAULT, null, (_self: unknown, res: Gio.AsyncResult) => {
      try {
        file.delete_finish(res);
        resolve();
      } catch (err: unknown) {
        if (force) { resolve(); return; }
        reject(createNodeError(err, 'rm', path));
      }
    });
  });
}

// --- rename ---
async function rename(oldPath: PathLike, newPath: PathLike): Promise<void> {
  renameSync(oldPath, newPath);
}

// --- copyFile ---
async function copyFile(src: PathLike, dest: PathLike, mode?: number): Promise<void> {
  copyFileSync(src, dest, mode);
}

// --- access ---
async function access(path: PathLike, mode?: number): Promise<void> {
  accessSync(path, mode);
}

// --- appendFile ---
async function appendFile(path: PathLike, data: string | Uint8Array, options?: { encoding?: string; mode?: number; flag?: string } | string): Promise<void> {
  appendFileSync(path, data, options);
}

// --- readlink ---
async function readlink(path: PathLike, options?: { encoding?: string } | string): Promise<string | Buffer> {
  return readlinkSync(path, options);
}

// --- truncate ---
async function truncate(path: PathLike, len?: number): Promise<void> {
  truncateSync(path, len);
}

// --- chmod ---
async function chmod(path: PathLike, mode: number | string): Promise<void> {
  chmodSync(path, mode);
}

// --- chown ---
async function chown(path: PathLike, uid: number, gid: number): Promise<void> {
  chownSync(path, uid, gid);
}

// --- link ---
async function link(existingPath: PathLike, newPath: PathLike): Promise<void> {
  linkSync(existingPath, newPath);
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
  rename,
  copyFile,
  access,
  appendFile,
  readlink,
  truncate,
  chmod,
  chown,
  link,
  cpAsync as cp,
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
  rename,
  copyFile,
  access,
  appendFile,
  readlink,
  truncate,
  chmod,
  chown,
  link,
  cp: cpAsync,
};