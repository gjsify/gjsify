// WHATWG TextEncoderStream for GJS
// Reference: refs/deno/ext/web/08_text_encoding.js (lines 414–490)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Reimplemented for GJS — pure TypeScript, no native bindings.

import { TransformStream } from './transform-stream.js';

/**
 * TextEncoderStream encodes a stream of strings into UTF-8 encoded bytes.
 *
 * Handles surrogate pairs split across chunks: if the last code unit of a
 * chunk is a high surrogate (0xD800–0xDBFF), it is held until the next chunk.
 * If the stream ends with a pending high surrogate, U+FFFD replacement bytes
 * are emitted.
 */
export class TextEncoderStream {
  #pendingHighSurrogate: string | null = null;
  #encoder = new TextEncoder();
  #transform: TransformStream;

  constructor() {
    this.#transform = new TransformStream({
      transform: (chunk: string, controller) => {
        chunk = String(chunk);
        if (chunk === '') {
          return;
        }
        if (this.#pendingHighSurrogate !== null) {
          chunk = this.#pendingHighSurrogate + chunk;
        }
        const lastCodeUnit = chunk.charCodeAt(chunk.length - 1);
        if (0xD800 <= lastCodeUnit && lastCodeUnit <= 0xDBFF) {
          this.#pendingHighSurrogate = chunk.slice(-1);
          chunk = chunk.slice(0, -1);
        } else {
          this.#pendingHighSurrogate = null;
        }
        if (chunk) {
          controller.enqueue(this.#encoder.encode(chunk));
        }
      },
      flush: (controller) => {
        if (this.#pendingHighSurrogate !== null) {
          // U+FFFD replacement character in UTF-8
          controller.enqueue(new Uint8Array([0xEF, 0xBF, 0xBD]));
        }
      },
    });
  }

  get encoding(): string {
    return 'utf-8';
  }

  get readable(): ReadableStream<Uint8Array> {
    return this.#transform.readable;
  }

  get writable(): WritableStream<string> {
    return this.#transform.writable;
  }
}
