// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/08_text_encoding.js

// @ts-check
// <reference path="../../core/lib.deno_core.d.ts" />
// <reference path="../../core/internal.d.ts" />
// <reference path="../webidl/internal.d.ts" />
// <reference path="../fetch/lib.deno_fetch.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />
// <reference lib="esnext" />

"use strict";

import { core, ops, primordials } from '@gjsify/deno_core';
import * as webidl from '../webidl/00_webidl.js';
const {
  ArrayBufferIsView,
  ObjectPrototypeIsPrototypeOf,
  PromiseReject,
  PromiseResolve,
  StringPrototypeCharCodeAt,
  StringPrototypeSlice,
  TypedArrayPrototypeSubarray,
  Uint8Array,
  Uint32Array,
} = primordials;

export class TextDecoder {
  #encoding: string;
  #fatal: boolean;
  #ignoreBOM: boolean;
  #rid: number | null = null;

  constructor(label: string = "utf-8", options: TextDecoderOptions = {}) {
    const prefix = "Failed to construct 'TextDecoder'";
    label = webidl.converters.DOMString(label, {
      prefix,
      context: "Argument 1",
    });
    options = webidl.converters.TextDecoderOptions(options, {
      prefix,
      context: "Argument 2",
    });
    const encoding = ops.op_encoding_normalize_label(label);
    this.#encoding = encoding;
    this.#fatal = options.fatal;
    this.#ignoreBOM = options.ignoreBOM;
    this[webidl.brand] = webidl.brand;
  }

  get encoding(): string {
    webidl.assertBranded(this, TextDecoderPrototype);
    return this.#encoding;
  }

  get fatal(): boolean {
    webidl.assertBranded(this, TextDecoderPrototype);
    return this.#fatal;
  }

  get ignoreBOM(): boolean {
    webidl.assertBranded(this, TextDecoderPrototype);
    return this.#ignoreBOM;
  }

  decode(input: BufferSource = new Uint8Array(), options: TextDecodeOptions = {}): string {
    webidl.assertBranded(this, TextDecoderPrototype);
    const prefix = "Failed to execute 'decode' on 'TextDecoder'";
    if (input !== undefined) {
      input = webidl.converters.BufferSource(input, {
        prefix,
        context: "Argument 1",
        allowShared: true,
      });
    }
    options = webidl.converters.TextDecodeOptions(options, {
      prefix,
      context: "Argument 2",
    });

    try {
      try {
        if (ArrayBufferIsView(input)) {
          input = new Uint8Array(
            input.buffer,
            input.byteOffset,
            input.byteLength,
          );
        } else {
          input = new Uint8Array(input);
        }
      } catch {
        // If the buffer is detached, just create a new empty Uint8Array.
        input = new Uint8Array();
      }
      if (
        ObjectPrototypeIsPrototypeOf(
          SharedArrayBuffer.prototype,
          (input as Uint8Array).buffer,
        )
      ) {
        // We clone the data into a non-shared ArrayBuffer so we can pass it
        // to Rust.
        // `input` is now a Uint8Array, and calling the TypedArray constructor
        // with a TypedArray argument copies the data.
        // @ts-ignore
        input = new Uint8Array(input);
      }

      if (!options.stream && this.#rid === null) {
        return ops.op_encoding_decode_single(
          input,
          this.#encoding,
          this.#fatal,
          this.#ignoreBOM,
        );
      }

      if (this.#rid === null) {
        this.#rid = ops.op_encoding_new_decoder(
          this.#encoding,
          this.#fatal,
          this.#ignoreBOM,
        );
      }
      return ops.op_encoding_decode(input, this.#rid, options.stream);
    } finally {
      if (!options.stream && this.#rid !== null) {
        core.close(this.#rid);
        this.#rid = null;
      }
    }
  }
}

webidl.configurePrototype(TextDecoder);
const TextDecoderPrototype = TextDecoder.prototype;

export class TextEncoder {
  constructor() {
    this[webidl.brand] = webidl.brand;
  }

  get encoding(): string {
    webidl.assertBranded(this, TextEncoderPrototype);
    return "utf-8";
  }

  encode(input: string = ""): Uint8Array {
    webidl.assertBranded(this, TextEncoderPrototype);
    const prefix = "Failed to execute 'encode' on 'TextEncoder'";
    // The WebIDL type of `input` is `USVString`, but `core.encode` already
    // converts lone surrogates to the replacement character.
    input = webidl.converters.DOMString(input, {
      prefix,
      context: "Argument 1",
    });
    return core.encode(input);
  }

  encodeInto(source: string, destination: Uint8Array): TextEncoderEncodeIntoResult {
    webidl.assertBranded(this, TextEncoderPrototype);
    const prefix = "Failed to execute 'encodeInto' on 'TextEncoder'";
    // The WebIDL type of `source` is `USVString`, but the ops bindings
    // already convert lone surrogates to the replacement character.
    source = webidl.converters.DOMString(source, {
      prefix,
      context: "Argument 1",
    });
    destination = webidl.converters.Uint8Array(destination, {
      prefix,
      context: "Argument 2",
      allowShared: true,
    });
    ops.op_encoding_encode_into(source, destination, encodeIntoBuf);
    return {
      read: encodeIntoBuf[0],
      written: encodeIntoBuf[1],
    };
  }
}

const encodeIntoBuf = new Uint32Array(2);

webidl.configurePrototype(TextEncoder);
const TextEncoderPrototype = TextEncoder.prototype;

export class TextDecoderStream {
  #decoder: TextDecoder;
  #transform: TransformStream<BufferSource, string>;

