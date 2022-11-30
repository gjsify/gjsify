// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/30_fs.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import type {
  MkdirOptions,
  DirEntry,
  MakeTempOptions,
  RemoveOptions,
  FileInfo,
  SymlinkOptions,
} from '../../types/index.js';

const {
  Date,
  DatePrototype,
  MathTrunc,
  ObjectPrototypeIsPrototypeOf,
  SymbolAsyncIterator,
  SymbolIterator,
  Function,
  ObjectEntries,
  Uint32Array,
} = primordials;

import { pathFromURL } from './06_util.js';
import { build } from './01_build.js';

/** Synchronously changes the permission of a specific file/directory of
 * specified path. Ignores the process's umask.
 *
 * ```ts
 * Deno.chmodSync("/path/to/file", 0o666);
 * ```
 *
 * For a full description, see {@linkcode Deno.chmod}.
 *
 * NOTE: This API currently throws on Windows
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export function chmodSync(path: string | URL, mode: number): void {
  ops.op_chmod_sync(pathFromURL(path), mode);
}

/** Changes the permission of a specific file/directory of specified path.
 * Ignores the process's umask.
 *
 * ```ts
 * await Deno.chmod("/path/to/file", 0o666);
 * ```
 *
 * The mode is a sequence of 3 octal numbers. The first/left-most number
 * specifies the permissions for the owner. The second number specifies the
 * permissions for the group. The last/right-most number specifies the
 * permissions for others. For example, with a mode of 0o764, the owner (7)
 * can read/write/execute, the group (6) can read/write and everyone else (4)
 * can read only.
 *
 * | Number | Description |
 * | ------ | ----------- |
 * | 7      | read, write, and execute |
 * | 6      | read and write |
 * | 5      | read and execute |
 * | 4      | read only |
 * | 3      | write and execute |
 * | 2      | write only |
 * | 1      | execute only |
 * | 0      | no permission |
 *
 * NOTE: This API currently throws on Windows
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export async function chmod(path: string | URL, mode: number): Promise<void> {
  await core.opAsync("op_chmod_async", pathFromURL(path), mode);
}

/** Synchronously change owner of a regular file or directory.
 *
 * This functionality is not available on Windows.
 *
 * ```ts
 * Deno.chownSync("myFile.txt", 1000, 1002);
 * ```
 *
 * Requires `allow-write` permission.
 *
 * Throws Error (not implemented) if executed on Windows.
 *
 * @tags allow-write
 * @category File System
 *
 * @param path path to the file
 * @param uid user id (UID) of the new owner, or `null` for no change
 * @param gid group id (GID) of the new owner, or `null` for no change
 */
export function chownSync(
  path: string | URL,
  uid: number | null,
  gid: number | null,
): void {
  ops.op_chown_sync(pathFromURL(path), uid, gid);
}

/** Change owner of a regular file or directory.
 *
 * This functionality is not available on Windows.
 *
 * ```ts
 * await Deno.chown("myFile.txt", 1000, 1002);
 * ```
 *
 * Requires `allow-write` permission.
 *
 * Throws Error (not implemented) if executed on Windows.
 *
 * @tags allow-write
 * @category File System
 *
 * @param path path to the file
 * @param uid user id (UID) of the new owner, or `null` for no change
 * @param gid group id (GID) of the new owner, or `null` for no change
 */
export async function chown(
  path: string | URL,
  uid: number | null,
  gid: number | null,
): Promise<void> {
  await core.opAsync(
    "op_chown_async",
    pathFromURL(path),
    uid,
    gid,
  );
}

/** Synchronously copies the contents and permissions of one file to another
 * specified path, by default creating a new file if needed, else overwriting.
 * Fails if target path is a directory or is unwritable.
 *
 * ```ts
 * Deno.copyFileSync("from.txt", "to.txt");
 * ```
 *
 * Requires `allow-read` permission on `fromPath`.
 *
 * Requires `allow-write` permission on `toPath`.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function copyFileSync(
  fromPath: string | URL,
  toPath: string | URL,
): void {
  ops.op_copy_file_sync(
    pathFromURL(fromPath),
    pathFromURL(toPath),
  );
}

/** Copies the contents and permissions of one file to another specified path,
 * by default creating a new file if needed, else overwriting. Fails if target
 * path is a directory or is unwritable.
 *
 * ```ts
 * await Deno.copyFile("from.txt", "to.txt");
 * ```
 *
 * Requires `allow-read` permission on `fromPath`.
 *
 * Requires `allow-write` permission on `toPath`.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export async function copyFile(
  fromPath: string | URL,
  toPath: string | URL,
): Promise<void> {
  await core.opAsync(
    "op_copy_file_async",
    pathFromURL(fromPath),
    pathFromURL(toPath),
  );
}

/**
 * Return a string representing the current working directory.
 *
 * If the current directory can be reached via multiple paths (due to symbolic
 * links), `cwd()` may return any one of them.
 *
 * ```ts
 * const currentWorkingDirectory = Deno.cwd();
 * ```
 *
 * Throws {@linkcode Deno.errors.NotFound} if directory not available.
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category Runtime Environment
 */
