// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/40_write_file.js
"use strict";

import { core, ops } from '@gjsify/deno_core';
import * as abortSignal from './ext/web/03_abort_signal.js';
import { pathFromURL } from './06_util.js';

import type { WriteFileOptions } from '@gjsify/deno_core';

/** Synchronously write `data` to the given `path`, by default creating a new
 * file if needed, else overwriting.
 *
 * ```ts
 * const encoder = new TextEncoder();
 * const data = encoder.encode("Hello world\n");
 * Deno.writeFileSync("hello1.txt", data);  // overwrite "hello1.txt" or create it
 * Deno.writeFileSync("hello2.txt", data, { create: false });  // only works if "hello2.txt" exists
 * Deno.writeFileSync("hello3.txt", data, { mode: 0o777 });  // set permissions on new file
 * Deno.writeFileSync("hello4.txt", data, { append: true });  // add data to the end of the file
 * ```
 *
 * Requires `allow-write` permission, and `allow-read` if `options.create` is
 * `false`.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function writeFileSync(
  path: string | URL,
  data: Uint8Array,
  options: WriteFileOptions = {},
) {
  options.signal?.throwIfAborted();
  ops.op_write_file_sync(
    pathFromURL(path),
    options.mode,
    options.append ?? false,
    options.create ?? true,
    data,
  );
}

/** Write `data` to the given `path`, by default creating a new file if
 * needed, else overwriting.
 *
 * ```ts
 * const encoder = new TextEncoder();
 * const data = encoder.encode("Hello world\n");
 * await Deno.writeFile("hello1.txt", data);  // overwrite "hello1.txt" or create it
 * await Deno.writeFile("hello2.txt", data, { create: false });  // only works if "hello2.txt" exists
 * await Deno.writeFile("hello3.txt", data, { mode: 0o777 });  // set permissions on new file
 * await Deno.writeFile("hello4.txt", data, { append: true });  // add data to the end of the file
 * ```
 *
 * Requires `allow-write` permission, and `allow-read` if `options.create` is
 * `false`.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export async function writeFile(
  path: string | URL,
  data: Uint8Array,
  options: WriteFileOptions = {},
) {
  let cancelRid;
  let abortHandler;
  if (options.signal) {
    options.signal.throwIfAborted();
    cancelRid = ops.op_cancel_handle();
    abortHandler = () => core.tryClose(cancelRid);
    options.signal[abortSignal.add](abortHandler);
  }
  try {
    await core.opAsync(
      "op_write_file_async",
      pathFromURL(path),
      options.mode,
      options.append ?? false,
      options.create ?? true,
      data,
      cancelRid,
    );
  } finally {
    if (options.signal) {
      options.signal[abortSignal.remove](abortHandler);

      // always throw the abort error when aborted
      options.signal.throwIfAborted();
    }
  }
}


/** Synchronously write string `data` to the given `path`, by default creating
 * a new file if needed, else overwriting.
 *
 * ```ts
 * Deno.writeTextFileSync("hello1.txt", "Hello world\n");  // overwrite "hello1.txt" or create it
 * ```
 *
 * Requires `allow-write` permission, and `allow-read` if `options.create` is
 * `false`.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function writeTextFileSync(
  path: string | URL,
  data: string,
  options: WriteFileOptions = {},
) {
  const encoder = new TextEncoder();
  return writeFileSync(path, encoder.encode(data), options);
}

/** Write string `data` to the given `path`, by default creating a new file if
 * needed, else overwriting.
 *
 * ```ts
 * await Deno.writeTextFile("hello1.txt", "Hello world\n");  // overwrite "hello1.txt" or create it
 * ```
 *
 * Requires `allow-write` permission, and `allow-read` if `options.create` is
 * `false`.
 *
 * @tags allow-read, allow-write
 * @category File System
 */
export function writeTextFile(
  path: string | URL,
  data: string,
  options: WriteFileOptions = {},
) {
  const encoder = new TextEncoder();
  return writeFile(path, encoder.encode(data), options);
}

