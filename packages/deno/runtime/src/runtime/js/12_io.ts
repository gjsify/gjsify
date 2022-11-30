// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://raw.githubusercontent.com/denoland/deno/main/runtime/js/12_io.js

// Interfaces 100% copied from Go.
// Documentation liberally lifted from them too.
// Thank you! We love Go! <3
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';

const {
  Uint8Array,
  ArrayPrototypePush,
  MathMin,
  TypedArrayPrototypeSubarray,
  TypedArrayPrototypeSet,
} = primordials;

import type {
  ReaderSync,
  Reader,
  Writer,
} from '../../types/index.js';

const DEFAULT_BUFFER_SIZE = 32 * 1024;
// Seek whence values.
// https://golang.org/pkg/io/#pkg-constants
export const SeekMode = {
  0: "Start",
  1: "Current",
  2: "End",

  Start: 0,
  Current: 1,
  End: 2,
};

/**
 * Copies from `src` to `dst` until either EOF (`null`) is read from `src` or
 * an error occurs. It resolves to the number of bytes copied or rejects with
 * the first error encountered while copying.
 *
 * @deprecated Use
 * [`copy`](https://deno.land/std/streams/conversion.ts?s=copy) from
 * [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 * instead. `Deno.copy` will be removed in the future.
 *
 * @category I/O
 *
 * @param src The source to copy from
 * @param dst The destination to copy to
 * @param options Can be used to tune size of the buffer. Default size is 32kB
 */
export async function copy(
  src: Reader,
  dst: Writer,
  options?: { bufSize?: number },
): Promise<number> {
  let n = 0;
  const bufSize = options?.bufSize ?? DEFAULT_BUFFER_SIZE;
  const b = new Uint8Array(bufSize);
  let gotEOF = false;
  while (gotEOF === false) {
    const result = await src.read(b);
    if (result === null) {
      gotEOF = true;
    } else {
      let nwritten = 0;
      while (nwritten < result) {
        nwritten += await dst.write(
          TypedArrayPrototypeSubarray(b, nwritten, result),
        );
      }
      n += nwritten;
    }
  }
  return n;
}

/**
 * Turns a Reader, `r`, into an async iterator.
 *
 * @deprecated Use
 * [`iterateReader`](https://deno.land/std/streams/conversion.ts?s=iterateReader)
 * from
 * [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 * instead. `Deno.iter` will be removed in the future.
 *
 * @category I/O
 */
export async function* iter(
  r: Reader,
  options?: { bufSize?: number },
): AsyncIterableIterator<Uint8Array> {
  const bufSize = options?.bufSize ?? DEFAULT_BUFFER_SIZE;
  const b = new Uint8Array(bufSize);
  while (true) {
    const result = await r.read(b);
    if (result === null) {
      break;
    }

    yield TypedArrayPrototypeSubarray(b, 0, result);
  }
}

/**
 * Turns a ReaderSync, `r`, into an iterator.
 *
 * @deprecated Use
 * [`iterateReaderSync`](https://deno.land/std/streams/conversion.ts?s=iterateReaderSync)
 * from
 * [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 * instead. `Deno.iterSync` will be removed in the future.
 *
 * @category I/O
 */
export function* iterSync(
  r: ReaderSync,
  options?: {
    bufSize?: number;
  },
): IterableIterator<Uint8Array> {
  const bufSize = options?.bufSize ?? DEFAULT_BUFFER_SIZE;
  const b = new Uint8Array(bufSize);
  while (true) {
    const result = r.readSync(b);
    if (result === null) {
      break;
    }

    yield TypedArrayPrototypeSubarray(b, 0, result);
  }
}