export function cwd(): string {
  return ops.op_cwd();
}

/**
 * Change the current working directory to the specified path.
 *
 * ```ts
 * Deno.chdir("/home/userA");
 * Deno.chdir("../userB");
 * Deno.chdir("C:\\Program Files (x86)\\Java");
 * ```
 *
 * Throws {@linkcode Deno.errors.NotFound} if directory not found.
 *
 * Throws {@linkcode Deno.errors.PermissionDenied} if the user does not have
 * operating system file access rights.
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category Runtime Environment
 */
export function chdir(directory: string | URL): void {
  ops.op_chdir(pathFromURL(directory));
}

/** Synchronously creates a new temporary directory in the default directory
 * for temporary files, unless `dir` is specified. Other optional options
 * include prefixing and suffixing the directory name with `prefix` and
 * `suffix` respectively.
 *
 * The full path to the newly created directory is returned.
 *
 * Multiple programs calling this function simultaneously will create different
 * directories. It is the caller's responsibility to remove the directory when
 * no longer needed.
 *
 * ```ts
 * const tempDirName0 = Deno.makeTempDirSync();  // e.g. /tmp/2894ea76
 * const tempDirName1 = Deno.makeTempDirSync({ prefix: 'my_temp' });  // e.g. /tmp/my_temp339c944d
 * ```
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export function makeTempDirSync(options: MakeTempOptions = {}) {
  return ops.op_make_temp_dir_sync(options);
}

/** Creates a new temporary directory in the default directory for temporary
 * files, unless `dir` is specified. Other optional options include
 * prefixing and suffixing the directory name with `prefix` and `suffix`
 * respectively.
 *
 * This call resolves to the full path to the newly created directory.
 *
 * Multiple programs calling this function simultaneously will create different
 * directories. It is the caller's responsibility to remove the directory when
 * no longer needed.
 *
 * ```ts
 * const tempDirName0 = await Deno.makeTempDir();  // e.g. /tmp/2894ea76
 * const tempDirName1 = await Deno.makeTempDir({ prefix: 'my_temp' }); // e.g. /tmp/my_temp339c944d
 * ```
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export function makeTempDir(options: MakeTempOptions = {}): Promise<string> {
  return core.opAsync<string>("op_make_temp_dir_async", options);
}

/** Synchronously creates a new temporary directory in the default directory
 * for temporary files, unless `dir` is specified. Other optional options
 * include prefixing and suffixing the directory name with `prefix` and
 * `suffix` respectively.
 *
 * The full path to the newly created directory is returned.
 *
 * Multiple programs calling this function simultaneously will create different
 * directories. It is the caller's responsibility to remove the directory when
 * no longer needed.
 *
 * ```ts
 * const tempDirName0 = Deno.makeTempDirSync();  // e.g. /tmp/2894ea76
 * const tempDirName1 = Deno.makeTempDirSync({ prefix: 'my_temp' });  // e.g. /tmp/my_temp339c944d
 * ```
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export function makeTempFileSync(options = {}) {
  return ops.op_make_temp_file_sync(options);
}

/** Creates a new temporary file in the default directory for temporary
 * files, unless `dir` is specified.
 *
 * Other options include prefixing and suffixing the directory name with
 * `prefix` and `suffix` respectively.
 *
 * This call resolves to the full path to the newly created file.
 *
 * Multiple programs calling this function simultaneously will create
 * different files. It is the caller's responsibility to remove the file when
 * no longer needed.
 *
 * ```ts
 * const tmpFileName0 = await Deno.makeTempFile();  // e.g. /tmp/419e0bf2
 * const tmpFileName1 = await Deno.makeTempFile({ prefix: 'my_temp' });  // e.g. /tmp/my_temp754d3098
 * ```
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export function makeTempFile(options: MakeTempOptions = {}): Promise<string> {
  return core.opAsync<string>("op_make_temp_file_async", options);
}

function mkdirArgs(path: string | URL, options?: MkdirOptions) {
  const args: { path: string, recursive: boolean, mode?: number } = { path: pathFromURL(path), recursive: false };
  if (options != null) {
    if (typeof options.recursive == "boolean") {
      args.recursive = options.recursive;
    }
    if (options.mode) {
      args.mode = options.mode;
    }
  }
  return args;
}

/** Synchronously creates a new directory with the specified path.
 *
 * ```ts
 * Deno.mkdirSync("new_dir");
 * Deno.mkdirSync("nested/directories", { recursive: true });
 * Deno.mkdirSync("restricted_access_dir", { mode: 0o700 });
 * ```
 *
 * Defaults to throwing error if the directory already exists.
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export function mkdirSync(path: string | URL, options?: MkdirOptions): void {
  ops.op_mkdir_sync(mkdirArgs(path, options));
}

/** Creates a new directory with the specified path.
 *
 * ```ts
 * await Deno.mkdir("new_dir");
 * await Deno.mkdir("nested/directories", { recursive: true });
 * await Deno.mkdir("restricted_access_dir", { mode: 0o700 });
 * ```
 *
 * Defaults to throwing error if the directory already exists.
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
 export async function mkdir(
  path: string | URL,
  options?: MkdirOptions,
): Promise<void> {
  await core.opAsync("op_mkdir_async", mkdirArgs(path, options));
}

/** Synchronously reads the directory given by `path` and returns an iterable
 * of `Deno.DirEntry`.
 *
 * ```ts
 * for (const dirEntry of Deno.readDirSync("/")) {
 *   console.log(dirEntry.name);
 * }
 * ```
 *
 * Throws error if `path` is not a directory.
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export function readDirSync(path: string | URL): Iterable<DirEntry> {
  return ops.op_read_dir_sync(pathFromURL(path))[
    SymbolIterator
  ]();
}

/** Reads the directory given by `path` and returns an async iterable of
 * {@linkcode Deno.DirEntry}.
 *
 * ```ts
 * for await (const dirEntry of Deno.readDir("/")) {
 *   console.log(dirEntry.name);
 * }
 * ```
 *
 * Throws error if `path` is not a directory.
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export function readDir(path: string | URL): AsyncIterable<DirEntry> {
  const array = core.opAsync(
    "op_read_dir_async",
    pathFromURL(path),
  );
  // @ts-ignore TODO?
  return {
    async *[SymbolAsyncIterator]() {
      yield* await array;
    },
  };
}

/** Synchronously returns the full path destination of the named symbolic
 * link.
 *
 * ```ts
 * Deno.symlinkSync("./test.txt", "./test_link.txt");
 * const target = Deno.readLinkSync("./test_link.txt"); // full path of ./test.txt
 * ```
 *
 * Throws TypeError if called with a hard link.
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export function readLinkSync(path: string | URL): string {
  return ops.op_read_link_sync(pathFromURL(path));
}

/** Resolves to the full path destination of the named symbolic link.
 *
 * ```ts
 * await Deno.symlink("./test.txt", "./test_link.txt");
 * const target = await Deno.readLink("./test_link.txt"); // full path of ./test.txt
 * ```
 *
 * Throws TypeError if called with a hard link.
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export function readLink(path: string | URL): Promise<string> {
  return core.opAsync("op_read_link_async", pathFromURL(path));
}

/** Synchronously returns absolute normalized path, with symbolic links
 * resolved.
 *
 * ```ts
 * // e.g. given /home/alice/file.txt and current directory /home/alice
 * Deno.symlinkSync("file.txt", "symlink_file.txt");
 * const realPath = Deno.realPathSync("./file.txt");
 * const realSymLinkPath = Deno.realPathSync("./symlink_file.txt");
 * console.log(realPath);  // outputs "/home/alice/file.txt"
 * console.log(realSymLinkPath);  // outputs "/home/alice/file.txt"
 * ```
 *
 * Requires `allow-read` permission for the target path.
 *
 * Also requires `allow-read` permission for the `CWD` if the target path is
 * relative.
 *
 * @tags allow-read
 * @category File System
 */
