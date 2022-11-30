// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/40_files.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import { read, readSync, write, writeSync } from './12_io.js';
import { ftruncate, ftruncateSync, fstat, fstatSync } from './30_fs.js';
import { pathFromURL } from './06_util.js';
import { readableStreamForRid, writableStreamForRid, WritableStream, ReadableStream } from '../../ext/web/06_streams.js';
import type {
  SeekMode,
  OpenOptions,
  Reader,
  ReaderSync,
  Writer,
  WriterSync,
  Seeker,
  SeekerSync,
  Closer,
  FileInfo,
  SetRawOptions,
} from '../../types/index.js';

const {
  ArrayPrototypeFilter,
  Error,
  ObjectValues,
} = primordials;

/** Synchronously seek a resource ID (`rid`) to the given `offset` under mode
 * given by `whence`. The new position within the resource (bytes from the
 * start) is returned.
 *
 * ```ts
 * const file = Deno.openSync(
 *   "hello.txt",
 *   { read: true, write: true, truncate: true, create: true },
 * );
 * Deno.writeSync(file.rid, new TextEncoder().encode("Hello world"));
 *
 * // advance cursor 6 bytes
 * const cursorPosition = Deno.seekSync(file.rid, 6, Deno.SeekMode.Start);
 * console.log(cursorPosition);  // 6
 * const buf = new Uint8Array(100);
 * file.readSync(buf);
 * console.log(new TextDecoder().decode(buf)); // "world"
 * file.close();
 * ```
 *
 * The seek modes work as follows:
 *
 * ```ts
 * // Given file.rid pointing to file with "Hello world", which is 11 bytes long:
 * const file = Deno.openSync(
 *   "hello.txt",
 *   { read: true, write: true, truncate: true, create: true },
 * );
 * Deno.writeSync(file.rid, new TextEncoder().encode("Hello world"));
 *
 * // Seek 6 bytes from the start of the file
 * console.log(Deno.seekSync(file.rid, 6, Deno.SeekMode.Start)); // "6"
 * // Seek 2 more bytes from the current position
 * console.log(Deno.seekSync(file.rid, 2, Deno.SeekMode.Current)); // "8"
 * // Seek backwards 2 bytes from the end of the file
 * console.log(Deno.seekSync(file.rid, -2, Deno.SeekMode.End)); // "9" (e.g. 11-2)
 * file.close();
 * ```
 *
 * @category I/O
 */
export function seekSync(
  rid: number,
  offset: number,
  whence: SeekMode,
): number {
  return ops.op_seek_sync({ rid, offset, whence });
}

/** Seek a resource ID (`rid`) to the given `offset` under mode given by `whence`.
 * The call resolves to the new position within the resource (bytes from the start).
 *
 * ```ts
 * // Given file.rid pointing to file with "Hello world", which is 11 bytes long:
 * const file = await Deno.open(
 *   "hello.txt",
 *   { read: true, write: true, truncate: true, create: true },
 * );
 * await Deno.write(file.rid, new TextEncoder().encode("Hello world"));
 *
 * // advance cursor 6 bytes
 * const cursorPosition = await Deno.seek(file.rid, 6, Deno.SeekMode.Start);
 * console.log(cursorPosition);  // 6
 * const buf = new Uint8Array(100);
 * await file.read(buf);
 * console.log(new TextDecoder().decode(buf)); // "world"
 * file.close();
 * ```
 *
 * The seek modes work as follows:
 *
 * ```ts
 * // Given file.rid pointing to file with "Hello world", which is 11 bytes long:
 * const file = await Deno.open(
 *   "hello.txt",
 *   { read: true, write: true, truncate: true, create: true },
 * );
 * await Deno.write(file.rid, new TextEncoder().encode("Hello world"));
 *
 * // Seek 6 bytes from the start of the file
 * console.log(await Deno.seek(file.rid, 6, Deno.SeekMode.Start)); // "6"
 * // Seek 2 more bytes from the current position
 * console.log(await Deno.seek(file.rid, 2, Deno.SeekMode.Current)); // "8"
 * // Seek backwards 2 bytes from the end of the file
 * console.log(await Deno.seek(file.rid, -2, Deno.SeekMode.End)); // "9" (e.g. 11-2)
 * file.close();
 * ```
 *
 * @category I/O
 */