/** Synchronously read from a resource ID (`rid`) into an array buffer
 * (`buffer`).
 *
 * Returns either the number of bytes read during the operation or EOF
 * (`null`) if there was nothing more to read.
 *
 * It is possible for a read to successfully return with `0` bytes. This does
 * not indicate EOF.
 *
 * This function is one of the lowest level APIs and most users should not
 * work with this directly, but rather use
 * [`readAllSync()`](https://deno.land/std/streams/conversion.ts?s=readAllSync)
 * from
 * [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 * instead.
 *
 * **It is not guaranteed that the full buffer will be read in a single
 * call.**
 *
 * ```ts
 * // if "/foo/bar.txt" contains the text "hello world":
 * const file = Deno.openSync("/foo/bar.txt");
 * const buf = new Uint8Array(100);
 * const numberOfBytesRead = Deno.readSync(file.rid, buf); // 11 bytes
 * const text = new TextDecoder().decode(buf);  // "hello world"
 * Deno.close(file.rid);
 * ```
 *
 * @category I/O
 */
export function readSync(rid: number, buffer: Uint8Array): number | null {
  if (buffer.length === 0) {
    return 0;
  }

  const nread = ops.op_read_sync(rid, buffer);

  return nread === 0 ? null : nread;
}

/** Read from a resource ID (`rid`) into an array buffer (`buffer`).
 *
 * Resolves to either the number of bytes read during the operation or EOF
 * (`null`) if there was nothing more to read.
 *
 * It is possible for a read to successfully return with `0` bytes. This does
 * not indicate EOF.
 *
 * This function is one of the lowest level APIs and most users should not
 * work with this directly, but rather use
 * [`readAll()`](https://deno.land/std/streams/conversion.ts?s=readAll) from
 * [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 * instead.
 *
 * **It is not guaranteed that the full buffer will be read in a single call.**
 *
 * ```ts
 * // if "/foo/bar.txt" contains the text "hello world":
 * const file = await Deno.open("/foo/bar.txt");
 * const buf = new Uint8Array(100);
 * const numberOfBytesRead = await Deno.read(file.rid, buf); // 11 bytes
 * const text = new TextDecoder().decode(buf);  // "hello world"
 * Deno.close(file.rid);
 * ```
 *
 * @category I/O
 */
export async function read(rid: number, buffer: Uint8Array): Promise<number | null> {
  if (buffer.length === 0) {
    return 0;
  }

  const nread = await core.read(rid, buffer);

  return nread === 0 ? null : nread;
}

/** Synchronously write to the resource ID (`rid`) the contents of the array
 * buffer (`data`).
 *
 * Returns the number of bytes written. This function is one of the lowest
 * level APIs and most users should not work with this directly, but rather
 * use
 * [`writeAllSync()`](https://deno.land/std/streams/conversion.ts?s=writeAllSync)
 * from
 * [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 * instead.
 *
 * **It is not guaranteed that the full buffer will be written in a single
 * call.**
 *
 * ```ts
 * const encoder = new TextEncoder();
 * const data = encoder.encode("Hello world");
 * const file = Deno.openSync("/foo/bar.txt", { write: true });
 * const bytesWritten = Deno.writeSync(file.rid, data); // 11
 * Deno.close(file.rid);
 * ```
 *
 * @category I/O
 */
export function writeSync(rid: number, data: Uint8Array): number {
  return ops.op_write_sync(rid, data);
}

/** Write to the resource ID (`rid`) the contents of the array buffer (`data`).
 *
 * Resolves to the number of bytes written. This function is one of the lowest
 * level APIs and most users should not work with this directly, but rather use
 * [`writeAll()`](https://deno.land/std/streams/conversion.ts?s=writeAll) from
 * [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 * instead.
 *
 * **It is not guaranteed that the full buffer will be written in a single
 * call.**
 *
 * ```ts
 * const encoder = new TextEncoder();
 * const data = encoder.encode("Hello world");
 * const file = await Deno.open("/foo/bar.txt", { write: true });
 * const bytesWritten = await Deno.write(file.rid, data); // 11
 * Deno.close(file.rid);
 * ```
 *
 * @category I/O
 */