export function realPathSync(path: string | URL): string {
  return ops.op_realpath_sync(pathFromURL(path));
}

/** Resolves to the absolute normalized path, with symbolic links resolved.
 *
 * ```ts
 * // e.g. given /home/alice/file.txt and current directory /home/alice
 * await Deno.symlink("file.txt", "symlink_file.txt");
 * const realPath = await Deno.realPath("./file.txt");
 * const realSymLinkPath = await Deno.realPath("./symlink_file.txt");
 * console.log(realPath);  // outputs "/home/alice/file.txt"
 * console.log(realSymLinkPath);  // outputs "/home/alice/file.txt"
 * ```
 *
 * Requires `allow-read` permission for the target path.
 *
 * Also requires `allow-read` permission for the `CWD` if the target path is
 * relative.
 *
 * @tags allow-read
 * @category File System
 */
export function realPath(path: string | URL): Promise<string> {
  return core.opAsync("op_realpath_async", pathFromURL(path));
}

/** Synchronously removes the named file or directory.
 *
 * ```ts
 * Deno.removeSync("/path/to/empty_dir/or/file");
 * Deno.removeSync("/path/to/populated_dir/or/file", { recursive: true });
 * ```
 *
 * Throws error if permission denied, path not found, or path is a non-empty
 * directory and the `recursive` option isn't set to `true`.
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export function removeSync(
  path: string | URL,
  options: RemoveOptions = {},
): void {
  ops.op_remove_sync(
    pathFromURL(path),
    !!options.recursive,
  );
}

/** Removes the named file or directory.
 *
 * ```ts
 * await Deno.remove("/path/to/empty_dir/or/file");
 * await Deno.remove("/path/to/populated_dir/or/file", { recursive: true });
 * ```
 *
 * Throws error if permission denied, path not found, or path is a non-empty
 * directory and the `recursive` option isn't set to `true`.
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export async function remove(
  path: string | URL,
  options: RemoveOptions = {},
): Promise<void> {
  await core.opAsync(
    "op_remove_async",
    pathFromURL(path),
    !!options.recursive,
  );
}

/** Synchronously renames (moves) `oldpath` to `newpath`. Paths may be files or
 * directories. If `newpath` already exists and is not a directory,
 * `renameSync()` replaces it. OS-specific restrictions may apply when
 * `oldpath` and `newpath` are in different directories.
 *
 * ```ts
 * Deno.renameSync("old/path", "new/path");
 * ```
 *
 * On Unix-like OSes, this operation does not follow symlinks at either path.
 *
 * It varies between platforms when the operation throws errors, and if so what
 * they are. It's always an error to rename anything to a non-empty directory.
 *
 * Requires `allow-read` and `allow-write` permissions.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function renameSync(oldpath: string | URL, newpath: string | URL): void {
  ops.op_rename_sync(
    pathFromURL(oldpath),
    pathFromURL(newpath),
  );
}

/** Renames (moves) `oldpath` to `newpath`. Paths may be files or directories.
 * If `newpath` already exists and is not a directory, `rename()` replaces it.
 * OS-specific restrictions may apply when `oldpath` and `newpath` are in
 * different directories.
 *
 * ```ts
 * await Deno.rename("old/path", "new/path");
 * ```
 *
 * On Unix-like OSes, this operation does not follow symlinks at either path.
 *
 * It varies between platforms when the operation throws errors, and if so
 * what they are. It's always an error to rename anything to a non-empty
 * directory.
 *
 * Requires `allow-read` and `allow-write` permissions.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export async function rename(oldpath: string | URL, newpath: string | URL): Promise<void> {
  await core.opAsync(
    "op_rename_async",
    pathFromURL(oldpath),
    pathFromURL(newpath),
  );
}

// Extract the FsStat object from the encoded buffer.
// See `runtime/ops/fs.rs` for the encoder.
//
// This is not a general purpose decoder. There are 4 types:
//
// 1. date
//  offset += 4
//  1/0 | extra padding | high u32 | low u32
//  if date[0] == 1, new Date(u64) else null
//
// 2. bool
//  offset += 2
//  1/0 | extra padding
//
// 3. u64
//  offset += 2
//  high u32 | low u32
//
// 4. ?u64 converts a zero u64 value to JS null on Windows.
function createByteStruct(types) {
  // types can be "date", "bool" or "u64".
  // `?` prefix means optional on windows.
  let offset = 0;
  let str =
    'const unix = Deno.build.os === "darwin" || Deno.build.os === "linux"; return {';
  for (let [name, type] of ObjectEntries<string>(types)) {
    const optional = type.startsWith("?");
    if (optional) type = type.slice(1);

    if (type == "u64") {
      if (!optional) {
        str += `${name}: view[${offset}] + view[${offset + 1}] * 2**32,`;
      } else {
        str += `${name}: (unix ? (view[${offset}] + view[${
          offset + 1
        }] * 2**32) : (view[${offset}] + view[${
          offset + 1
        }] * 2**32) || null),`;
      }
    } else if (type == "date") {
      str += `${name}: view[${offset}] === 0 ? null : new Date(view[${
        offset + 2
      }] + view[${offset + 3}] * 2**32),`;
      offset += 2;
    } else {
      str += `${name}: !!(view[${offset}] + view[${offset + 1}] * 2**32),`;
    }
    offset += 2;
  }
  str += "};";
  // ...so you don't like eval huh? don't worry, it only executes during snapshot :)
  return [new Function("view", str), new Uint32Array(offset)];
}

const [statStruct, statBuf] = createByteStruct({
  isFile: "bool",
  isDirectory: "bool",
  isSymlink: "bool",
  size: "u64",
  mtime: "date",
  atime: "date",
  birthtime: "date",
  dev: "?u64",
  ino: "?u64",
  mode: "?u64",
  nlink: "?u64",
  uid: "?u64",
  gid: "?u64",
  rdev: "?u64",
  blksize: "?u64",
  blocks: "?u64",
});

function parseFileInfo(response): FileInfo {
  const unix = build.os === "darwin" || build.os === "linux";
  return {
    isFile: response.isFile,
    isDirectory: response.isDirectory,
    isSymlink: response.isSymlink,
    size: response.size,
    mtime: response.mtimeSet !== null ? new Date(response.mtime) : null,
    atime: response.atimeSet !== null ? new Date(response.atime) : null,
    birthtime: response.birthtimeSet !== null
      ? new Date(response.birthtime)
      : null,
    // Only non-null if on Unix
    dev: unix ? response.dev : null,
    ino: unix ? response.ino : null,
    mode: unix ? response.mode : null,
    nlink: unix ? response.nlink : null,
    uid: unix ? response.uid : null,
    gid: unix ? response.gid : null,
    rdev: unix ? response.rdev : null,
    blksize: unix ? response.blksize : null,
    blocks: unix ? response.blocks : null,
  };
}

/**
 * Synchronously returns a {@linkcode Deno.FileInfo} for the given file
 * stream.
 *
 * ```ts
 * import { assert } from "https://deno.land/std/testing/asserts.ts";
 *
 * const file = Deno.openSync("file.txt", { read: true });
 * const fileInfo = Deno.fstatSync(file.rid);
 * assert(fileInfo.isFile);
 * ```
 *
 * @category File System
 */