export function seek(
  rid: number,
  offset: number,
  whence: SeekMode,
) {
  return core.opAsync("op_seek_async", { rid, offset, whence });
}

/** Synchronously open a file and return an instance of
 * {@linkcode Deno.FsFile}. The file does not need to previously exist if
 * using the `create` or `createNew` open options. It is the caller's
 * responsibility to close the file when finished with it.
 *
 * ```ts
 * const file = Deno.openSync("/foo/bar.txt", { read: true, write: true });
 * // Do work with file
 * Deno.close(file.rid);
 * ```
 *
 * Requires `allow-read` and/or `allow-write` permissions depending on
 * options.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function openSync(
  path: string | URL, options?: OpenOptions
) {
  if (options) checkOpenOptions(options);
  const mode = options?.mode;
  const rid = ops.op_open_sync(
    pathFromURL(path),
    options,
    mode,
  );

  return new FsFile(rid);
}

/** Open a file and resolve to an instance of {@linkcode Deno.FsFile}. The
 * file does not need to previously exist if using the `create` or `createNew`
 * open options. It is the caller's responsibility to close the file when
 * finished with it.
 *
 * ```ts
 * const file = await Deno.open("/foo/bar.txt", { read: true, write: true });
 * // Do work with file
 * Deno.close(file.rid);
 * ```
 *
 * Requires `allow-read` and/or `allow-write` permissions depending on
 * options.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export async function open(
  path: string | URL,
  options?: OpenOptions,
): Promise<FsFile> {
  if (options) checkOpenOptions(options);
  const mode = options?.mode;
  const rid = await core.opAsync(
    "op_open_async",
    pathFromURL(path),
    options,
    mode,
  );

  return new FsFile(rid);
}

/** Creates a file if none exists or truncates an existing file and returns
 *  an instance of {@linkcode Deno.FsFile}.
 *
 * ```ts
 * const file = Deno.createSync("/foo/bar.txt");
 * ```
 *
 * Requires `allow-read` and `allow-write` permissions.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function createSync(path: string | URL): FsFile {
  return openSync(path, {
    read: true,
    write: true,
    truncate: true,
    create: true,
  });
}

/** Creates a file if none exists or truncates an existing file and resolves to
 *  an instance of {@linkcode Deno.FsFile}.
 *
 * ```ts
 * const file = await Deno.create("/foo/bar.txt");
 * ```
 *
 * Requires `allow-read` and `allow-write` permissions.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function create(path: string | URL): Promise<FsFile> {
  return open(path, {
    read: true,
    write: true,
    truncate: true,
    create: true,
  });
}

/** The Deno abstraction for reading and writing files.
 *
 * This is the most straight forward way of handling files within Deno and is
 * recommended over using the discreet functions within the `Deno` namespace.
 *
 * ```ts
 * const file = await Deno.open("/foo/bar.txt", { read: true });
 * const fileInfo = await file.stat();
 * if (fileInfo.isFile) {
 *   const buf = new Uint8Array(100);
 *   const numberOfBytesRead = await file.read(buf); // 11 bytes
 *   const text = new TextDecoder().decode(buf);  // "hello world"
 * }
 * file.close();
 * ```
 *
 * @category File System
 */
