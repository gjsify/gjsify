// WHATWG TextDecoderStream for GJS
// Reference: refs/deno/ext/web/08_text_encoding.js (lines 299–412)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Reimplemented for GJS — pure TypeScript, no native bindings.
//
// GJS's TextDecoder does not support the `stream` option, so we manually
// buffer incomplete multi-byte UTF-8 sequences across chunks.

import { TransformStream } from './transform-stream.js';

/** Check if TextDecoder supports the `stream` option */
function hasStreamingSupport(): boolean {
  try {
    const td = new TextDecoder();
    td.decode(new Uint8Array([0xC3]), { stream: true });
    return true;
  } catch {
    return false;
  }
}

const supportsStreaming = hasStreamingSupport();

/**
 * For UTF-8 without streaming TextDecoder support:
 * Determine how many bytes at the end of `buf` form an incomplete
 * multi-byte sequence. Returns 0 if the buffer ends on a complete character.
 */
function incompleteUtf8Tail(buf: Uint8Array): number {
  const len = buf.length;
  if (len === 0) return 0;

  // Check last byte: is it a continuation byte or a start byte?
  // Start bytes:
  //   0xxxxxxx (0x00-0x7F) — single byte, complete
  //   110xxxxx (0xC0-0xDF) — starts 2-byte sequence
  //   1110xxxx (0xE0-0xEF) — starts 3-byte sequence
  //   11110xxx (0xF0-0xF7) — starts 4-byte sequence
  // Continuation: 10xxxxxx (0x80-0xBF)

  // Scan back up to 3 bytes to find the start of the last multi-byte sequence
  for (let i = 1; i <= Math.min(3, len); i++) {
    const b = buf[len - i];
    if ((b & 0x80) === 0) {
      // ASCII byte — everything before is complete, this byte is complete
      return 0;
    }
    if ((b & 0xC0) !== 0x80) {
      // This is a start byte
      let expectedLen: number;
      if ((b & 0xE0) === 0xC0) expectedLen = 2;
      else if ((b & 0xF0) === 0xE0) expectedLen = 3;
      else if ((b & 0xF8) === 0xF0) expectedLen = 4;
      else return 0; // Invalid start byte, treat as complete

      if (i < expectedLen) {
        // We have fewer bytes than the sequence needs — incomplete
        return i;
      }
      // Sequence is complete
      return 0;
    }
    // Continuation byte — keep scanning back
  }
  // If we scanned back 3 continuation bytes without finding a start byte,
  // something is wrong; treat as complete to avoid infinite buffering
  return 0;
}

/**
 * TextDecoderStream decodes a stream of bytes into strings.
 *
 * Uses TextDecoder with `stream: true` when available (Node.js, browsers).
 * On GJS where `stream` option is not supported, manually buffers incomplete
 * multi-byte UTF-8 sequences across chunks.
 */
export class TextDecoderStream {
  #decoder: TextDecoder;
  #transform: TransformStream;

  constructor(label?: string, options?: TextDecoderOptions) {
    this.#decoder = new TextDecoder(label, options);

    if (supportsStreaming) {
      // Native streaming support (Node.js, modern browsers)
      this.#transform = new TransformStream({
        transform: (chunk, controller) => {
          const bytes = toUint8Array(chunk);
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
          this.#decoder.decode();
        },
      });
    } else {
      // GJS fallback: manually buffer incomplete UTF-8 sequences
      let pendingBytes = new Uint8Array(0);

      this.#transform = new TransformStream({
        transform: (chunk, controller) => {
          const incoming = toUint8Array(chunk);

          // Merge pending bytes with new data
          let combined: Uint8Array;
          if (pendingBytes.length > 0) {
            combined = new Uint8Array(pendingBytes.length + incoming.length);
            combined.set(pendingBytes, 0);
            combined.set(incoming, pendingBytes.length);
          } else {
            combined = incoming;
          }

          // Check for incomplete multi-byte sequence at the end
          const tail = incompleteUtf8Tail(combined);
          let decodable: Uint8Array;
          if (tail > 0) {
            decodable = combined.slice(0, combined.length - tail);
            pendingBytes = combined.slice(combined.length - tail);
          } else {
            decodable = combined;
            pendingBytes = new Uint8Array(0);
          }

          if (decodable.length > 0) {
            const decoded = this.#decoder.decode(decodable);
            if (decoded) {
              controller.enqueue(decoded);
            }
          }
        },
        flush: (controller) => {
          if (pendingBytes.length > 0) {
            // Decode remaining bytes (may produce replacement characters)
            const decoded = this.#decoder.decode(pendingBytes);
            if (decoded) {
              controller.enqueue(decoded);
            }
            pendingBytes = new Uint8Array(0);
          }
        },
        cancel: () => {
          pendingBytes = new Uint8Array(0);
        },
      });
    }
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

function toUint8Array(chunk: BufferSource): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw new TypeError('chunk must be a BufferSource');
}