export function fstatSync(rid: number): FileInfo {
  ops.op_fstat_sync(rid, statBuf);
  return (statStruct as Function)(statBuf) as FileInfo;
}

/**
 * Returns a `Deno.FileInfo` for the given file stream.
 *
 * ```ts
 * import { assert } from "https://deno.land/std/testing/asserts.ts";
 *
 * const file = await Deno.open("file.txt", { read: true });
 * const fileInfo = await Deno.fstat(file.rid);
 * assert(fileInfo.isFile);
 * ```
 *
 * @category File System
 */
export async function fstat(rid: number): Promise<FileInfo> {
  return parseFileInfo(await core.opAsync("op_fstat_async", rid));
}

/** Resolves to a {@linkcode Deno.FileInfo} for the specified `path`. If
 * `path` is a symlink, information for the symlink will be returned instead
 * of what it points to.
 *
 * ```ts
 * import { assert } from "https://deno.land/std/testing/asserts.ts";
 * const fileInfo = await Deno.lstat("hello.txt");
 * assert(fileInfo.isFile);
 * ```
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export async function lstat(path: string | URL): Promise<FileInfo> {
  const res = await core.opAsync("op_stat_async", {
    path: pathFromURL(path),
    lstat: true,
  });
  return parseFileInfo(res);
}

/** Synchronously returns a {@linkcode Deno.FileInfo} for the specified
 * `path`. If `path` is a symlink, information for the symlink will be
 * returned instead of what it points to.
 *
 * ```ts
 * import { assert } from "https://deno.land/std/testing/asserts.ts";
 * const fileInfo = Deno.lstatSync("hello.txt");
 * assert(fileInfo.isFile);
 * ```
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export function lstatSync(path: string | URL): FileInfo {
  ops.op_stat_sync(
    pathFromURL(path),
    true,
    statBuf,
  );
  return (statStruct as Function)(statBuf);
}

/** Resolves to a {@linkcode Deno.FileInfo} for the specified `path`. Will
 * always follow symlinks.
 *
 * ```ts
 * import { assert } from "https://deno.land/std/testing/asserts.ts";
 * const fileInfo = await Deno.stat("hello.txt");
 * assert(fileInfo.isFile);
 * ```
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export async function stat(path: string | URL): Promise<FileInfo> {
  const res = await core.opAsync("op_stat_async", {
    path: pathFromURL(path),
    lstat: false,
  });
  return parseFileInfo(res);
}

/** Synchronously returns a {@linkcode Deno.FileInfo} for the specified
 * `path`. Will always follow symlinks.
 *
 * ```ts
 * import { assert } from "https://deno.land/std/testing/asserts.ts";
 * const fileInfo = Deno.statSync("hello.txt");
 * assert(fileInfo.isFile);
 * ```
 *
 * Requires `allow-read` permission.
 *
 * @tags allow-read
 * @category File System
 */
