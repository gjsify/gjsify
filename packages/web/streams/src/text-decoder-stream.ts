// WHATWG TextDecoderStream for GJS
// Reference: refs/deno/ext/web/08_text_encoding.js (lines 299–412)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Reimplemented for GJS — pure TypeScript, no native bindings.

import { TransformStream } from './transform-stream.js';

/**
 * TextDecoderStream decodes a stream of bytes into strings.
 *
 * Wraps TextDecoder with `stream: true` so multi-byte sequences split across
 * chunks are handled correctly. The flush callback decodes any remaining bytes.
 */
export class TextDecoderStream {
  #decoder: TextDecoder;
  #transform: TransformStream;

  constructor(label?: string, options?: TextDecoderOptions) {
    this.#decoder = new TextDecoder(label, options);
    this.#transform = new TransformStream({
      transform: (chunk, controller) => {
        let bytes: ArrayBufferView;
        if (chunk instanceof ArrayBuffer) {
          bytes = new Uint8Array(chunk);
        } else if (ArrayBuffer.isView(chunk)) {
          bytes = chunk;
        } else {
          throw new TypeError('chunk must be a BufferSource');
        }
        const decoded = this.#decoder.decode(bytes, { stream: true });
        if (decoded) {
          controller.enqueue(decoded);
        }
      },
      flush: (controller) => {
        const final = this.#decoder.decode();
        if (final) {
          controller.enqueue(final);
        }
      },
      cancel: () => {
        // Reset decoder state
        this.#decoder.decode();
      },
    });
  }

  get encoding(): string {
    return this.#decoder.encoding;
  }

  get fatal(): boolean {
    return this.#decoder.fatal;
  }

  get ignoreBOM(): boolean {
    return this.#decoder.ignoreBOM;
  }

  get readable(): ReadableStream<string> {
    return this.#transform.readable;
  }

  get writable(): WritableStream<BufferSource> {
    return this.#transform.writable;
  }
}