export class FsFile
  implements
  Reader,
  ReaderSync,
  Writer,
  WriterSync,
  Seeker,
  SeekerSync,
  Closer {
  #rid = 0;

  #readable;
  #writable;

  /** The constructor which takes a resource ID. Generally `FsFile` should
   * not be constructed directly. Instead use {@linkcode Deno.open} or
   * {@linkcode Deno.openSync} to create a new instance of `FsFile`. */
  constructor(rid: number) {
    this.#rid = rid;
  }

  /** The resource ID associated with the file instance. The resource ID
   * should be considered an opaque reference to resource. */
  get rid(): number {
    return this.#rid;
  }

  /** Write the contents of the array buffer (`p`) to the file.
   *
   * Resolves to the number of bytes written.
   *
   * **It is not guaranteed that the full buffer will be written in a single
   * call.**
   *
   * ```ts
   * const encoder = new TextEncoder();
   * const data = encoder.encode("Hello world");
   * const file = await Deno.open("/foo/bar.txt", { write: true });
   * const bytesWritten = await file.write(data); // 11
   * file.close();
   * ```
   *
   * @category I/O
   */
  write(p: Uint8Array): Promise<number> {
    return write(this.rid, p);
  }

  /** Synchronously write the contents of the array buffer (`p`) to the file.
   *
   * Returns the number of bytes written.
   *
   * **It is not guaranteed that the full buffer will be written in a single
   * call.**
   *
   * ```ts
   * const encoder = new TextEncoder();
   * const data = encoder.encode("Hello world");
   * const file = Deno.openSync("/foo/bar.txt", { write: true });
   * const bytesWritten = file.writeSync(data); // 11
   * file.close();
   * ```
   */
  writeSync(p: Uint8Array): number {
    return writeSync(this.rid, p);
  }

  /** Truncates (or extends) the file to reach the specified `len`. If `len`
   * is not specified, then the entire file contents are truncated.
   *
   * ### Truncate the entire file
   *
   * ```ts
   * const file = await Deno.open("my_file.txt", { write: true });
   * await file.truncate();
   * file.close();
   * ```
   *
   * ### Truncate part of the file
   *
   * ```ts
   * // if "my_file.txt" contains the text "hello world":
   * const file = await Deno.open("my_file.txt", { write: true });
   * await file.truncate(7);
   * const buf = new Uint8Array(100);
   * await file.read(buf);
   * const text = new TextDecoder().decode(buf); // "hello w"
   * file.close();
   * ```
   */
  truncate(len?: number): Promise<void> {
    return ftruncate(this.rid, len);
  }

  /** Synchronously truncates (or extends) the file to reach the specified
   * `len`. If `len` is not specified, then the entire file contents are
   * truncated.
   *
   * ### Truncate the entire file
   *
   * ```ts
   * const file = Deno.openSync("my_file.txt", { write: true });
   * file.truncateSync();
   * file.close();
   * ```
   *
   * ### Truncate part of the file
   *
   * ```ts
   * // if "my_file.txt" contains the text "hello world":
   * const file = Deno.openSync("my_file.txt", { write: true });
   * file.truncateSync(7);
   * const buf = new Uint8Array(100);
   * file.readSync(buf);
   * const text = new TextDecoder().decode(buf); // "hello w"
   * file.close();
   * ```
   */
  truncateSync(len?: number): void {
    return ftruncateSync(this.rid, len);
  }

  /** Read the file into an array buffer (`p`).
   *
   * Resolves to either the number of bytes read during the operation or EOF
   * (`null`) if there was nothing more to read.
   *
   * It is possible for a read to successfully return with `0` bytes. This
   * does not indicate EOF.
   *
   * **It is not guaranteed that the full buffer will be read in a single
   * call.**
   *
   * ```ts
   * // if "/foo/bar.txt" contains the text "hello world":
   * const file = await Deno.open("/foo/bar.txt");
   * const buf = new Uint8Array(100);
   * const numberOfBytesRead = await file.read(buf); // 11 bytes
   * const text = new TextDecoder().decode(buf);  // "hello world"
   * file.close();
   * ```
   */
  read(p: Uint8Array): Promise<number | null> {
    return read(this.rid, p);
  }

  /** Synchronously read from the file into an array buffer (`p`).
   *
   * Returns either the number of bytes read during the operation or EOF
   * (`null`) if there was nothing more to read.
   *
   * It is possible for a read to successfully return with `0` bytes. This
   * does not indicate EOF.
   *
   * **It is not guaranteed that the full buffer will be read in a single
   * call.**
   *
   * ```ts
   * // if "/foo/bar.txt" contains the text "hello world":
   * const file = Deno.openSync("/foo/bar.txt");
   * const buf = new Uint8Array(100);
   * const numberOfBytesRead = file.readSync(buf); // 11 bytes
   * const text = new TextDecoder().decode(buf);  // "hello world"
   * file.close();
   * ```
   */
  readSync(p: Uint8Array): number | null {
    return readSync(this.rid, p);
  }

  /** Seek to the given `offset` under mode given by `whence`. The call
   * resolves to the new position within the resource (bytes from the start).
   *
   * ```ts
   * // Given file pointing to file with "Hello world", which is 11 bytes long:
   * const file = await Deno.open(
   *   "hello.txt",
   *   { read: true, write: true, truncate: true, create: true },
   * );
   * await file.write(new TextEncoder().encode("Hello world"));
   *
   * // advance cursor 6 bytes
   * const cursorPosition = await file.seek(6, Deno.SeekMode.Start);
   * console.log(cursorPosition);  // 6
   * const buf = new Uint8Array(100);
   * await file.read(buf);
   * console.log(new TextDecoder().decode(buf)); // "world"
   * file.close();
   * ```
   *
   * The seek modes work as follows:
   *
   * ```ts
   * // Given file.rid pointing to file with "Hello world", which is 11 bytes long:
   * const file = await Deno.open(
   *   "hello.txt",
   *   { read: true, write: true, truncate: true, create: true },
   * );
   * await file.write(new TextEncoder().encode("Hello world"));
   *
   * // Seek 6 bytes from the start of the file
   * console.log(await file.seek(6, Deno.SeekMode.Start)); // "6"
   * // Seek 2 more bytes from the current position
   * console.log(await file.seek(2, Deno.SeekMode.Current)); // "8"
   * // Seek backwards 2 bytes from the end of the file
   * console.log(await file.seek(-2, Deno.SeekMode.End)); // "9" (e.g. 11-2)
   * ```
   */
  seek(offset: number, whence: SeekMode): Promise<number> {
    return seek(this.rid, offset, whence);
  }

  /** Synchronously seek to the given `offset` under mode given by `whence`.
   * The new position within the resource (bytes from the start) is returned.
   *
   * ```ts
   * const file = Deno.openSync(
   *   "hello.txt",
   *   { read: true, write: true, truncate: true, create: true },
   * );
   * file.writeSync(new TextEncoder().encode("Hello world"));
   *
   * // advance cursor 6 bytes
   * const cursorPosition = file.seekSync(6, Deno.SeekMode.Start);
   * console.log(cursorPosition);  // 6
   * const buf = new Uint8Array(100);
   * file.readSync(buf);
   * console.log(new TextDecoder().decode(buf)); // "world"
   * file.close();
   * ```
   *
   * The seek modes work as follows:
   *
   * ```ts
   * // Given file.rid pointing to file with "Hello world", which is 11 bytes long:
   * const file = Deno.openSync(
   *   "hello.txt",
   *   { read: true, write: true, truncate: true, create: true },
   * );
   * file.writeSync(new TextEncoder().encode("Hello world"));
   *
   * // Seek 6 bytes from the start of the file
   * console.log(file.seekSync(6, Deno.SeekMode.Start)); // "6"
   * // Seek 2 more bytes from the current position
   * console.log(file.seekSync(2, Deno.SeekMode.Current)); // "8"
   * // Seek backwards 2 bytes from the end of the file
   * console.log(file.seekSync(-2, Deno.SeekMode.End)); // "9" (e.g. 11-2)
   * file.close();
   * ```
   */
  seekSync(offset: number, whence: SeekMode): number {
    return seekSync(this.rid, offset, whence);
  }

  /** Resolves to a {@linkcode Deno.FileInfo} for the file.
   *
   * ```ts
   * import { assert } from "https://deno.land/std/testing/asserts.ts";
   *
   * const file = await Deno.open("hello.txt");
   * const fileInfo = await file.stat();
   * assert(fileInfo.isFile);
   * file.close();
   * ```
   */
  stat(): Promise<FileInfo> {
    return fstat(this.rid);
  }

  /** Synchronously returns a {@linkcode Deno.FileInfo} for the file.
   *
   * ```ts
   * import { assert } from "https://deno.land/std/testing/asserts.ts";
   *
   * const file = Deno.openSync("hello.txt")
   * const fileInfo = file.statSync();
   * assert(fileInfo.isFile);
   * file.close();
   * ```
   */
  statSync(): FileInfo {
    return fstatSync(this.rid);
  }

  /** Close the file. Closing a file when you are finished with it is
   * important to avoid leaking resources.
   *
   * ```ts
   * const file = await Deno.open("my_file.txt");
   * // do work with "file" object
   * file.close();
   * ```
   */
  close(): void {
    core.close(this.rid);
  }

  /** A {@linkcode ReadableStream} instance representing to the byte contents
   * of the file. This makes it easy to interoperate with other web streams
   * based APIs.
   *
   * ```ts
   * const file = await Deno.open("my_file.txt", { read: true });
   * const decoder = new TextDecoder();
   * for await (const chunk of file.readable) {
   *   console.log(decoder.decode(chunk));
   * }
   * file.close();
   * ```
   */
  get readable(): ReadableStream<Uint8Array> {
    if (this.#readable === undefined) {
      this.#readable = readableStreamForRid(this.rid);
    }
    return this.#readable;
  }

  /** A {@linkcode WritableStream} instance to write the contents of the
   * file. This makes it easy to interoperate with other web streams based
   * APIs.
   *
   * ```ts
   * const items = ["hello", "world"];
   * const file = await Deno.open("my_file.txt", { write: true });
   * const encoder = new TextEncoder();
   * const writer = file.writable.getWriter();
   * for (const item of items) {
   *   await writer.write(encoder.encode(item));
   * }
   * file.close();
   * ```
   */
  get writable(): WritableStream<Uint8Array> {
    if (this.#writable === undefined) {
      this.#writable = writableStreamForRid(this.rid);
    }
    return this.#writable;
  }
}