export function statSync(path: string | URL): FileInfo {
  ops.op_stat_sync(
    pathFromURL(path),
    false,
    statBuf,
  );
  return (statStruct as Function)(statBuf);
}

function coerceLen(len) {
  if (len == null || len < 0) {
    return 0;
  }

  return len;
}

/**
 * Synchronously truncates or extends the specified file stream, to reach the
 * specified `len`.
 *
 * If `len` is not specified then the entire file contents are truncated as if
 * `len` was set to `0`.
 *
 * If the file previously was larger than this new length, the extra data is
 * lost.
 *
 * If the file previously was shorter, it is extended, and the extended part
 * reads as null bytes ('\0').
 *
 * ### Truncate the entire file
 *
 * ```ts
 * const file = Deno.openSync(
 *   "my_file.txt",
 *   { read: true, write: true, truncate: true, create: true }
 * );
 * Deno.ftruncateSync(file.rid);
 * ```
 *
 * ### Truncate part of the file
 *
 * ```ts
 * const file = Deno.openSync(
 *  "my_file.txt",
 *  { read: true, write: true, create: true }
 * );
 * Deno.writeSync(file.rid, new TextEncoder().encode("Hello World"));
 * Deno.ftruncateSync(file.rid, 7);
 * Deno.seekSync(file.rid, 0, Deno.SeekMode.Start);
 * const data = new Uint8Array(32);
 * Deno.readSync(file.rid, data);
 * console.log(new TextDecoder().decode(data)); // Hello W
 * ```
 *
 * @category File System
 */