  constructor(label: string = "utf-8", options: TextDecoderOptions = {}) {
    const prefix = "Failed to construct 'TextDecoderStream'";
    label = webidl.converters.DOMString(label, {
      prefix,
      context: "Argument 1",
    });
    options = webidl.converters.TextDecoderOptions(options, {
      prefix,
      context: "Argument 2",
    });
    this.#decoder = new TextDecoder(label, options);
    this.#transform = new TransformStream({
      // The transform and flush functions need access to TextDecoderStream's
      // `this`, so they are defined as functions rather than methods.
      transform: (chunk, controller) => {
        try {
          chunk = webidl.converters.BufferSource(chunk, {
            allowShared: true,
          });
          const decoded = this.#decoder.decode(chunk, { stream: true });
          if (decoded) {
            controller.enqueue(decoded);
          }
          return PromiseResolve();
        } catch (err) {
          return PromiseReject(err);
        }
      },
      flush: (controller) => {
        try {
          const final = this.#decoder.decode();
          if (final) {
            controller.enqueue(final);
          }
          return PromiseResolve();
        } catch (err) {
          return PromiseReject(err);
        }
      },
    });
    this[webidl.brand] = webidl.brand;
  }

  get encoding(): string {
    webidl.assertBranded(this, TextDecoderStreamPrototype);
    return this.#decoder.encoding;
  }

  get fatal(): boolean {
    webidl.assertBranded(this, TextDecoderStreamPrototype);
    return this.#decoder.fatal;
  }

  get ignoreBOM(): boolean {
    webidl.assertBranded(this, TextDecoderStreamPrototype);
    return this.#decoder.ignoreBOM;
  }

  get readable(): ReadableStream<string> {
    webidl.assertBranded(this, TextDecoderStreamPrototype);
    return this.#transform.readable;
  }

  get writable(): WritableStream<BufferSource> {
    webidl.assertBranded(this, TextDecoderStreamPrototype);
    return this.#transform.writable;
  }
}

webidl.configurePrototype(TextDecoderStream);
const TextDecoderStreamPrototype = TextDecoderStream.prototype;

export class TextEncoderStream {
  #pendingHighSurrogate: string | null = null;
  #transform: TransformStream<string, Uint8Array>;

  constructor() {
    this.#transform = new TransformStream({
      // The transform and flush functions need access to TextEncoderStream's
      // `this`, so they are defined as functions rather than methods.
      transform: (chunk, controller) => {
        try {
          chunk = webidl.converters.DOMString(chunk);
          if (chunk === "") {
            return PromiseResolve();
          }
          if (this.#pendingHighSurrogate !== null) {
            chunk = this.#pendingHighSurrogate + chunk;
          }
          const lastCodeUnit = StringPrototypeCharCodeAt(
            chunk,
            chunk.length - 1,
          );
          if (0xD800 <= lastCodeUnit && lastCodeUnit <= 0xDBFF) {
            this.#pendingHighSurrogate = StringPrototypeSlice(chunk, -1);
            chunk = StringPrototypeSlice(chunk, 0, -1);
          } else {
            this.#pendingHighSurrogate = null;
          }
          if (chunk) {
            controller.enqueue(core.encode(chunk));
          }
          return PromiseResolve();
        } catch (err) {
          return PromiseReject(err);
        }
      },
      flush: (controller) => {
        try {
          if (this.#pendingHighSurrogate !== null) {
            controller.enqueue(new Uint8Array([0xEF, 0xBF, 0xBD]));
          }
          return PromiseResolve();
        } catch (err) {
          return PromiseReject(err);
        }
      },
    });
    this[webidl.brand] = webidl.brand;
  }

  get encoding(): string {
    webidl.assertBranded(this, TextEncoderStreamPrototype);
    return "utf-8";
  }

  get readable(): ReadableStream<Uint8Array> {
    webidl.assertBranded(this, TextEncoderStreamPrototype);
    return this.#transform.readable;
  }

  get writable(): WritableStream<string> {
    webidl.assertBranded(this, TextEncoderStreamPrototype);
    return this.#transform.writable;
  }
}

webidl.configurePrototype(TextEncoderStream);
const TextEncoderStreamPrototype = TextEncoderStream.prototype;

webidl.converters.TextDecoderOptions = webidl.createDictionaryConverter(
  "TextDecoderOptions",
  [
    {
      key: "fatal",
      converter: webidl.converters.boolean,
      defaultValue: false,
    },
    {
      key: "ignoreBOM",
      converter: webidl.converters.boolean,
      defaultValue: false,
    },
  ],
);
webidl.converters.TextDecodeOptions = webidl.createDictionaryConverter(
  "TextDecodeOptions",
  [
    {
      key: "stream",
      converter: webidl.converters.boolean,
      defaultValue: false,
    },
  ],
);

export function decode(bytes: Uint8Array, encoding?: string) {
  const BOMEncoding = BOMSniff(bytes);
  if (BOMEncoding !== null) {
    encoding = BOMEncoding;
    const start = BOMEncoding === "UTF-8" ? 3 : 2;
    bytes = TypedArrayPrototypeSubarray(bytes, start);
  }
  return new TextDecoder(encoding).decode(bytes);
}

function BOMSniff(bytes: Uint8Array) {
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return "UTF-8";
  }
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return "UTF-16BE";
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return "UTF-16LE";
  return null;
}