class Stdin {
  #readable?: ReadableStream<Uint8Array>;

  constructor() {
  }

  get rid() {
    return 0;
  }

  read(p) {
    return read(this.rid, p);
  }

  readSync(p) {
    return readSync(this.rid, p);
  }

  close() {
    core.close(this.rid);
  }

  get readable() {
    if (this.#readable === undefined) {
      this.#readable = readableStreamForRid(this.rid);
    }
    return this.#readable;
  }

  setRaw(mode: boolean, options: Partial<SetRawOptions> = {}): void {
    const cbreak = !!(options.cbreak ?? false);
    ops.op_stdin_set_raw(mode, cbreak);
  }
}

class Stdout {
  #writable: WritableStream<Uint8Array>;

  constructor() {
  }

  get rid() {
    return 1;
  }

  write(p: Uint8Array) {
    return write(this.rid, p);
  }

  writeSync(p: Uint8Array) {
    return writeSync(this.rid, p);
  }

  close() {
    core.close(this.rid);
  }

  get writable() {
    if (this.#writable === undefined) {
      this.#writable = writableStreamForRid(this.rid);
    }
    return this.#writable;
  }
}

class Stderr {
  #writable: WritableStream<Uint8Array>;

  constructor() {
  }

  get rid() {
    return 2;
  }

  write(p: Uint8Array) {
    return write(this.rid, p);
  }

  writeSync(p: Uint8Array) {
    return writeSync(this.rid, p);
  }

  close() {
    core.close(this.rid);
  }

  get writable() {
    if (this.#writable === undefined) {
      this.#writable = writableStreamForRid(this.rid);
    }
    return this.#writable;
  }
}

export const stdin = new Stdin();
export const stdout = new Stdout();
export const stderr = new Stderr();

function checkOpenOptions(options: OpenOptions) {
  if (
    ArrayPrototypeFilter(
      ObjectValues(options),
      (val) => val === true,
    ).length === 0
  ) {
    throw new Error("OpenOptions requires at least one option to be true");
  }

  if (options.truncate && !options.write) {
    throw new Error("'truncate' option requires 'write' option");
  }

  const createOrCreateNewWithoutWriteOrAppend =
    (options.create || options.createNew) &&
    !(options.write || options.append);

  if (createOrCreateNewWithoutWriteOrAppend) {
    throw new Error(
      "'create' or 'createNew' options require 'write' or 'append' option",
    );
  }
}

export { FsFile as File }