export function ftruncateSync(rid: number, len?: number): void {
  ops.op_ftruncate_sync(rid, coerceLen(len));
}

/**
 * Truncates or extends the specified file stream, to reach the specified
 * `len`.
 *
 * If `len` is not specified then the entire file contents are truncated as if
 * `len` was set to `0`.
 *
 * If the file previously was larger than this new length, the extra data is
 * lost.
 *
 * If the file previously was shorter, it is extended, and the extended part
 * reads as null bytes ('\0').
 *
 * ### Truncate the entire file
 *
 * ```ts
 * const file = await Deno.open(
 *   "my_file.txt",
 *   { read: true, write: true, create: true }
 * );
 * await Deno.ftruncate(file.rid);
 * ```
 *
 * ### Truncate part of the file
 *
 * ```ts
 * const file = await Deno.open(
 *   "my_file.txt",
 *   { read: true, write: true, create: true }
 * );
 * await Deno.write(file.rid, new TextEncoder().encode("Hello World"));
 * await Deno.ftruncate(file.rid, 7);
 * const data = new Uint8Array(32);
 * await Deno.read(file.rid, data);
 * console.log(new TextDecoder().decode(data)); // Hello W
 * ```
 *
 * @category File System
 */
export async function ftruncate(rid: number, len?: number): Promise<void> {
  await core.opAsync("op_ftruncate_async", rid, coerceLen(len));
}

/**
 * Synchronously truncates or extends the specified file stream, to reach the
 * specified `len`.
 *
 * If `len` is not specified then the entire file contents are truncated as if
 * `len` was set to `0`.
 *
 * If the file previously was larger than this new length, the extra data is
 * lost.
 *
 * If the file previously was shorter, it is extended, and the extended part
 * reads as null bytes ('\0').
 *
 * ### Truncate the entire file
 *
 * ```ts
 * const file = Deno.openSync(
 *   "my_file.txt",
 *   { read: true, write: true, truncate: true, create: true }
 * );
 * Deno.ftruncateSync(file.rid);
 * ```
 *
 * ### Truncate part of the file
 *
 * ```ts
 * const file = Deno.openSync(
 *  "my_file.txt",
 *  { read: true, write: true, create: true }
 * );
 * Deno.writeSync(file.rid, new TextEncoder().encode("Hello World"));
 * Deno.ftruncateSync(file.rid, 7);
 * Deno.seekSync(file.rid, 0, Deno.SeekMode.Start);
 * const data = new Uint8Array(32);
 * Deno.readSync(file.rid, data);
 * console.log(new TextDecoder().decode(data)); // Hello W
 * ```
 *
 * @category File System
 */
export function truncateSync(path: number, len?: number): void {
  ops.op_truncate_sync(path, coerceLen(len));
}

/**
 * Truncates or extends the specified file stream, to reach the specified
 * `len`.
 *
 * If `len` is not specified then the entire file contents are truncated as if
 * `len` was set to `0`.
 *
 * If the file previously was larger than this new length, the extra data is
 * lost.
 *
 * If the file previously was shorter, it is extended, and the extended part
 * reads as null bytes ('\0').
 *
 * ### Truncate the entire file
 *
 * ```ts
 * const file = await Deno.open(
 *   "my_file.txt",
 *   { read: true, write: true, create: true }
 * );
 * await Deno.ftruncate(file.rid);
 * ```
 *
 * ### Truncate part of the file
 *
 * ```ts
 * const file = await Deno.open(
 *   "my_file.txt",
 *   { read: true, write: true, create: true }
 * );
 * await Deno.write(file.rid, new TextEncoder().encode("Hello World"));
 * await Deno.ftruncate(file.rid, 7);
 * const data = new Uint8Array(32);
 * await Deno.read(file.rid, data);
 * console.log(new TextDecoder().decode(data)); // Hello W
 * ```
 *
 * @category File System
 */
