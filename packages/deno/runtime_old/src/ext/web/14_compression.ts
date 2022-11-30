// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/14_compression.js

// @ts-check
// <reference path="../../core/lib.deno_core.d.ts" />
// <reference path="./internal.d.ts" />
// <reference path="./lib.deno_web.d.ts" />

"use strict";

import * as ops from '../../ops/index.js';
import * as webidl from '../webidl/00_webidl.js';
import { TransformStream } from './06_streams.js';

webidl.converters.CompressionFormat = webidl.createEnumConverter(
  "CompressionFormat",
  [
    "deflate",
    "deflate-raw",
    "gzip",
  ],
);

/**
 * An API for compressing a stream of data.
 *
 * @example
 * ```ts
 * await Deno.stdin.readable
 *   .pipeThrough(new CompressionStream("gzip"))
 *   .pipeTo(Deno.stdout.writable);
 * ```
 *
 * @category Compression Streams API
 */
export class CompressionStream {
  #transform;

  /**
   * Creates a new `CompressionStream` object which compresses a stream of
   * data.
   *
   * Throws a `TypeError` if the format passed to the constructor is not
   * supported.
   */
  constructor(format: string) {
    const prefix = "Failed to construct 'CompressionStream'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    format = webidl.converters.CompressionFormat(format, {
      prefix,
      context: "Argument 1",
    });

    const rid = ops.op_compression_new(format, false);

    this.#transform = new TransformStream({
      transform(chunk, controller) {
        chunk = webidl.converters.BufferSource(chunk, {
          prefix,
          context: "chunk",
        });
        const output = ops.op_compression_write(
          rid,
          chunk,
        );
        maybeEnqueue(controller, output);
      },
      flush(controller) {
        const output = ops.op_compression_finish(rid);
        maybeEnqueue(controller, output);
      },
    });

    this[webidl.brand] = webidl.brand;
  }

  get readable():ReadableStream<Uint8Array> {
    webidl.assertBranded(this, CompressionStreamPrototype);
    return this.#transform.readable;
  }

  get writable(): WritableStream<Uint8Array> {
    webidl.assertBranded(this, CompressionStreamPrototype);
    return this.#transform.writable;
  }
}

webidl.configurePrototype(CompressionStream);
const CompressionStreamPrototype = CompressionStream.prototype;

/**
 * An API for decompressing a stream of data.
 *
 * @example
 * ```ts
 * const input = await Deno.open("./file.txt.gz");
 * const output = await Deno.create("./file.txt");
 *
 * await input.readable
 *   .pipeThrough(new DecompressionStream("gzip"))
 *   .pipeTo(output.writable);
 * ```
 *
 * @category Compression Streams API
 */
export class DecompressionStream {
  #transform;

  /**
   * Creates a new `DecompressionStream` object which decompresses a stream of
   * data.
   *
   * Throws a `TypeError` if the format passed to the constructor is not
   * supported.
   */
  constructor(format: string) {
    const prefix = "Failed to construct 'DecompressionStream'";
    webidl.requiredArguments(arguments.length, 1, { prefix });
    format = webidl.converters.CompressionFormat(format, {
      prefix,
      context: "Argument 1",
    });

    const rid = ops.op_compression_new(format, true);

    this.#transform = new TransformStream({
      transform(chunk, controller) {
        chunk = webidl.converters.BufferSource(chunk, {
          prefix,
          context: "chunk",
        });
        const output = ops.op_compression_write(
          rid,
          chunk,
        );
        maybeEnqueue(controller, output);
      },
      flush(controller) {
        const output = ops.op_compression_finish(rid);
        maybeEnqueue(controller, output);
      },
    });

    this[webidl.brand] = webidl.brand;
  }

  get readable(): ReadableStream<Uint8Array> {
    webidl.assertBranded(this, DecompressionStreamPrototype);
    return this.#transform.readable;
  }

  get writable(): WritableStream<Uint8Array> {
    webidl.assertBranded(this, DecompressionStreamPrototype);
    return this.#transform.writable;
  }
}

function maybeEnqueue(controller, output) {
  if (output && output.byteLength > 0) {
    controller.enqueue(output);
  }
}

webidl.configurePrototype(DecompressionStream);
const DecompressionStreamPrototype = DecompressionStream.prototype;