export function write(rid: number, data: Uint8Array): Promise<number> {
  return core.write(rid, data);
}

const READ_PER_ITER = 64 * 1024; // 64kb

/**
 * Read Reader `r` until EOF (`null`) and resolve to the content as
 * Uint8Array`.
 *
 * @deprecated Use
 *   [`readAll`](https://deno.land/std/streams/conversion.ts?s=readAll) from
 *   [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 *   instead. `Deno.readAll` will be removed in the future.
 *
 * @category I/O
 */
export function readAll(r: Reader): Promise<Uint8Array> {
  return readAllInner(r);
}


export async function readAllInner(r: Reader, options?) {
  const buffers = [];
  const signal = options?.signal ?? null;
  while (true) {
    signal?.throwIfAborted();
    const buf = new Uint8Array(READ_PER_ITER);
    const read = await r.read(buf);
    if (typeof read == "number") {
      ArrayPrototypePush(buffers, new Uint8Array(buf.buffer, 0, read));
    } else {
      break;
    }
  }
  signal?.throwIfAborted();

  return concatBuffers(buffers);
}

/**
 * Synchronously reads Reader `r` until EOF (`null`) and returns the content
 * as `Uint8Array`.
 *
 * @deprecated Use
 *   [`readAllSync`](https://deno.land/std/streams/conversion.ts?s=readAllSync)
 *   from
 *   [`std/streams/conversion.ts`](https://deno.land/std/streams/conversion.ts)
 *   instead. `Deno.readAllSync` will be removed in the future.
 *
 * @category I/O
 */
export function readAllSync(r: ReaderSync): Uint8Array {
  const buffers = [];

  while (true) {
    const buf = new Uint8Array(READ_PER_ITER);
    const read = r.readSync(buf);
    if (typeof read == "number") {
      ArrayPrototypePush(buffers, TypedArrayPrototypeSubarray(buf, 0, read));
    } else {
      break;
    }
  }

  return concatBuffers(buffers);
}

function concatBuffers(buffers) {
  let totalLen = 0;
  for (const buf of buffers) {
    totalLen += buf.byteLength;
  }

  const contents = new Uint8Array(totalLen);

  let n = 0;
  for (const buf of buffers) {
    TypedArrayPrototypeSet(contents, buf, n);
    n += buf.byteLength;
  }

  return contents;
}

export function readAllSyncSized(r: ReaderSync, size: number) {
  const buf = new Uint8Array(size + 1); // 1B to detect extended files
  let cursor = 0;

  while (cursor < size) {
    const sliceEnd = MathMin(size + 1, cursor + READ_PER_ITER);
    const slice = TypedArrayPrototypeSubarray(buf, cursor, sliceEnd);
    const read = r.readSync(slice);
    if (typeof read == "number") {
      cursor += read;
    } else {
      break;
    }
  }

  // Handle truncated or extended files during read
  if (cursor > size) {
    // Read remaining and concat
    return concatBuffers([buf, readAllSync(r)]);
  } else { // cursor == size
    return TypedArrayPrototypeSubarray(buf, 0, cursor);
  }
}

export async function readAllInnerSized(r: Reader, size: number, options) {
  const buf = new Uint8Array(size + 1); // 1B to detect extended files
  let cursor = 0;
  const signal = options?.signal ?? null;
  while (cursor < size) {
    signal?.throwIfAborted();
    const sliceEnd = MathMin(size + 1, cursor + READ_PER_ITER);
    const slice = TypedArrayPrototypeSubarray(buf, cursor, sliceEnd);
    const read = await r.read(slice);
    if (typeof read == "number") {
      cursor += read;
    } else {
      break;
    }
  }
  signal?.throwIfAborted();

  // Handle truncated or extended files during read
  if (cursor > size) {
    // Read remaining and concat
    return concatBuffers([buf, await readAllInner(r, options)]);
  } else {
    return TypedArrayPrototypeSubarray(buf, 0, cursor);
  }
}