export async function truncate(path: number, len?: number): Promise<void> {
  await core.opAsync("op_truncate_async", path, coerceLen(len));
}

export function umask(mask) {
  return ops.op_umask(mask);
}

/**
 * Synchronously creates `newpath` as a hard link to `oldpath`.
 *
 * ```ts
 * Deno.linkSync("old/name", "new/name");
 * ```
 *
 * Requires `allow-read` and `allow-write` permissions.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function linkSync(oldpath: string, newpath: string): void {
  ops.op_link_sync(oldpath, newpath);
}

/**
 * Creates `newpath` as a hard link to `oldpath`.
 *
 * ```ts
 * await Deno.link("old/name", "new/name");
 * ```
 *
 * Requires `allow-read` and `allow-write` permissions.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export async function link(oldpath: string, newpath: string): Promise<void> {
  await core.opAsync("op_link_async", oldpath, newpath);
}

function toUnixTimeFromEpoch(value) {
  if (ObjectPrototypeIsPrototypeOf(DatePrototype, value)) {
    const time = value.valueOf();
    const seconds = MathTrunc(time / 1e3);
    const nanoseconds = MathTrunc(time - (seconds * 1e3)) * 1e6;

    return [
      seconds,
      nanoseconds,
    ];
  }

  const seconds = value;
  const nanoseconds = 0;

  return [
    seconds,
    nanoseconds,
  ];
}

/**
 * Synchronously changes the access (`atime`) and modification (`mtime`) times
 * of a file stream resource referenced by `rid`. Given times are either in
 * seconds (UNIX epoch time) or as `Date` objects.
 *
 * ```ts
 * const file = Deno.openSync("file.txt", { create: true, write: true });
 * Deno.futimeSync(file.rid, 1556495550, new Date());
 * ```
 *
 * @category File System
 */
export function futimeSync(
  rid: number,
  atime: number | Date,
  mtime: number | Date,
): void {
  const [atimeSec, atimeNsec] = toUnixTimeFromEpoch(atime);
  const [mtimeSec, mtimeNsec] = toUnixTimeFromEpoch(mtime);
  ops.op_futime_sync(rid, atimeSec, atimeNsec, mtimeSec, mtimeNsec);
}

/**
 * Changes the access (`atime`) and modification (`mtime`) times of a file
 * stream resource referenced by `rid`. Given times are either in seconds
 * (UNIX epoch time) or as `Date` objects.
 *
 * ```ts
 * const file = await Deno.open("file.txt", { create: true, write: true });
 * await Deno.futime(file.rid, 1556495550, new Date());
 * ```
 *
 * @category File System
 */
export async function futime(
  rid: number,
  atime: number | Date,
  mtime: number | Date,
): Promise<void> {
  const [atimeSec, atimeNsec] = toUnixTimeFromEpoch(atime);
  const [mtimeSec, mtimeNsec] = toUnixTimeFromEpoch(mtime);
  await core.opAsync(
    "op_futime_async",
    rid,
    atimeSec,
    atimeNsec,
    mtimeSec,
    mtimeNsec,
  );
}

/**
 * Synchronously changes the access (`atime`) and modification (`mtime`) times
 * of a file system object referenced by `path`. Given times are either in
 * seconds (UNIX epoch time) or as `Date` objects.
 *
 * ```ts
 * Deno.utimeSync("myfile.txt", 1556495550, new Date());
 * ```
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export function utimeSync(
  path: string | URL,
  atime: number | Date,
  mtime: number | Date,
): void {
  const [atimeSec, atimeNsec] = toUnixTimeFromEpoch(atime);
  const [mtimeSec, mtimeNsec] = toUnixTimeFromEpoch(mtime);
  ops.op_utime_sync(
    pathFromURL(path),
    atimeSec,
    atimeNsec,
    mtimeSec,
    mtimeNsec,
  );
}

/**
 * Changes the access (`atime`) and modification (`mtime`) times of a file
 * system object referenced by `path`. Given times are either in seconds
 * (UNIX epoch time) or as `Date` objects.
 *
 * ```ts
 * await Deno.utime("myfile.txt", 1556495550, new Date());
 * ```
 *
 * Requires `allow-write` permission.
 *
 * @tags allow-write
 * @category File System
 */
export async function utime(
  path: string | URL,
  atime: number | Date,
  mtime: number | Date,
): Promise<void> {
  const [atimeSec, atimeNsec] = toUnixTimeFromEpoch(atime);
  const [mtimeSec, mtimeNsec] = toUnixTimeFromEpoch(mtime);
  await core.opAsync(
    "op_utime_async",
    pathFromURL(path),
    atimeSec,
    atimeNsec,
    mtimeSec,
    mtimeNsec,
  );
}

/**
 * Creates `newpath` as a symbolic link to `oldpath`.
 *
 * The `options.type` parameter can be set to `"file"` or `"dir"`. This
 * argument is only available on Windows and ignored on other platforms.
 *
 * ```ts
 * Deno.symlinkSync("old/name", "new/name");
 * ```
 *
 * Requires full `allow-read` and `allow-write` permissions.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function symlinkSync(
  oldpath: string | URL,
  newpath: string | URL,
  options?: SymlinkOptions,
): void {
  ops.op_symlink_sync(
    pathFromURL(oldpath),
    pathFromURL(newpath),
    options?.type,
  );
}

/**
 * Creates `newpath` as a symbolic link to `oldpath`.
 *
 * The `options.type` parameter can be set to `"file"` or `"dir"`. This
 * argument is only available on Windows and ignored on other platforms.
 *
 * ```ts
 * await Deno.symlink("old/name", "new/name");
 * ```
 *
 * Requires full `allow-read` and `allow-write` permissions.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export async function symlink(
  oldpath: string | URL,
  newpath: string | URL,
  options?: SymlinkOptions,
) {
  await core.opAsync(
    "op_symlink_async",
    pathFromURL(oldpath),
    pathFromURL(newpath),
    options?.type,
  );
}

/**
 * Synchronously flushes any pending data operations of the given file stream
 * to disk.
 *
 *  ```ts
 * const file = Deno.openSync(
 *   "my_file.txt",
 *   { read: true, write: true, create: true },
 * );
 * Deno.writeSync(file.rid, new TextEncoder().encode("Hello World"));
 * Deno.fdatasyncSync(file.rid);
 * console.log(new TextDecoder().decode(Deno.readFileSync("my_file.txt"))); // Hello World
 * ```
 *
 * @category I/O
 */
export function fdatasyncSync(rid: number): void {
  ops.op_fdatasync_sync(rid);
}

/**
 * Flushes any pending data operations of the given file stream to disk.
 *  ```ts
 * const file = await Deno.open(
 *   "my_file.txt",
 *   { read: true, write: true, create: true },
 * );
 * await Deno.write(file.rid, new TextEncoder().encode("Hello World"));
 * await Deno.fdatasync(file.rid);
 * console.log(new TextDecoder().decode(await Deno.readFile("my_file.txt"))); // Hello World
 * ```
 *
 * @category I/O
 */
export async function fdatasync(rid: number): Promise<void> {
  await core.opAsync("op_fdatasync_async", rid);
}

/**
 * Synchronously flushes any pending data and metadata operations of the given
 * file stream to disk.
 *
 * ```ts
 * const file = Deno.openSync(
 *   "my_file.txt",
 *   { read: true, write: true, create: true },
 * );
 * Deno.writeSync(file.rid, new TextEncoder().encode("Hello World"));
 * Deno.ftruncateSync(file.rid, 1);
 * Deno.fsyncSync(file.rid);
 * console.log(new TextDecoder().decode(Deno.readFileSync("my_file.txt"))); // H
 * ```
 *
 * @category I/O
 */
export function fsyncSync(rid: number): void {
  ops.op_fsync_sync(rid);
}


/**
 * Flushes any pending data and metadata operations of the given file stream
 * to disk.
 *
 * ```ts
 * const file = await Deno.open(
 *   "my_file.txt",
 *   { read: true, write: true, create: true },
 * );
 * await Deno.write(file.rid, new TextEncoder().encode("Hello World"));
 * await Deno.ftruncate(file.rid, 1);
 * await Deno.fsync(file.rid);
 * console.log(new TextDecoder().decode(await Deno.readFile("my_file.txt"))); // H
 * ```
 *
 * @category I/O
 */
export async function fsync(rid: number): Promise<void> {
  await core.opAsync("op_fsync_async", rid);
}

export function flockSync(rid: number, exclusive?: boolean) {
  ops.op_flock_sync(rid, exclusive === true);
}

export async function flock(rid: number, exclusive?: boolean) {
  await core.opAsync("op_flock_async", rid, exclusive === true);
}

export function funlockSync(rid: number) {
  ops.op_funlock_sync(rid);
}

export async function funlock(rid: number) {
  await core.opAsync("op_funlock_async", rid);
}
